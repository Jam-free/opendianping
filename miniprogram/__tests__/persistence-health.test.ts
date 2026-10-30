import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import request from 'supertest';
import { createApp } from '../server/app.js';
import { createSessionForOpenId } from '../server/auth.js';
import { config } from '../server/config.js';
import {
  closeDb,
  getDb,
  getLastPersistenceWarning,
  getPersistenceHealth,
  openDatabase,
  resetDbForTests,
} from '../server/db.js';
import {
  assessProductionPersistence,
  isCloudRunDataPath,
  looksLikeEphemeralDataMount,
  PERSISTENCE_LOG_PREFIX,
} from '../server/persistence.js';
import { issueAgentToken } from '../server/services/network.js';

const originalDbPath = config.dbPath;
const testsDir = path.dirname(fileURLToPath(import.meta.url));

function tempDbFile(): { dir: string; dbPath: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-persist-'));
  return { dir, dbPath: path.join(dir, 'miniprogram.db') };
}

describe('生产空库告警判断', () => {
  test('只有 /data 下的绝对路径才算云托管盘', () => {
    expect(isCloudRunDataPath('/data/miniprogram.db')).toBe(true);
    expect(isCloudRunDataPath('/data')).toBe(true);
    expect(isCloudRunDataPath('/datafoo/miniprogram.db')).toBe(false);
    expect(
      isCloudRunDataPath('/workspace/miniprogram/data/miniprogram.db')
    ).toBe(false);
    expect(isCloudRunDataPath(':memory:')).toBe(false);
  });

  test('不存在的目录看起来像临时盘（缺挂载时 mkdir 会造出来）', () => {
    const missing = path.join(os.tmpdir(), `no-vol-${Date.now()}`);
    expect(looksLikeEphemeralDataMount(missing)).toBe(true);
  });

  test('本地路径首次空库不告警；/data 空库必告警', () => {
    const localEmpty = assessProductionPersistence({
      dbPath: '/workspace/miniprogram/data/miniprogram.db',
      cloudDataPath: false,
      createdNewFile: true,
      ephemeralMount: false,
      userCount: 0,
      favoriteCount: 0,
      agentTokenCount: 0,
    });
    expect(localEmpty.shouldWarn).toBe(false);

    const prodEmpty = assessProductionPersistence({
      dbPath: '/data/miniprogram.db',
      cloudDataPath: true,
      createdNewFile: true,
      ephemeralMount: true,
      userCount: 0,
      favoriteCount: 0,
      agentTokenCount: 0,
    });
    expect(prodEmpty.shouldWarn).toBe(true);
    expect(prodEmpty.reasons.length).toBeGreaterThan(0);
  });

  test('已挂盘且库里有 Token/收藏时不告警', () => {
    const healthy = assessProductionPersistence({
      dbPath: '/data/miniprogram.db',
      cloudDataPath: true,
      createdNewFile: false,
      ephemeralMount: false,
      userCount: 3,
      favoriteCount: 10,
      agentTokenCount: 2,
    });
    expect(healthy.shouldWarn).toBe(false);
  });

  test('盘像临时层时即使有数据也告警（下次发版还会丢）', () => {
    const overlay = assessProductionPersistence({
      dbPath: '/data/miniprogram.db',
      cloudDataPath: true,
      createdNewFile: false,
      ephemeralMount: true,
      userCount: 1,
      favoriteCount: 1,
      agentTokenCount: 1,
    });
    expect(overlay.shouldWarn).toBe(true);
  });
});

describe('openDatabase 空库告警与不清表', () => {
  const extraDbs: Array<{ close: () => void }> = [];

  beforeEach(() => {
    resetDbForTests();
  });

  afterEach(() => {
    while (extraDbs.length) {
      try {
        extraDbs.pop()?.close();
      } catch {
        /* ignore */
      }
    }
    config.dbPath = originalDbPath;
    resetDbForTests();
    closeDb();
    jest.restoreAllMocks();
  });

  test('本地临时路径首次创建保持安静', () => {
    const err = jest.spyOn(console, 'error').mockImplementation(() => {});
    const { dir, dbPath } = tempDbFile();
    const database = openDatabase(dbPath);
    extraDbs.push(database);
    const persistLogs = err.mock.calls.filter((c) =>
      String(c[0]).includes(PERSISTENCE_LOG_PREFIX)
    );
    expect(persistLogs).toHaveLength(0);
    expect(getLastPersistenceWarning()).toBeNull();
    database.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('把临时文件当成 /data 时新建空库会打 [PERSISTENCE] 警告', () => {
    const err = jest.spyOn(console, 'error').mockImplementation(() => {});
    const { dir, dbPath } = tempDbFile();
    const database = openDatabase(dbPath, { treatAsCloudData: true });
    extraDbs.push(database);
    const joined = err.mock.calls.map((c) => c.map(String).join(' ')).join('\n');
    expect(joined).toContain(PERSISTENCE_LOG_PREFIX);
    expect(joined).toContain('禁止无盘发布');
    expect(getLastPersistenceWarning()).toContain(PERSISTENCE_LOG_PREFIX);
    database.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('再次打开已有用户/收藏/Token 的文件不会清表', () => {
    const { dir, dbPath } = tempDbFile();
    const first = openDatabase(dbPath);
    first
      .prepare(
        `INSERT INTO users (id, openid, created_at) VALUES ('u1', 'o1', datetime('now'))`
      )
      .run();
    first
      .prepare(
        `INSERT INTO shops (id, source_type, raw_name, display_cache_policy)
         VALUES ('s1', 'text', '店', 'minimal')`
      )
      .run();
    first
      .prepare(
        `INSERT INTO favorites (id, user_id, shop_id, visibility, created_at)
         VALUES ('f1', 'u1', 's1', 'private', datetime('now'))`
      )
      .run();
    first
      .prepare(
        `INSERT INTO agent_tokens (id, user_id, token_hash, token_prefix, created_at)
         VALUES ('t1', 'u1', 'hash', 'fm_abc', datetime('now'))`
      )
      .run();
    first.close();

    const second = openDatabase(dbPath);
    extraDbs.push(second);
    const users = second.prepare(`SELECT COUNT(*) AS n FROM users`).get() as {
      n: number;
    };
    const favs = second
      .prepare(`SELECT COUNT(*) AS n FROM favorites`)
      .get() as { n: number };
    const tokens = second
      .prepare(`SELECT COUNT(*) AS n FROM agent_tokens`)
      .get() as { n: number };
    expect(users.n).toBe(1);
    expect(favs.n).toBe(1);
    expect(tokens.n).toBe(1);
    second.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('initSchema / migrateSchema 源码不含 DROP 或清 Token/收藏', () => {
    const src = fs.readFileSync(path.join(testsDir, '../server/db.ts'), 'utf8');
    // 注释里会写「不要 DROP TABLE」，只检查可执行代码行
    const code = src
      .split('\n')
      .filter((line) => {
        const t = line.trim();
        return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
      })
      .join('\n');
    expect(code).not.toMatch(/DROP\s+TABLE/i);
    expect(code).not.toMatch(/DELETE\s+FROM\s+(agent_tokens|favorites)/i);
  });
});

describe('GET /health persistence 计数', () => {
  beforeEach(() => {
    config.dbPath = originalDbPath;
    resetDbForTests();
  });

  afterEach(() => {
    config.dbPath = originalDbPath;
    closeDb();
    jest.restoreAllMocks();
  });

  test('空内存库返回 0 计数，并保留 ok / albumImport', async () => {
    const app = createApp();
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.albumImport).toBe(true);
    expect(res.body.persistence).toMatchObject({
      dbPath: ':memory:',
      agentTokenCount: 0,
      favoriteCount: 0,
      userCount: 0,
      warning: null,
    });
  });

  test('有用户、收藏和 Token 时计数非空', async () => {
    const session = createSessionForOpenId('health_count_user');
    issueAgentToken(session.user.id);
    getDb()
      .prepare(
        `INSERT INTO shops (id, source_type, raw_name, display_cache_policy)
         VALUES ('shop_health', 'text', '健康店', 'minimal')`
      )
      .run();
    getDb()
      .prepare(
        `INSERT INTO favorites (id, user_id, shop_id, visibility, created_at)
         VALUES ('fav_health', ?, 'shop_health', 'private', datetime('now'))`
      )
      .run(session.user.id);

    const app = createApp();
    const res = await request(app).get('/health');
    expect(res.body.ok).toBe(true);
    expect(res.body.albumImport).toBe(true);
    expect(res.body.persistence.userCount).toBeGreaterThanOrEqual(1);
    expect(res.body.persistence.favoriteCount).toBe(1);
    expect(res.body.persistence.agentTokenCount).toBe(1);
    expect(res.body.persistence.dbPath).toBe(':memory:');
  });

  test('库打不开时 health 仍 200，并带 persistence.error', async () => {
    closeDb();
    const blocked = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-not-a-db-'));
    config.dbPath = blocked;
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const health = getPersistenceHealth();
    expect(health.agentTokenCount).toBeNull();
    expect(health.favoriteCount).toBeNull();
    expect(health.userCount).toBeNull();
    expect(health.error).toBeTruthy();

    const res = await request(createApp()).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.albumImport).toBe(true);
    expect(res.body.persistence.error).toBeTruthy();
    expect(res.body.persistence.agentTokenCount).toBeNull();
    fs.rmSync(blocked, { recursive: true, force: true });
  });
});
