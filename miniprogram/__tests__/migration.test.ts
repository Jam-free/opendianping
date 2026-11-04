import { describe, it, expect, beforeEach } from '@jest/globals';
import Database from 'better-sqlite3';

/**
 * 测试 is_personal 列的迁移和回填逻辑
 */
describe('is_personal migration and backfill', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    
    // 创建初始架构（没有 is_personal 列）
    db.exec(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        openid TEXT NOT NULL UNIQUE,
        nickname TEXT,
        avatar TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE circles (
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

      CREATE TABLE circle_members (
        circle_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        role TEXT NOT NULL,
        joined_at TEXT NOT NULL,
        PRIMARY KEY (circle_id, user_id),
        FOREIGN KEY (circle_id) REFERENCES circles(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id)
      );
    `);
  });

  it('应该标记只有圈主一人的「我的美食网」为个人空间', () => {
    // 创建用户 A
    db.prepare(`INSERT INTO users (id, openid, nickname, created_at) VALUES (?, ?, ?, datetime('now'))`)
      .run('user-a', 'openid-a', 'Alice');
    
    // 创建 A 的个人空间，只有圈主
    db.prepare(`INSERT INTO circles (id, name, owner_id, invite_token, token_expires_at, created_at) 
                VALUES (?, ?, ?, ?, ?, datetime('now'))`)
      .run('circle-a-personal', '我的美食网', 'user-a', 'token-a', '2099-01-01');
    
    // 圈主作为成员
    db.prepare(`INSERT INTO circle_members (circle_id, user_id, role, joined_at) 
                VALUES (?, ?, ?, datetime('now'))`)
      .run('circle-a-personal', 'user-a', 'owner');

    // 运行迁移
    db.exec(`ALTER TABLE circles ADD COLUMN is_personal INTEGER;`);
    db.exec(`
      UPDATE circles SET is_personal = 1 
      WHERE name = '我的美食网'
        AND owner_id IS NOT NULL
        AND (SELECT COUNT(*) FROM circle_members cm 
             WHERE cm.circle_id = circles.id 
               AND cm.user_id != circles.owner_id) = 0;
    `);

    // 验证：应该被标记为个人空间
    const circle = db.prepare('SELECT is_personal FROM circles WHERE id = ?').get('circle-a-personal') as { is_personal: number };
    expect(circle.is_personal).toBe(1);
  });

  it('不应该标记已有其他成员的「我的美食网」为个人空间', () => {
    // 创建用户 A、B、C
    db.prepare(`INSERT INTO users (id, openid, nickname, created_at) VALUES (?, ?, ?, datetime('now'))`)
      .run('user-a', 'openid-a', 'Alice');
    db.prepare(`INSERT INTO users (id, openid, nickname, created_at) VALUES (?, ?, ?, datetime('now'))`)
      .run('user-b', 'openid-b', 'Bob');
    db.prepare(`INSERT INTO users (id, openid, nickname, created_at) VALUES (?, ?, ?, datetime('now'))`)
      .run('user-c', 'openid-c', 'Carol');
    
    // 创建 A 的「我的美食网」，但 B 和 C 已经加入（生产环境的旧邀请链接场景）
    db.prepare(`INSERT INTO circles (id, name, owner_id, invite_token, token_expires_at, created_at) 
                VALUES (?, ?, ?, ?, ?, datetime('now'))`)
      .run('circle-a-shared', '我的美食网', 'user-a', 'token-a', '2099-01-01');
    
    // A 作为圈主
    db.prepare(`INSERT INTO circle_members (circle_id, user_id, role, joined_at) 
                VALUES (?, ?, ?, datetime('now'))`)
      .run('circle-a-shared', 'user-a', 'owner');
    
    // B 和 C 作为成员
    db.prepare(`INSERT INTO circle_members (circle_id, user_id, role, joined_at) 
                VALUES (?, ?, ?, datetime('now'))`)
      .run('circle-a-shared', 'user-b', 'member');
    db.prepare(`INSERT INTO circle_members (circle_id, user_id, role, joined_at) 
                VALUES (?, ?, ?, datetime('now'))`)
      .run('circle-a-shared', 'user-c', 'member');

    // 运行迁移
    db.exec(`ALTER TABLE circles ADD COLUMN is_personal INTEGER;`);
    db.exec(`
      UPDATE circles SET is_personal = 1 
      WHERE name = '我的美食网'
        AND owner_id IS NOT NULL
        AND (SELECT COUNT(*) FROM circle_members cm 
             WHERE cm.circle_id = circles.id 
               AND cm.user_id != circles.owner_id) = 0;
    `);

    // 验证：不应该被标记为个人空间（应该是 0 或 NULL）
    const circle = db.prepare('SELECT is_personal FROM circles WHERE id = ?').get('circle-a-shared') as { is_personal: number | null };
    expect(circle.is_personal).not.toBe(1);
  });

  it('应该标记没有任何成员记录的「我的美食网」为个人空间', () => {
    // 创建用户 D
    db.prepare(`INSERT INTO users (id, openid, nickname, created_at) VALUES (?, ?, ?, datetime('now'))`)
      .run('user-d', 'openid-d', 'David');
    
    // 创建 D 的个人空间，circle_members 中没有任何记录（可能是旧数据）
    db.prepare(`INSERT INTO circles (id, name, owner_id, invite_token, token_expires_at, created_at) 
                VALUES (?, ?, ?, ?, ?, datetime('now'))`)
      .run('circle-d-empty', '我的美食网', 'user-d', 'token-d', '2099-01-01');

    // 运行迁移
    db.exec(`ALTER TABLE circles ADD COLUMN is_personal INTEGER;`);
    db.exec(`
      UPDATE circles SET is_personal = 1 
      WHERE name = '我的美食网'
        AND owner_id IS NOT NULL
        AND (SELECT COUNT(*) FROM circle_members cm 
             WHERE cm.circle_id = circles.id 
               AND cm.user_id != circles.owner_id) = 0;
    `);

    // 验证：应该被标记为个人空间
    const circle = db.prepare('SELECT is_personal FROM circles WHERE id = ?').get('circle-d-empty') as { is_personal: number };
    expect(circle.is_personal).toBe(1);
  });

  it('不应该标记名字不是「我的美食网」的圈子', () => {
    // 创建用户 E
    db.prepare(`INSERT INTO users (id, openid, nickname, created_at) VALUES (?, ?, ?, datetime('now'))`)
      .run('user-e', 'openid-e', 'Eve');
    
    // 创建普通共享圈子
    db.prepare(`INSERT INTO circles (id, name, owner_id, invite_token, token_expires_at, created_at) 
                VALUES (?, ?, ?, ?, ?, datetime('now'))`)
      .run('circle-e-shared', '周末吃啥', 'user-e', 'token-e', '2099-01-01');
    
    // 只有圈主
    db.prepare(`INSERT INTO circle_members (circle_id, user_id, role, joined_at) 
                VALUES (?, ?, ?, datetime('now'))`)
      .run('circle-e-shared', 'user-e', 'owner');

    // 运行迁移
    db.exec(`ALTER TABLE circles ADD COLUMN is_personal INTEGER;`);
    db.exec(`
      UPDATE circles SET is_personal = 1 
      WHERE name = '我的美食网'
        AND owner_id IS NOT NULL
        AND (SELECT COUNT(*) FROM circle_members cm 
             WHERE cm.circle_id = circles.id 
               AND cm.user_id != circles.owner_id) = 0;
    `);

    // 验证：不应该被标记为个人空间
    const circle = db.prepare('SELECT is_personal FROM circles WHERE id = ?').get('circle-e-shared') as { is_personal: number | null };
    expect(circle.is_personal).not.toBe(1);
  });
});
