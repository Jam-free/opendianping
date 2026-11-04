import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { config } from './config.js';

let db: Database.Database | null = null;

/** 测试可注入内存库，避免污染磁盘 */
export function openDatabase(dbPath: string = config.dbPath): Database.Database {
  if (dbPath !== ':memory:') {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }
  const database = new Database(dbPath);
  database.pragma('journal_mode = WAL');
  database.pragma('foreign_keys = ON');
  initSchema(database);
  return database;
}

export function getDb(): Database.Database {
  if (!db) db = openDatabase();
  return db;
}

/** 仅供测试：重置为全新库 */
export function resetDbForTests(database?: Database.Database): Database.Database {
  if (db) {
    try {
      db.close();
    } catch {
      /* ignore */
    }
  }
  db = database || openDatabase(':memory:');
  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}

function initSchema(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      openid TEXT NOT NULL UNIQUE,
      unionid TEXT,
      nickname TEXT,
      avatar TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS shops (
      id TEXT PRIMARY KEY,
      source_type TEXT NOT NULL,
      source_shop_id TEXT,
      amap_poi_id TEXT,
      raw_name TEXT NOT NULL,
      adcode TEXT,
      category TEXT,
      district TEXT,
      city TEXT,
      address TEXT,
      avg_price TEXT,
      lat REAL,
      lng REAL,
      source_url TEXT,
      head_img TEXT,
      display_cache_policy TEXT NOT NULL DEFAULT 'minimal'
    );

    CREATE TABLE IF NOT EXISTS import_batches (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      source_type TEXT NOT NULL,
      source_url TEXT,
      albumid TEXT,
      status TEXT NOT NULL,
      counts TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS favorites (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      shop_id TEXT NOT NULL,
      note TEXT,
      visibility TEXT NOT NULL DEFAULT 'private',
      import_batch_id TEXT,
      created_at TEXT NOT NULL,
      UNIQUE(user_id, shop_id),
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (shop_id) REFERENCES shops(id),
      FOREIGN KEY (import_batch_id) REFERENCES import_batches(id)
    );

    CREATE TABLE IF NOT EXISTS circles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      owner_id TEXT NOT NULL,
      invite_token TEXT NOT NULL,
      token_expires_at TEXT NOT NULL,
      opengid TEXT,
      member_limit INTEGER NOT NULL DEFAULT 200,
      is_personal INTEGER,
      created_at TEXT NOT NULL,
      FOREIGN KEY (owner_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS circle_members (
      circle_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL,
      joined_at TEXT NOT NULL,
      PRIMARY KEY (circle_id, user_id),
      FOREIGN KEY (circle_id) REFERENCES circles(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS circle_shares (
      circle_id TEXT NOT NULL,
      favorite_id TEXT NOT NULL,
      PRIMARY KEY (circle_id, favorite_id),
      FOREIGN KEY (circle_id) REFERENCES circles(id) ON DELETE CASCADE,
      FOREIGN KEY (favorite_id) REFERENCES favorites(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS agent_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL UNIQUE,
      token_hash TEXT NOT NULL,
      token_prefix TEXT NOT NULL,
      created_at TEXT NOT NULL,
      last_used_at TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_favorites_user ON favorites(user_id);
    CREATE INDEX IF NOT EXISTS idx_favorites_visibility ON favorites(visibility);
    CREATE INDEX IF NOT EXISTS idx_shops_source ON shops(source_shop_id);
    CREATE INDEX IF NOT EXISTS idx_shops_amap ON shops(amap_poi_id);
    CREATE INDEX IF NOT EXISTS idx_circle_members_user ON circle_members(user_id);
  `);

  // 迁移：添加 is_personal 列（如果不存在）
  const columns = database.pragma('table_info(circles)') as Array<{ name: string }>;
  const hasIsPersonal = columns.some((col) => col.name === 'is_personal');
  
  if (!hasIsPersonal) {
    database.exec(`ALTER TABLE circles ADD COLUMN is_personal INTEGER;`);
    
    // 回填逻辑：区分真正的个人空间和已被用作共享圈的「我的美食网」
    // 策略：
    // 1. 检查圈子名是否为「我的美食网」（风险：用户可能改名）
    // 2. 检查是否为该用户拥有的第一个圈子（ensurePersonalNetwork 创建的）
    // 3. 检查成员是被 heal 机制添加的，还是通过邀请链接加入的
    //
    // 风险说明：
    // - 用户可能将个人空间改名，导致漏标记（但新代码在创建时已设置 is_personal）
    // - 用户可能将其他圈子改名为「我的美食网」，导致误标记（概率很低）
    const candidates = database
      .prepare(
        `SELECT c.id, c.name, c.owner_id, c.created_at as circle_created,
                (SELECT COUNT(*) FROM circles c2 
                 WHERE c2.owner_id = c.owner_id 
                   AND c2.created_at < c.created_at) as earlier_circles_count
         FROM circles c
         WHERE c.name = '我的美食网' AND c.owner_id IS NOT NULL`
      )
      .all() as Array<{
        id: string;
        name: string;
        owner_id: string;
        circle_created: string;
        earlier_circles_count: number;
      }>;

    console.log(`[migration] 检查 ${candidates.length} 个「我的美食网」圈子的 is_personal 标记`);

    for (const circle of candidates) {
      // 额外检查：如果不是用户的第一个圈子，很可能是用户手动创建的共享圈
      const isLikelyPersonal = circle.earlier_circles_count === 0;
      
      const members = database
        .prepare(
          `SELECT user_id, joined_at
           FROM circle_members
           WHERE circle_id = ? AND user_id != ?`
        )
        .all(circle.id, circle.owner_id) as Array<{
        user_id: string;
        joined_at: string;
      }>;

      if (members.length === 0) {
        // 没有其他成员：只有是第一个圈子时才标记为个人空间
        if (isLikelyPersonal) {
          database
            .prepare(`UPDATE circles SET is_personal = 1 WHERE id = ?`)
            .run(circle.id);
          console.log(
            `[migration] ✓ 标记为个人空间: ${circle.id} (owner=${circle.owner_id}，无其他成员, first_circle=true)`
          );
        } else {
          console.log(
            `[migration] ✗ 保持共享圈: ${circle.id} (owner=${circle.owner_id}，无其他成员, 但不是第一个圈子)`
          );
        }
        continue;
      }

      // 检查是否所有成员都是被 heal 机制添加的
      let allMembersAreHeal = true;
      for (const member of members) {
        // heal 的特征：
        // 1. 圈主 (owner) 是 member.user_id 拥有的某个圈子的成员
        // 2. 双方加入时间接近（heal 是在 joinCircle 时同步执行的）
        const reverseCircle = database
          .prepare(
            `SELECT c.id, cm_joiner.joined_at as joiner_joined
             FROM circles c
             JOIN circle_members cm_joiner ON cm_joiner.circle_id = c.id
             WHERE c.owner_id = ?
               AND cm_joiner.user_id = ?
               AND cm_joiner.role = 'member'`
          )
          .get(member.user_id, circle.owner_id) as
          | {
              id: string;
              joiner_joined: string;
            }
          | undefined;

        if (!reverseCircle) {
          // 没有找到反向圈子：不是 heal 添加的
          allMembersAreHeal = false;
          break;
        }

        // 检查时间差（heal 应该在几秒内完成）
        const memberJoinedPersonalMs = new Date(member.joined_at).getTime();
        const ownerJoinedReverseMs = new Date(reverseCircle.joiner_joined).getTime();
        const timeDiffSec = Math.abs(memberJoinedPersonalMs - ownerJoinedReverseMs) / 1000;

        if (timeDiffSec > 5) {
          // 时间差太大：不是 heal 添加的
          allMembersAreHeal = false;
          break;
        }
      }

      if (allMembersAreHeal && isLikelyPersonal) {
        // 所有成员都是 heal 添加的，且是用户的第一个圈子：标记为个人空间
        database
          .prepare(`UPDATE circles SET is_personal = 1 WHERE id = ?`)
          .run(circle.id);
        console.log(
          `[migration] ✓ 标记为个人空间: ${circle.id} (owner=${circle.owner_id}，${members.length} 个 heal 成员, first_circle=true)`
        );
      } else {
        // 至少有一个成员是通过邀请加入的，或不是第一个圈子：保持为共享圈
        const reason = !allMembersAreHeal
          ? '有真实邀请成员'
          : '不是第一个圈子(可能手动创建)';
        console.log(
          `[migration] ✗ 保持共享圈: ${circle.id} (owner=${circle.owner_id}，${members.length} 个成员，原因: ${reason})`
        );
      }
    }

    console.log(`[migration] is_personal 回填完成`);
  }

  migrateSchema(database);
}

/** 兼容已有磁盘库：补列不破坏数据 */
function migrateSchema(database: Database.Database): void {
  const shopCols = database
    .prepare(`PRAGMA table_info(shops)`)
    .all() as Array<{ name: string }>;
  if (!shopCols.some((c) => c.name === 'head_img')) {
    database.exec(`ALTER TABLE shops ADD COLUMN head_img TEXT`);
  }
  if (!shopCols.some((c) => c.name === 'phone')) {
    database.exec(`ALTER TABLE shops ADD COLUMN phone TEXT`);
  }

  const favCols = database
    .prepare(`PRAGMA table_info(favorites)`)
    .all() as Array<{ name: string }>;
  if (!favCols.some((c) => c.name === 'photo_url')) {
    database.exec(`ALTER TABLE favorites ADD COLUMN photo_url TEXT`);
  }
  // 心心念念：很想去；导入默认 1，记美食默认 0
  if (!favCols.some((c) => c.name === 'wishlist')) {
    database.exec(
      `ALTER TABLE favorites ADD COLUMN wishlist INTEGER NOT NULL DEFAULT 0`
    );
    // 已有导入收藏视为心心念念
    database.exec(
      `UPDATE favorites SET wishlist = 1 WHERE import_batch_id IS NOT NULL`
    );
  }
  // 从哪位好友那里加进私藏（用于「来自XX」）
  if (!favCols.some((c) => c.name === 'from_user_id')) {
    database.exec(`ALTER TABLE favorites ADD COLUMN from_user_id TEXT`);
  }

  database.exec(`
    CREATE TABLE IF NOT EXISTS agent_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL UNIQUE,
      token_hash TEXT NOT NULL,
      token_prefix TEXT NOT NULL,
      created_at TEXT NOT NULL,
      last_used_at TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    -- 评论流：一人可发多条；旧 favorites.note 迁成首条评论
    CREATE TABLE IF NOT EXISTS shop_comments (
      id TEXT PRIMARY KEY,
      shop_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_shop_comments_shop ON shop_comments(shop_id, created_at);
  `);

  // 一次性：把非空备注迁成评论（用 note 前缀标记避免重复迁）
  const pending = database
    .prepare(
      `SELECT id, user_id, shop_id, note FROM favorites
       WHERE note IS NOT NULL AND note != ''
         AND note NOT LIKE '[migrated]%'`
    )
    .all() as Array<{
    id: string;
    user_id: string;
    shop_id: string;
    note: string;
  }>;
  if (pending.length) {
    const insert = database.prepare(
      `INSERT INTO shop_comments (id, shop_id, user_id, body, created_at)
       VALUES (?, ?, ?, ?, datetime('now'))`
    );
    const mark = database.prepare(
      `UPDATE favorites SET note = ? WHERE id = ?`
    );
    const tx = database.transaction(() => {
      for (const row of pending) {
        insert.run(
          `c_${row.id}`,
          row.shop_id,
          row.user_id,
          row.note.slice(0, 500)
        );
        mark.run(`[migrated]${row.note.slice(0, 180)}`, row.id);
      }
    });
    tx();
  }
}
