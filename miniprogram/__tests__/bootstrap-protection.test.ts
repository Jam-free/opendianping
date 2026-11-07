/**
 * Bootstrap 启动保护测试
 * 
 * 测试场景：
 * - EXPECTED_MIN_USERS=0（新环境首次部署）
 * - 缺省（疑似数据丢失）
 * - 生产阈值（确认数据丢失）
 * - 合法0收藏账号
 * - 保留 users 但丢 favorites（部分数据丢失）
 */

import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

const TEST_DIR = '/tmp/bootstrap-test';
const TEST_DB = path.join(TEST_DIR, 'test.db');

function setup() {
  if (fs.existsSync(TEST_DIR)) {
    fs.rmSync(TEST_DIR, { recursive: true });
  }
  fs.mkdirSync(TEST_DIR, { recursive: true });
}

function createEmptyDatabase(): void {
  const db = new Database(TEST_DB);
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      openid TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL
    );
    
    CREATE TABLE IF NOT EXISTS favorites (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      shop_id TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    
    CREATE TABLE IF NOT EXISTS agent_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL
    );
  `);
  db.close();
}

function createDatabaseWithUsers(userCount: number, favoriteCount: number): void {
  const db = new Database(TEST_DB);
  const now = new Date().toISOString();
  
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      openid TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL
    );
    
    CREATE TABLE IF NOT EXISTS favorites (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      shop_id TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    
    CREATE TABLE IF NOT EXISTS agent_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL
    );
  `);
  
  // 插入用户
  const insertUser = db.prepare('INSERT INTO users (id, openid, created_at) VALUES (?, ?, ?)');
  for (let i = 0; i < userCount; i++) {
    insertUser.run(`user-${i}`, `openid_${i}`, now);
  }
  
  // 插入收藏
  const insertFavorite = db.prepare('INSERT INTO favorites (id, user_id, shop_id, created_at) VALUES (?, ?, ?, ?)');
  for (let i = 0; i < favoriteCount; i++) {
    const userId = `user-${i % userCount}`;
    insertFavorite.run(`fav-${i}`, userId, `shop-${i}`, now);
  }
  
  db.close();
}

function checkPersistence(dbPath: string): {
  userCount: number;
  favoriteCount: number;
  agentTokenCount: number;
  isEmpty: boolean;
} {
  const db = new Database(dbPath, { readonly: true });
  
  const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get()?.count ?? 0;
  const favoriteCount = db.prepare('SELECT COUNT(*) as count FROM favorites').get()?.count ?? 0;
  const agentTokenCount = db.prepare('SELECT COUNT(*) as count FROM agent_tokens').get()?.count ?? 0;
  
  db.close();
  
  return {
    userCount,
    favoriteCount,
    agentTokenCount,
    isEmpty: userCount === 0 && favoriteCount === 0 && agentTokenCount === 0,
  };
}

function shouldBlockStartup(
  health: ReturnType<typeof checkPersistence>,
  expectedMinUsers: number
): { block: boolean; reason: string } {
  // 新环境 bootstrap（EXPECTED_MIN_USERS=0）
  if (expectedMinUsers === 0) {
    return { block: false, reason: '新环境 bootstrap，允许空库' };
  }
  
  // 完全空库
  if (health.isEmpty) {
    if (expectedMinUsers < 0) {
      return { block: true, reason: '完全空库，疑似数据丢失' };
    }
    return { block: false, reason: '完全空库但期望为0' };
  }
  
  // 用户数低于期望
  if (expectedMinUsers > 0 && health.userCount < expectedMinUsers) {
    return { block: true, reason: `用户数 ${health.userCount} 低于期望 ${expectedMinUsers}` };
  }
  
  // 部分数据丢失检测（警告但不致命）
  if (health.userCount > 10 && health.favoriteCount === 0) {
    return { block: false, reason: `警告：用户数 ${health.userCount} 但收藏数为0` };
  }
  
  return { block: false, reason: '检查通过' };
}

describe('Bootstrap 启动保护', () => {
  beforeAll(() => {
    setup();
  });

  beforeEach(() => {
    // 每个测试前删除数据库文件
    if (fs.existsSync(TEST_DB)) {
      fs.unlinkSync(TEST_DB);
    }
  });

  afterAll(() => {
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true });
    }
  });

  describe('EXPECTED_MIN_USERS=0（新环境首次部署）', () => {
    test('允许空库启动', () => {
      createEmptyDatabase();
      const health = checkPersistence(TEST_DB);
      const result = shouldBlockStartup(health, 0);
      
      expect(result.block).toBe(false);
      expect(result.reason).toContain('新环境 bootstrap');
    });
  });

  describe('缺省 EXPECTED_MIN_USERS（未设置）', () => {
    test('完全空库：拒绝启动', () => {
      createEmptyDatabase();
      const health = checkPersistence(TEST_DB);
      const result = shouldBlockStartup(health, -1);
      
      expect(result.block).toBe(true);
      expect(result.reason).toContain('疑似数据丢失');
    });

    test('有用户：允许启动', () => {
      createDatabaseWithUsers(5, 10);
      const health = checkPersistence(TEST_DB);
      const result = shouldBlockStartup(health, -1);
      
      expect(result.block).toBe(false);
    });

    test('有用户但收藏为0（<=10用户）：允许启动', () => {
      createDatabaseWithUsers(5, 0);
      const health = checkPersistence(TEST_DB);
      const result = shouldBlockStartup(health, -1);
      
      expect(result.block).toBe(false);
      expect(result.reason).toContain('检查通过');
    });

    test('有用户但收藏为0（>10用户）：警告但不阻塞', () => {
      createDatabaseWithUsers(15, 0);
      const health = checkPersistence(TEST_DB);
      const result = shouldBlockStartup(health, -1);
      
      expect(result.block).toBe(false);
      expect(result.reason).toContain('警告');
      expect(result.reason).toContain('收藏数为0');
    });
  });

  describe('生产阈值（EXPECTED_MIN_USERS > 0）', () => {
    test('用户数低于阈值：拒绝启动', () => {
      createDatabaseWithUsers(50, 100);
      const health = checkPersistence(TEST_DB);
      const result = shouldBlockStartup(health, 100);
      
      expect(result.block).toBe(true);
      expect(result.reason).toContain('低于期望 100');
    });

    test('用户数达到阈值：允许启动', () => {
      createDatabaseWithUsers(100, 200);
      const health = checkPersistence(TEST_DB);
      const result = shouldBlockStartup(health, 100);
      
      expect(result.block).toBe(false);
    });
  });

  describe('合法0收藏账号', () => {
    test('新注册用户无收藏：不应拒绝', () => {
      createDatabaseWithUsers(3, 0);
      const health = checkPersistence(TEST_DB);
      const result = shouldBlockStartup(health, -1);
      
      expect(result.block).toBe(false);
    });
  });

  describe('部分数据丢失（保留 users 但丢 favorites）', () => {
    test('>10用户但收藏全部丢失：警告但不阻塞', () => {
      createDatabaseWithUsers(50, 0);
      const health = checkPersistence(TEST_DB);
      const result = shouldBlockStartup(health, -1);
      
      expect(result.block).toBe(false);
      expect(result.reason).toContain('警告');
    });

    test('设置阈值后：仍然允许（只检查用户数）', () => {
      createDatabaseWithUsers(100, 0);
      const health = checkPersistence(TEST_DB);
      const result = shouldBlockStartup(health, 100);
      
      expect(result.block).toBe(false);
    });
  });
});

describe('门禁局限性说明', () => {
  test('用户数量阈值不能检测部分收藏丢失', () => {
    // 场景：100用户，原有200收藏，现在只剩50收藏
    createDatabaseWithUsers(100, 50);
    const health = checkPersistence(TEST_DB);
    const result = shouldBlockStartup(health, 100);
    
    // 门禁通过（因为用户数达标）
    expect(result.block).toBe(false);
    
    // 但实际上收藏数量减少了（150个丢失）
    // 门禁无法检测这种情况
  });

  test('用户数量阈值不能检测单个用户的数据丢失', () => {
    // 场景：某个用户的所有收藏丢失，但总用户数不变
    createDatabaseWithUsers(100, 100);
    const health = checkPersistence(TEST_DB);
    const result = shouldBlockStartup(health, 100);
    
    // 门禁通过
    expect(result.block).toBe(false);
    
    // 但某些用户的收藏可能已丢失
    // 门禁只能检测总量异常，不能检测个体数据丢失
  });

  test('合法的零收藏账号和数据丢失难以区分', () => {
    // 场景：一个用户确实没有收藏（新用户）
    // vs 一个用户的收藏被删除了
    // 门禁无法区分这两种情况
    
    createDatabaseWithUsers(1, 0);
    const health = checkPersistence(TEST_DB);
    const result = shouldBlockStartup(health, -1);
    
    // 门禁允许（认为是合法的新用户）
    expect(result.block).toBe(false);
    
    // 但也可能是数据丢失
  });
});

describe('保守阻塞策略', () => {
  test('疑似数据丢失：应该阻塞发布', () => {
    createEmptyDatabase();
    const health = checkPersistence(TEST_DB);
    const result = shouldBlockStartup(health, -1);
    
    // 保守策略：宁可误报，不可漏报
    expect(result.block).toBe(true);
  });

  test('无法确认数据完整性：应该阻塞', () => {
    // 如果不能100%确认数据完整，应该阻塞
    createDatabaseWithUsers(5, 0);
    const health = checkPersistence(TEST_DB);
    
    // 设置一个不合理的高阈值
    const result = shouldBlockStartup(health, 1000);
    
    expect(result.block).toBe(true);
  });
});
