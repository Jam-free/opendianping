/**
 * 备份恢复完整集成测试（roundtrip）
 * 
 * 使用明确标注虚构的 fixture 数据进行测试
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import Database from 'better-sqlite3';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TEST_DIR = '/tmp/backup-restore-test';
const FIXTURE_DB = path.join(TEST_DIR, 'fixture.db');
const BACKUP_JSON = path.join(TEST_DIR, 'backup.json');
const RESTORED_DB = path.join(TEST_DIR, 'restored.db');

function setup() {
  // 清理并创建测试目录
  if (fs.existsSync(TEST_DIR)) {
    fs.rmSync(TEST_DIR, { recursive: true });
  }
  fs.mkdirSync(TEST_DIR, { recursive: true });
}

function createFixtureDatabase(): void {
  const db = new Database(FIXTURE_DB);
  
  // 创建表结构（简化版）
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      openid TEXT NOT NULL UNIQUE,
      unionid TEXT,
      nickname TEXT,
      avatar TEXT,
      created_at TEXT NOT NULL
    );
    
    CREATE TABLE IF NOT EXISTS favorites (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      shop_id TEXT NOT NULL,
      note TEXT,
      visibility TEXT NOT NULL DEFAULT 'private',
      wishlist INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
    
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
    
    CREATE TABLE IF NOT EXISTS agent_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      name TEXT,
      created_at TEXT NOT NULL,
      last_used_at TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
    
    CREATE TABLE IF NOT EXISTS shops (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
  
  // 插入虚构测试数据（明确标注）
  const now = new Date().toISOString();
  
  // 正常用户
  db.prepare(`INSERT INTO users (id, openid, nickname, avatar, created_at) VALUES (?, ?, ?, ?, ?)`).run(
    'test-user-1',
    'fixture_openid_alice',
    '[FIXTURE] Alice',
    'https://example.com/alice.jpg',
    now
  );
  
  db.prepare(`INSERT INTO users (id, openid, nickname, avatar, created_at) VALUES (?, ?, ?, ?, ?)`).run(
    'test-user-2',
    'fixture_openid_bob',
    '[FIXTURE] Bob',
    'https://example.com/bob.jpg',
    now
  );
  
  // dev_ 调试用户（应被拒绝）
  db.prepare(`INSERT INTO users (id, openid, nickname, avatar, created_at) VALUES (?, ?, ?, ?, ?)`).run(
    'test-user-dev',
    'dev_test_user',
    '[FIXTURE] Dev User',
    'https://example.com/dev.jpg',
    now
  );
  
  // 店铺
  db.prepare(`INSERT INTO shops (id, name, created_at) VALUES (?, ?, ?)`).run(
    'shop-1',
    '[FIXTURE] Test Shop 1',
    now
  );
  
  db.prepare(`INSERT INTO shops (id, name, created_at) VALUES (?, ?, ?)`).run(
    'shop-2',
    '[FIXTURE] Test Shop 2',
    now
  );
  
  // 收藏（有归属）
  db.prepare(`INSERT INTO favorites (id, user_id, shop_id, note, visibility, wishlist, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
    'fav-1',
    'test-user-1',
    'shop-1',
    'Alice likes shop 1',
    'private',
    0,
    now
  );
  
  db.prepare(`INSERT INTO favorites (id, user_id, shop_id, note, visibility, wishlist, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
    'fav-2',
    'test-user-2',
    'shop-2',
    'Bob likes shop 2',
    'public',
    1,
    now
  );
  
  // dev_ 用户的收藏（应被拒绝）
  db.prepare(`INSERT INTO favorites (id, user_id, shop_id, note, visibility, wishlist, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
    'fav-dev',
    'test-user-dev',
    'shop-1',
    'Dev user favorite',
    'private',
    0,
    now
  );
  
  // 会话（应被导出时排除）
  db.prepare(`INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)`).run(
    'session-1',
    'test-user-1',
    'hash_session_token_alice',
    now,
    new Date(Date.now() + 86400000).toISOString()
  );
  
  // Agent Token（应被导出时排除）
  db.prepare(`INSERT INTO agent_tokens (id, user_id, token_hash, name, created_at, last_used_at) VALUES (?, ?, ?, ?, ?, ?)`).run(
    'token-1',
    'test-user-1',
    'hash_agent_token_alice',
    'Alice Agent Token',
    now,
    now
  );
  
  db.close();
}

function exportDatabase(): void {
  const scriptPath = path.resolve(__dirname, '../scripts/export-db-safe.ts');
  execSync(`npx tsx "${scriptPath}" "${FIXTURE_DB}" "${BACKUP_JSON}"`, {
    stdio: 'pipe',
  });
}

function restoreDryRun(): { output: string; exitCode: number } {
  const scriptPath = path.resolve(__dirname, '../scripts/restore-db-safe.ts');
  try {
    const output = execSync(
      `npx tsx "${scriptPath}" --backup "${BACKUP_JSON}" --target "${RESTORED_DB}"`,
      { encoding: 'utf8', stdio: 'pipe' }
    );
    return { output, exitCode: 0 };
  } catch (err: any) {
    return { output: err.stdout || '', exitCode: err.status || 1 };
  }
}

function restoreConfirm(): { output: string; exitCode: number } {
  const scriptPath = path.resolve(__dirname, '../scripts/restore-db-safe.ts');
  
  // 先创建空数据库（建表）
  const db = new Database(RESTORED_DB);
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      openid TEXT NOT NULL UNIQUE,
      unionid TEXT,
      nickname TEXT,
      avatar TEXT,
      created_at TEXT NOT NULL
    );
    
    CREATE TABLE IF NOT EXISTS favorites (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      shop_id TEXT NOT NULL,
      note TEXT,
      visibility TEXT NOT NULL DEFAULT 'private',
      wishlist INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
  `);
  db.close();
  
  try {
    const output = execSync(
      `npx tsx "${scriptPath}" --backup "${BACKUP_JSON}" --target "${RESTORED_DB}" --confirm`,
      { encoding: 'utf8', stdio: 'pipe' }
    );
    return { output, exitCode: 0 };
  } catch (err: any) {
    return { output: err.stdout || '', exitCode: err.status || 1 };
  }
}

describe('备份恢复集成测试', () => {
  beforeAll(() => {
    setup();
    createFixtureDatabase();
  });

  afterAll(() => {
    // 保留测试目录供调试，测试结束后手动清理
    // if (fs.existsSync(TEST_DIR)) {
    //   fs.rmSync(TEST_DIR, { recursive: true });
    // }
  });

  test('fixture 数据库创建成功', () => {
    expect(fs.existsSync(FIXTURE_DB)).toBe(true);
    
    const db = new Database(FIXTURE_DB, { readonly: true });
    const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get()?.count;
    const favoriteCount = db.prepare('SELECT COUNT(*) as count FROM favorites').get()?.count;
    const sessionCount = db.prepare('SELECT COUNT(*) as count FROM sessions').get()?.count;
    const tokenCount = db.prepare('SELECT COUNT(*) as count FROM agent_tokens').get()?.count;
    db.close();
    
    expect(userCount).toBe(3); // alice, bob, dev
    expect(favoriteCount).toBe(3); // alice, bob, dev 各一个
    expect(sessionCount).toBe(1);
    expect(tokenCount).toBe(1);
  });

  test('导出：排除敏感凭证（sessions、agent_tokens）', () => {
    exportDatabase();
    
    expect(fs.existsSync(BACKUP_JSON)).toBe(true);
    
    const backup = JSON.parse(fs.readFileSync(BACKUP_JSON, 'utf8'));
    
    // 验证导出内容
    expect(backup.users).toBeDefined();
    expect(backup.favorites).toBeDefined();
    expect(backup.users.length).toBe(3);
    expect(backup.favorites.length).toBe(3);
    
    // 验证不包含敏感凭证
    expect(backup.sessions).toBeUndefined();
    expect(backup.agent_tokens).toBeUndefined();
  });

  test('dry-run：不写入，仅预览', () => {
    const result = restoreDryRun();
    
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('DRY-RUN');
    expect(result.output).toContain('用户恢复');
    expect(result.output).toContain('收藏恢复');
    
    // 验证没有创建目标数据库
    expect(fs.existsSync(RESTORED_DB)).toBe(false);
  });

  test('dry-run：拒绝 dev_ 账号', () => {
    const result = restoreDryRun();
    
    expect(result.output).toContain('dev_test_user');
    expect(result.output).toContain('dev_ 调试账号，禁止恢复');
  });

  test('dry-run：拒绝 dev_ 用户的收藏', () => {
    const result = restoreDryRun();
    
    expect(result.output).toContain('属于 dev_ 账号');
  });

  test('确认恢复：实际写入', () => {
    const result = restoreConfirm();
    
    expect(result.exitCode).toBe(0);
    expect(result.output).not.toContain('DRY-RUN');
    
    // 验证数据库已创建
    expect(fs.existsSync(RESTORED_DB)).toBe(true);
    
    const db = new Database(RESTORED_DB, { readonly: true });
    const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get()?.count;
    const favoriteCount = db.prepare('SELECT COUNT(*) as count FROM favorites').get()?.count;
    db.close();
    
    // 只恢复非 dev_ 用户
    expect(userCount).toBe(2); // alice, bob (dev 被拒绝)
    expect(favoriteCount).toBe(2); // alice, bob 的收藏 (dev 被拒绝)
  });

  test('重复恢复：幂等，跳过已存在', () => {
    // 第二次恢复（数据已存在）
    const result = restoreConfirm();
    
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('跳过');
    
    const db = new Database(RESTORED_DB, { readonly: true });
    const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get()?.count;
    const favoriteCount = db.prepare('SELECT COUNT(*) as count FROM favorites').get()?.count;
    db.close();
    
    // 数据没有重复
    expect(userCount).toBe(2);
    expect(favoriteCount).toBe(2);
  });

  test('恢复后验证：openid 正确', () => {
    const db = new Database(RESTORED_DB, { readonly: true });
    const users = db.prepare('SELECT openid FROM users ORDER BY openid').all();
    db.close();
    
    expect(users.length).toBe(2);
    expect(users[0].openid).toBe('fixture_openid_alice');
    expect(users[1].openid).toBe('fixture_openid_bob');
  });

  test('恢复后验证：收藏归属正确', () => {
    const db = new Database(RESTORED_DB, { readonly: true });
    const favorites = db.prepare(`
      SELECT f.id, u.openid 
      FROM favorites f 
      JOIN users u ON f.user_id = u.id 
      ORDER BY f.id
    `).all();
    db.close();
    
    expect(favorites.length).toBe(2);
    expect(favorites[0].openid).toBe('fixture_openid_alice');
    expect(favorites[1].openid).toBe('fixture_openid_bob');
  });

  test('坏备份：缺少 users 字段', () => {
    const badBackupPath = path.join(TEST_DIR, 'bad-backup.json');
    fs.writeFileSync(badBackupPath, JSON.stringify({
      exportedAt: new Date().toISOString(),
      favorites: []
    }));
    
    const scriptPath = path.resolve(__dirname, '../scripts/restore-db-safe.ts');
    
    try {
      execSync(
        `npx tsx "${scriptPath}" --backup "${badBackupPath}" --target "${RESTORED_DB}"`,
        { encoding: 'utf8', stdio: 'pipe' }
      );
      fail('应该抛出错误');
    } catch (err: any) {
      // 预期会失败
      expect(err.status).not.toBe(0);
    }
  });

  test('WAL 模式：fixture 数据库使用 WAL', () => {
    const db = new Database(FIXTURE_DB, { readonly: true });
    const journalMode = db.pragma('journal_mode', { simple: true });
    db.close();
    
    // better-sqlite3 默认使用 WAL
    expect(journalMode).toBe('wal');
  });

  test('WAL checkpoint：导出后 WAL 文件应该很小', () => {
    const walPath = FIXTURE_DB + '-wal';
    
    // 导出后 WAL 文件应该很小或不存在
    if (fs.existsSync(walPath)) {
      const stat = fs.statSync(walPath);
      expect(stat.size).toBeLessThan(1000); // WAL 应该已 checkpoint
    }
  });
});
