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
    
    // 创建 A 的个人空间（第一个圈子），只有圈主
    db.prepare(`INSERT INTO circles (id, name, owner_id, invite_token, token_expires_at, created_at) 
                VALUES (?, ?, ?, ?, ?, datetime('now'))`)
      .run('circle-a-personal', '我的美食网', 'user-a', 'token-a', '2099-01-01');
    
    // 圈主作为成员
    db.prepare(`INSERT INTO circle_members (circle_id, user_id, role, joined_at) 
                VALUES (?, ?, ?, datetime('now'))`)
      .run('circle-a-personal', 'user-a', 'owner');

    // 运行迁移
    runMigration(db);

    // 验证：应该被标记为个人空间
    const circle = db.prepare('SELECT is_personal FROM circles WHERE id = ?').get('circle-a-personal') as { is_personal: number };
    expect(circle.is_personal).toBe(1);
  });

  it('不应该标记已有真实邀请成员的「我的美食网」为个人空间', () => {
    // 创建用户 A、B、C
    db.prepare(`INSERT INTO users (id, openid, nickname, created_at) VALUES (?, ?, ?, datetime('now'))`)
      .run('user-a', 'openid-a', 'Alice');
    db.prepare(`INSERT INTO users (id, openid, nickname, created_at) VALUES (?, ?, ?, datetime('now'))`)
      .run('user-b', 'openid-b', 'Bob');
    db.prepare(`INSERT INTO users (id, openid, nickname, created_at) VALUES (?, ?, ?, datetime('now'))`)
      .run('user-c', 'openid-c', 'Carol');
    
    // 创建 A 的「我的美食网」，但 B 和 C 通过邀请加入
    db.prepare(`INSERT INTO circles (id, name, owner_id, invite_token, token_expires_at, created_at) 
                VALUES (?, ?, ?, ?, ?, datetime('now'))`)
      .run('circle-a-shared', '我的美食网', 'user-a', 'token-a', '2099-01-01');
    
    // A 作为圈主
    db.prepare(`INSERT INTO circle_members (circle_id, user_id, role, joined_at) 
                VALUES (?, ?, ?, datetime('now'))`)
      .run('circle-a-shared', 'user-a', 'owner');
    
    // B 和 C 作为成员（通过邀请加入，不是 heal）
    db.prepare(`INSERT INTO circle_members (circle_id, user_id, role, joined_at) 
                VALUES (?, ?, ?, datetime('now', '+10 seconds'))`)
      .run('circle-a-shared', 'user-b', 'member');
    db.prepare(`INSERT INTO circle_members (circle_id, user_id, role, joined_at) 
                VALUES (?, ?, ?, datetime('now', '+20 seconds'))`)
      .run('circle-a-shared', 'user-c', 'member');

    // 运行迁移
    runMigration(db);

    // 验证：不应该被标记为个人空间
    const circle = db.prepare('SELECT is_personal FROM circles WHERE id = ?').get('circle-a-shared') as { is_personal: number | null };
    expect(circle.is_personal).not.toBe(1);
  });

  it('应该标记只有 heal 添加成员的「我的美食网」为个人空间', () => {
    const now = new Date().toISOString();
    
    // 创建用户 X 和 M
    db.prepare(`INSERT INTO users (id, openid, nickname, created_at) VALUES (?, ?, ?, ?)`)
      .run('user-x', 'openid-x', 'X', now);
    db.prepare(`INSERT INTO users (id, openid, nickname, created_at) VALUES (?, ?, ?, ?)`)
      .run('user-m', 'openid-m', 'M', now);
    
    // M 先创建自己的圈子
    db.prepare(`INSERT INTO circles (id, name, owner_id, invite_token, token_expires_at, created_at) 
                VALUES (?, ?, ?, ?, ?, ?)`)
      .run('circle-m', '周末吃啥', 'user-m', 'token-m', '2099-01-01', now);
    
    db.prepare(`INSERT INTO circle_members (circle_id, user_id, role, joined_at) 
                VALUES (?, ?, ?, ?)`)
      .run('circle-m', 'user-m', 'owner', now);
    
    // X 加入 M 的圈子
    const xJoinedM = new Date(Date.now() + 1000).toISOString();
    db.prepare(`INSERT INTO circle_members (circle_id, user_id, role, joined_at) 
                VALUES (?, ?, ?, ?)`)
      .run('circle-m', 'user-x', 'member', xJoinedM);
    
    // heal 机制：X 加入 M 的圈子时，自动创建 X 的个人空间，并将 M 加入
    db.prepare(`INSERT INTO circles (id, name, owner_id, invite_token, token_expires_at, created_at) 
                VALUES (?, ?, ?, ?, ?, ?)`)
      .run('circle-x-personal', '我的美食网', 'user-x', 'token-x', '2099-01-01', xJoinedM);
    
    db.prepare(`INSERT INTO circle_members (circle_id, user_id, role, joined_at) 
                VALUES (?, ?, ?, ?)`)
      .run('circle-x-personal', 'user-x', 'owner', xJoinedM);
    
    // M 被 heal 添加到 X 的个人空间（时间几乎同时）
    const mHealedToX = new Date(Date.now() + 1001).toISOString();
    db.prepare(`INSERT INTO circle_members (circle_id, user_id, role, joined_at) 
                VALUES (?, ?, ?, ?)`)
      .run('circle-x-personal', 'user-m', 'member', mHealedToX);

    // 运行迁移
    runMigration(db);

    // 验证：X 的个人空间应该被标记（M 是 heal 添加的）
    const circleX = db.prepare('SELECT is_personal FROM circles WHERE id = ?').get('circle-x-personal') as { is_personal: number };
    expect(circleX.is_personal).toBe(1);
    
    // M 的圈子不应该被标记（名字不是「我的美食网」）
    const circleM = db.prepare('SELECT is_personal FROM circles WHERE id = ?').get('circle-m') as { is_personal: number | null };
    expect(circleM.is_personal).not.toBe(1);
  });

  it('应该区分真实共享圈和只有 heal 成员的个人空间', () => {
    const now = new Date().toISOString();
    
    // 创建用户 A、B、C
    db.prepare(`INSERT INTO users (id, openid, nickname, created_at) VALUES (?, ?, ?, ?)`)
      .run('user-a', 'openid-a', 'Alice', now);
    db.prepare(`INSERT INTO users (id, openid, nickname, created_at) VALUES (?, ?, ?, ?)`)
      .run('user-b', 'openid-b', 'Bob', now);
    db.prepare(`INSERT INTO users (id, openid, nickname, created_at) VALUES (?, ?, ?, ?)`)
      .run('user-c', 'openid-c', 'Carol', now);
    
    // A 创建共享圈「周末吃啥」
    db.prepare(`INSERT INTO circles (id, name, owner_id, invite_token, token_expires_at, created_at) 
                VALUES (?, ?, ?, ?, ?, ?)`)
      .run('circle-a-shared', '周末吃啥', 'user-a', 'token-a', '2099-01-01', now);
    
    db.prepare(`INSERT INTO circle_members (circle_id, user_id, role, joined_at) 
                VALUES (?, ?, ?, ?)`)
      .run('circle-a-shared', 'user-a', 'owner', now);
    
    // B 和 C 通过邀请加入
    const bJoined = new Date(Date.now() + 10000).toISOString();
    const cJoined = new Date(Date.now() + 20000).toISOString();
    
    db.prepare(`INSERT INTO circle_members (circle_id, user_id, role, joined_at) 
                VALUES (?, ?, ?, ?)`)
      .run('circle-a-shared', 'user-b', 'member', bJoined);
    db.prepare(`INSERT INTO circle_members (circle_id, user_id, role, joined_at) 
                VALUES (?, ?, ?, ?)`)
      .run('circle-a-shared', 'user-c', 'member', cJoined);
    
    // B 创建个人空间（通过 heal）
    db.prepare(`INSERT INTO circles (id, name, owner_id, invite_token, token_expires_at, created_at) 
                VALUES (?, ?, ?, ?, ?, ?)`)
      .run('circle-b-personal', '我的美食网', 'user-b', 'token-b', '2099-01-01', bJoined);
    
    db.prepare(`INSERT INTO circle_members (circle_id, user_id, role, joined_at) 
                VALUES (?, ?, ?, ?)`)
      .run('circle-b-personal', 'user-b', 'owner', bJoined);
    
    // A 被 heal 添加到 B 的个人空间
    db.prepare(`INSERT INTO circle_members (circle_id, user_id, role, joined_at) 
                VALUES (?, ?, ?, ?)`)
      .run('circle-b-personal', 'user-a', 'member', new Date(Date.now() + 10001).toISOString());

    // 运行迁移
    runMigration(db);

    // 验证：A 的共享圈「周末吃啥」不应该被标记
    const circleA = db.prepare('SELECT is_personal FROM circles WHERE id = ?').get('circle-a-shared') as { is_personal: number | null };
    expect(circleA.is_personal).not.toBe(1);
    
    // B 的个人空间应该被标记
    const circleB = db.prepare('SELECT is_personal FROM circles WHERE id = ?').get('circle-b-personal') as { is_personal: number };
    expect(circleB.is_personal).toBe(1);
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
    runMigration(db);

    // 验证：不应该被标记为个人空间
    const circle = db.prepare('SELECT is_personal FROM circles WHERE id = ?').get('circle-e-shared') as { is_personal: number | null };
    expect(circle.is_personal).not.toBe(1);
  });

  it('不应该标记不是用户第一个圈子的「我的美食网」', () => {
    const now = new Date().toISOString();
    
    // 创建用户 F
    db.prepare(`INSERT INTO users (id, openid, nickname, created_at) VALUES (?, ?, ?, ?)`)
      .run('user-f', 'openid-f', 'Frank', now);
    
    // F 先创建了一个共享圈
    db.prepare(`INSERT INTO circles (id, name, owner_id, invite_token, token_expires_at, created_at) 
                VALUES (?, ?, ?, ?, ?, ?)`)
      .run('circle-f-first', '我的餐厅收藏', 'user-f', 'token-f1', '2099-01-01', now);
    
    db.prepare(`INSERT INTO circle_members (circle_id, user_id, role, joined_at) 
                VALUES (?, ?, ?, ?)`)
      .run('circle-f-first', 'user-f', 'owner', now);
    
    // F 后来又创建了一个叫「我的美食网」的圈子（可能是手动创建的）
    const later = new Date(Date.now() + 10000).toISOString();
    db.prepare(`INSERT INTO circles (id, name, owner_id, invite_token, token_expires_at, created_at) 
                VALUES (?, ?, ?, ?, ?, ?)`)
      .run('circle-f-second', '我的美食网', 'user-f', 'token-f2', '2099-01-01', later);
    
    db.prepare(`INSERT INTO circle_members (circle_id, user_id, role, joined_at) 
                VALUES (?, ?, ?, ?)`)
      .run('circle-f-second', 'user-f', 'owner', later);

    // 运行迁移
    runMigration(db);

    // 验证：第二个「我的美食网」不应该被标记（不是第一个圈子）
    const circle = db.prepare('SELECT is_personal FROM circles WHERE id = ?').get('circle-f-second') as { is_personal: number | null };
    expect(circle.is_personal).not.toBe(1);
  });
});

// 简化的迁移逻辑（从 db.ts 复制）
function runMigration(database: Database.Database): void {
  database.exec(`ALTER TABLE circles ADD COLUMN is_personal INTEGER;`);
  
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

  for (const circle of candidates) {
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
      }
      continue;
    }

    let allMembersAreHeal = true;
    for (const member of members) {
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
        allMembersAreHeal = false;
        break;
      }

      const memberJoinedPersonalMs = new Date(member.joined_at).getTime();
      const ownerJoinedReverseMs = new Date(reverseCircle.joiner_joined).getTime();
      const timeDiffSec = Math.abs(memberJoinedPersonalMs - ownerJoinedReverseMs) / 1000;

      if (timeDiffSec > 5) {
        allMembersAreHeal = false;
        break;
      }
    }

    if (allMembersAreHeal && isLikelyPersonal) {
      database
        .prepare(`UPDATE circles SET is_personal = 1 WHERE id = ?`)
        .run(circle.id);
    }
  }
}
