import type { MiniDatabase } from './types.js';

/**
 * 业务表必须两边对齐：users / shops / favorites / agent_tokens / sessions 等。
 * MySQL 时间列用 VARCHAR 存 ISO 字符串，和现有 SQLite、COS JSON 备份同一形状，避免 DATETIME 时区把恢复弄乱。
 */

export const SQLITE_SCHEMA_SQL = `
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

    CREATE TABLE IF NOT EXISTS shop_comments (
      id TEXT PRIMARY KEY,
      shop_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_favorites_user ON favorites(user_id);
    CREATE INDEX IF NOT EXISTS idx_favorites_visibility ON favorites(visibility);
    CREATE INDEX IF NOT EXISTS idx_shops_source ON shops(source_shop_id);
    CREATE INDEX IF NOT EXISTS idx_shops_amap ON shops(amap_poi_id);
    CREATE INDEX IF NOT EXISTS idx_circle_members_user ON circle_members(user_id);
    CREATE INDEX IF NOT EXISTS idx_shop_comments_shop ON shop_comments(shop_id, created_at);
`;

const MYSQL_TABLE_SQL: string[] = [
  `CREATE TABLE IF NOT EXISTS users (
      id VARCHAR(64) NOT NULL,
      openid VARCHAR(191) NOT NULL,
      unionid VARCHAR(191) NULL,
      nickname TEXT NULL,
      avatar TEXT NULL,
      created_at VARCHAR(40) NOT NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uk_users_openid (openid)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS sessions (
      token VARCHAR(64) NOT NULL,
      user_id VARCHAR(64) NOT NULL,
      created_at VARCHAR(40) NOT NULL,
      PRIMARY KEY (token),
      KEY idx_sessions_user (user_id),
      CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS shops (
      id VARCHAR(64) NOT NULL,
      source_type VARCHAR(32) NOT NULL,
      source_shop_id VARCHAR(191) NULL,
      amap_poi_id VARCHAR(191) NULL,
      raw_name TEXT NOT NULL,
      adcode VARCHAR(32) NULL,
      category TEXT NULL,
      district TEXT NULL,
      city VARCHAR(64) NULL,
      address TEXT NULL,
      avg_price VARCHAR(64) NULL,
      lat DOUBLE NULL,
      lng DOUBLE NULL,
      source_url TEXT NULL,
      head_img TEXT NULL,
      phone VARCHAR(64) NULL,
      display_cache_policy VARCHAR(32) NOT NULL DEFAULT 'minimal',
      PRIMARY KEY (id),
      KEY idx_shops_source (source_shop_id),
      KEY idx_shops_amap (amap_poi_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS import_batches (
      id VARCHAR(64) NOT NULL,
      user_id VARCHAR(64) NOT NULL,
      source_type VARCHAR(32) NOT NULL,
      source_url TEXT NULL,
      albumid VARCHAR(64) NULL,
      status VARCHAR(32) NOT NULL,
      counts TEXT NOT NULL,
      created_at VARCHAR(40) NOT NULL,
      PRIMARY KEY (id),
      KEY idx_import_batches_user (user_id),
      CONSTRAINT fk_import_batches_user FOREIGN KEY (user_id) REFERENCES users(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS favorites (
      id VARCHAR(64) NOT NULL,
      user_id VARCHAR(64) NOT NULL,
      shop_id VARCHAR(64) NOT NULL,
      note TEXT NULL,
      visibility VARCHAR(32) NOT NULL DEFAULT 'private',
      import_batch_id VARCHAR(64) NULL,
      created_at VARCHAR(40) NOT NULL,
      photo_url TEXT NULL,
      wishlist TINYINT(1) NOT NULL DEFAULT 0,
      from_user_id VARCHAR(64) NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uk_favorites_user_shop (user_id, shop_id),
      KEY idx_favorites_user (user_id),
      KEY idx_favorites_visibility (visibility),
      CONSTRAINT fk_favorites_user FOREIGN KEY (user_id) REFERENCES users(id),
      CONSTRAINT fk_favorites_shop FOREIGN KEY (shop_id) REFERENCES shops(id),
      CONSTRAINT fk_favorites_batch FOREIGN KEY (import_batch_id) REFERENCES import_batches(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS circles (
      id VARCHAR(64) NOT NULL,
      name TEXT NOT NULL,
      owner_id VARCHAR(64) NOT NULL,
      invite_token VARCHAR(64) NOT NULL,
      token_expires_at VARCHAR(40) NOT NULL,
      opengid VARCHAR(191) NULL,
      member_limit INT NOT NULL DEFAULT 200,
      is_personal TINYINT(1) NULL,
      created_at VARCHAR(40) NOT NULL,
      PRIMARY KEY (id),
      KEY idx_circles_owner (owner_id),
      CONSTRAINT fk_circles_owner FOREIGN KEY (owner_id) REFERENCES users(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS circle_members (
      circle_id VARCHAR(64) NOT NULL,
      user_id VARCHAR(64) NOT NULL,
      role VARCHAR(32) NOT NULL,
      joined_at VARCHAR(40) NOT NULL,
      PRIMARY KEY (circle_id, user_id),
      KEY idx_circle_members_user (user_id),
      CONSTRAINT fk_circle_members_circle FOREIGN KEY (circle_id) REFERENCES circles(id) ON DELETE CASCADE,
      CONSTRAINT fk_circle_members_user FOREIGN KEY (user_id) REFERENCES users(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS circle_shares (
      circle_id VARCHAR(64) NOT NULL,
      favorite_id VARCHAR(64) NOT NULL,
      PRIMARY KEY (circle_id, favorite_id),
      CONSTRAINT fk_circle_shares_circle FOREIGN KEY (circle_id) REFERENCES circles(id) ON DELETE CASCADE,
      CONSTRAINT fk_circle_shares_fav FOREIGN KEY (favorite_id) REFERENCES favorites(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS agent_tokens (
      id VARCHAR(64) NOT NULL,
      user_id VARCHAR(64) NOT NULL,
      token_hash VARCHAR(128) NOT NULL,
      token_prefix VARCHAR(32) NOT NULL,
      created_at VARCHAR(40) NOT NULL,
      last_used_at VARCHAR(40) NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uk_agent_tokens_user (user_id),
      CONSTRAINT fk_agent_tokens_user FOREIGN KEY (user_id) REFERENCES users(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS shop_comments (
      id VARCHAR(64) NOT NULL,
      shop_id VARCHAR(64) NOT NULL,
      user_id VARCHAR(64) NOT NULL,
      body TEXT NOT NULL,
      created_at VARCHAR(40) NOT NULL,
      PRIMARY KEY (id),
      KEY idx_shop_comments_shop (shop_id, created_at),
      CONSTRAINT fk_shop_comments_shop FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE,
      CONSTRAINT fk_shop_comments_user FOREIGN KEY (user_id) REFERENCES users(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
];

export const MYSQL_SCHEMA_STATEMENTS = MYSQL_TABLE_SQL;

export const MYSQL_SCHEMA_SQL = MYSQL_TABLE_SQL.map((s) => `${s};`).join('\n\n');

function tableColumns(database: MiniDatabase, table: string): Set<string> {
  const rows = database.pragma(`table_info(${table})`) as Array<{ name: string }>;
  return new Set((rows || []).map((r) => r.name));
}

function addColumnIfMissing(
  database: MiniDatabase,
  table: string,
  column: string,
  ddl: string
): boolean {
  const cols = tableColumns(database, table);
  if (cols.has(column)) return false;
  database.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  return true;
}

/**
 * 只 ADD COLUMN / CREATE TABLE IF NOT EXISTS。
 * 禁止 DROP TABLE，也不要 DELETE FROM agent_tokens / favorites。
 */
export function applySchema(database: MiniDatabase): void {
  if (database.dialect === 'mysql') {
    for (const stmt of MYSQL_TABLE_SQL) {
      database.exec(stmt);
    }
  } else {
    database.exec(SQLITE_SCHEMA_SQL);
  }

  addColumnIfMissing(database, 'circles', 'is_personal', 'is_personal INTEGER');
  database.exec(`UPDATE circles SET is_personal = 1 WHERE name = '我的美食网' AND (is_personal IS NULL)`);

  addColumnIfMissing(database, 'shops', 'head_img', 'head_img TEXT');
  addColumnIfMissing(database, 'shops', 'phone', 'phone TEXT');
  addColumnIfMissing(database, 'favorites', 'photo_url', 'photo_url TEXT');

  if (addColumnIfMissing(database, 'favorites', 'wishlist', 'wishlist INTEGER NOT NULL DEFAULT 0')) {
    database.exec(
      `UPDATE favorites SET wishlist = 1 WHERE import_batch_id IS NOT NULL`
    );
  }
  addColumnIfMissing(database, 'favorites', 'from_user_id', 'from_user_id TEXT');

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
    const mark = database.prepare(`UPDATE favorites SET note = ? WHERE id = ?`);
    const tx = database.transaction(() => {
      for (const row of pending) {
        insert.run(`c_${row.id}`, row.shop_id, row.user_id, row.note.slice(0, 500));
        mark.run(`[migrated]${row.note.slice(0, 180)}`, row.id);
      }
    });
    tx();
  }
}

export const BUSINESS_TABLES = [
  'users',
  'shops',
  'sessions',
  'import_batches',
  'circles',
  'favorites',
  'circle_members',
  'circle_shares',
  'agent_tokens',
  'shop_comments',
] as const;
