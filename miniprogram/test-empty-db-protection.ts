#!/usr/bin/env tsx
/**
 * 测试空库保护逻辑
 */
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

// 模拟生产环境
process.env.NODE_ENV = 'production';
process.env.PREVENT_EMPTY_DB_START = 'true';

const testDbPath = path.join('/tmp', 'test-empty-protection.db');

console.log('测试 1: 空库启动保护');
console.log('========================\n');

// 清理旧测试数据库
if (fs.existsSync(testDbPath)) {
  fs.unlinkSync(testDbPath);
}

console.log('创建空数据库（仅建表，无数据）...');
const db = new Database(testDbPath);

// 只建表结构
db.exec(`
  CREATE TABLE users (
    id TEXT PRIMARY KEY,
    openid TEXT NOT NULL UNIQUE,
    nickname TEXT,
    created_at TEXT
  );
  CREATE TABLE favorites (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    shop_id TEXT,
    created_at TEXT
  );
  CREATE TABLE agent_tokens (
    id TEXT PRIMARY KEY,
    user_id TEXT UNIQUE,
    token_hash TEXT,
    created_at TEXT
  );
`);

const userCount = db.prepare('SELECT COUNT(*) as n FROM users').get() as { n: number };
const favCount = db.prepare('SELECT COUNT(*) as n FROM favorites').get() as { n: number };
const tokenCount = db.prepare('SELECT COUNT(*) as n FROM agent_tokens').get() as { n: number };

console.log(`用户数: ${userCount.n}`);
console.log(`收藏数: ${favCount.n}`);
console.log(`Token数: ${tokenCount.n}`);

db.close();

console.log('\n✅ 空库创建成功');
console.log('空库保护应该触发：userCount=0 && favoriteCount=0 && agentTokenCount=0');
console.log('\n测试 2: 有用户但无收藏（应该通过）');
console.log('========================\n');

const db2 = new Database(testDbPath);
db2.exec(`
  INSERT INTO users (id, openid, nickname, created_at) 
  VALUES ('test-1', 'openid-1', '测试用户', datetime('now'));
`);

const userCount2 = db2.prepare('SELECT COUNT(*) as n FROM users').get() as { n: number };
const favCount2 = db2.prepare('SELECT COUNT(*) as n FROM favorites').get() as { n: number };
const tokenCount2 = db2.prepare('SELECT COUNT(*) as n FROM agent_tokens').get() as { n: number };

console.log(`用户数: ${userCount2.n}`);
console.log(`收藏数: ${favCount2.n}`);
console.log(`Token数: ${tokenCount2.n}`);

db2.close();

console.log('\n⚠️  问题：有用户但收藏丢失，保护逻辑会漏检！');
console.log('因为检查的是 userCount=0 AND favoriteCount=0');
console.log('应该改为 OR 逻辑？或者分别检查？');

console.log('\n测试 3: 健康端点信息泄露');
console.log('========================\n');

console.log('当前 /health 返回：');
console.log(JSON.stringify({
  ok: true,
  persistence: {
    dbPath: '/data/miniprogram.db',  // ⚠️ 泄露路径
    userCount: 123,                   // ⚠️ 泄露统计
    favoriteCount: 456,               // ⚠️ 泄露统计
    agentTokenCount: 12               // ⚠️ 泄露统计
  }
}, null, 2));

console.log('\n⚠️  建议：生产环境只返回 ok: true/false');
console.log('详细信息应该需要认证或内网访问');

// 清理
fs.unlinkSync(testDbPath);
