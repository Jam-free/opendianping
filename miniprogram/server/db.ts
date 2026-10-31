import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { config } from './config.js';
import {
  assessProductionPersistence,
  formatPersistenceWarning,
  isCloudRunDataPath,
  looksLikeEphemeralDataMount,
  PERSISTENCE_LOG_PREFIX,
  readPersistenceCounts,
  type PersistenceHealth,
} from './persistence.js';

let db: Database.Database | null = null;
let openedDbPath: string = config.dbPath;
let lastPersistenceWarning: string | null = null;

export type OpenDatabaseOptions = {
  /**
   * 测试用：把任意临时路径当成云托管 /data 来验证告警。
   * 生产代码不要传。
   */
  treatAsCloudData?: boolean;
  /** 测试用：覆盖「持久盘根目录」，默认 /data */
  volumeRoot?: string;
  logger?: Pick<Console, 'error'>;
};

/**
 * 打开 SQLite。Agent Token 和收藏都在这一个文件里，不要拆库。
 * 产品意图：换镜像只换代码，盘上的「连接 AI」口令和我的店必须还在。
 */
export function openDatabase(
  dbPath: string = config.dbPath,
  options: OpenDatabaseOptions = {}
): Database.Database {
  const logger = options.logger ?? console;
  const cloudDataPath =
    dbPath !== ':memory:' &&
    (options.treatAsCloudData === true || isCloudRunDataPath(dbPath));

  let createdNewFile = false;
  let ephemeralMount = false;

  if (dbPath !== ':memory:') {
    // 必须先看盘再 mkdir：缺 /data 时 mkdir 会在镜像可写层「成功」，看起来像挂了盘。
    if (cloudDataPath) {
      ephemeralMount = looksLikeEphemeralDataMount(
        options.volumeRoot ?? '/data'
      );
    }
    createdNewFile = !fs.existsSync(dbPath);
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }

  const database = new Database(dbPath);
  database.pragma('journal_mode = WAL');
  database.pragma('foreign_keys = ON');
  initSchema(database);

  const counts = readPersistenceCounts(database);
  const signals = {
    dbPath,
    cloudDataPath,
    createdNewFile,
    ephemeralMount,
    ...counts,
  };
  const assessment = assessProductionPersistence(signals);
  lastPersistenceWarning = assessment.shouldWarn
    ? formatPersistenceWarning(signals, assessment.reasons)
    : null;
  openedDbPath = dbPath;
  if (lastPersistenceWarning) {
    logger.error(lastPersistenceWarning);
  }
  return database;
}

export function getDb(): Database.Database {
  if (!db) db = openDatabase();
  return db;
}

export function getOpenedDbPath(): string {
  return openedDbPath;
}

export function getLastPersistenceWarning(): string | null {
  return lastPersistenceWarning;
}

/**
 * GET /health 用的只读计数。库打不开时进程仍应活着，把错误放进 JSON。
 */
export function getPersistenceHealth(): PersistenceHealth {
  try {
    const database = getDb();
    const counts = readPersistenceCounts(database);
    return {
      dbPath: openedDbPath,
      agentTokenCount: counts.agentTokenCount,
      favoriteCount: counts.favoriteCount,
      userCount: counts.userCount,
      warning: lastPersistenceWarning,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      `${PERSISTENCE_LOG_PREFIX} health 无法读取数据库计数: ${message}`
    );
    return {
      dbPath: openedDbPath || config.dbPath,
      agentTokenCount: null,
      favoriteCount: null,
      userCount: null,
      warning: lastPersistenceWarning,
      error: message,
    };
  }
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
  lastPersistenceWarning = null;
  db = database || openDatabase(':memory:');
  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}

/**
 * 只建表、补索引。禁止在启动时 DROP / DELETE agent_tokens 或 favorites。
 * Token 只能由用户点「连接 AI」（POST /api/agent-tokens 或 /reset）重置。
 */
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
  migrateSchema(database);
}

/**
 * 兼容已有磁盘库：只 ADD COLUMN / CREATE TABLE IF NOT EXISTS。
 * 不要 DROP TABLE，也不要 DELETE FROM agent_tokens / favorites。
 */
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
