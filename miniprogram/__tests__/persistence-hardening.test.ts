import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import request from 'supertest';
import { createApp } from '../server/app.js';
import {
  BACKUP_LOG_PREFIX,
  BACKUP_SCHEMA_VERSION,
  exportDatabaseSnapshot,
  initBackupRuntime,
  type BackupStorage,
} from '../server/backup.js';
import {
  closeDb,
  isPersistenceDegraded,
  openDatabase,
  openDatabaseWithStartup,
  resetDbForTests,
  setDbSingletonForTests,
} from '../server/db.js';
import {
  PERSISTENCE_LOG_PREFIX,
  STORAGE_UNMOUNTED_ERROR,
} from '../server/persistence.js';
import { issueAgentToken } from '../server/services/network.js';

const ENV_KEYS = [
  'ALLOW_EPHEMERAL_WRITES',
  'TENCENTCLOUD_SECRETID',
  'TENCENTCLOUD_SECRETKEY',
  'BACKUP_BUCKET',
] as const;

function tempDbFile(): { dir: string; dbPath: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-hard-'));
  return { dir, dbPath: path.join(dir, 'miniprogram.db') };
}

function createMemoryBackupStorage(
  seed?: Record<string, string>
): BackupStorage & { objects: Map<string, string> } {
  const objects = new Map<string, string>(Object.entries(seed || {}));
  return {
    objects,
    async putObject(key, body) {
      objects.set(key, body);
    },
    async listKeys(prefix) {
      return [...objects.keys()].filter((k) => k.startsWith(prefix));
    },
    async deleteObject(key) {
      objects.delete(key);
    },
    async getLatestObjectKey(prefix) {
      const keys = (await this.listKeys(prefix))
        .filter((k) => k.includes('miniprogram-') && k.endsWith('.json'))
        .sort();
      return keys.length ? keys[keys.length - 1]! : null;
    },
    async getObject(key) {
      const v = objects.get(key);
      if (v == null) throw new Error(`missing ${key}`);
      return v;
    },
  };
}

function sampleBackupPayload() {
  const userId = 'u_restore';
  const shopId = 's_restore';
  return {
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    tables: {
      users: [
        {
          id: userId,
          openid: 'openid_restore',
          unionid: null,
          nickname: '恢复用户',
          avatar: null,
          created_at: '2026-01-01 00:00:00',
        },
      ],
      shops: [
        {
          id: shopId,
          source_type: 'text',
          source_shop_id: 'poi_restore',
          amap_poi_id: null,
          raw_name: '恢复的店',
          adcode: null,
          category: null,
          district: null,
          city: '深圳',
          address: null,
          avg_price: null,
          lat: 22.5,
          lng: 114.0,
          source_url: null,
          head_img: null,
          display_cache_policy: 'minimal',
          phone: null,
        },
      ],
      favorites: [
        {
          id: 'f_restore',
          user_id: userId,
          shop_id: shopId,
          note: null,
          visibility: 'private',
          import_batch_id: null,
          created_at: '2026-01-01 00:00:00',
          photo_url: null,
          wishlist: 0,
          from_user_id: null,
        },
      ],
      agent_tokens: [
        {
          id: 't_restore',
          user_id: userId,
          token_hash: 'hash',
          token_prefix: 'fm_restore',
          created_at: '2026-01-01 00:00:00',
          last_used_at: null,
        },
      ],
    },
  };
}

describe('持久化硬防御', () => {
  const savedEnv: Record<string, string | undefined> = {};
  const dirs: string[] = [];

  beforeEach(() => {
    for (const k of ENV_KEYS) {
      savedEnv[k] = process.env[k];
      delete process.env[k];
    }
    resetDbForTests();
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
    while (dirs.length) {
      fs.rmSync(dirs.pop()!, { recursive: true, force: true });
    }
    closeDb();
    jest.restoreAllMocks();
  });

  test('降级模式：云托管路径 + 临时盘 → 业务 503，/health ok:false', async () => {
    const err = jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'log').mockImplementation(() => {});
    const { dir, dbPath } = tempDbFile();
    dirs.push(dir);
    const missingVolume = path.join(os.tmpdir(), `no-vol-${Date.now()}`);
    const database = openDatabase(dbPath, {
      treatAsCloudData: true,
      volumeRoot: missingVolume,
      skipBackupInit: true,
    });
    setDbSingletonForTests(database);
    expect(isPersistenceDegraded()).toBe(true);

    const app = createApp();
    const blocked = await request(app)
      .post('/api/agent/shops')
      .set('Authorization', 'Bearer fm_test')
      .send({ name: '店' });
    expect(blocked.status).toBe(503);
    expect(blocked.body.error).toBe(STORAGE_UNMOUNTED_ERROR);
    expect(
      err.mock.calls.some((c) =>
        String(c[0]).includes(`${PERSISTENCE_LOG_PREFIX} 拒绝业务请求`)
      )
    ).toBe(true);

    const health = await request(app).get('/health');
    expect(health.status).toBe(200);
    expect(health.body.ok).toBe(false);
    expect(health.body.persistence.warning).toContain(PERSISTENCE_LOG_PREFIX);
    database.close();
  });

  test('ALLOW_EPHEMERAL_WRITES=true 时临时盘业务可写', async () => {
    process.env.ALLOW_EPHEMERAL_WRITES = 'true';
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    const { dir, dbPath } = tempDbFile();
    dirs.push(dir);
    const database = openDatabase(dbPath, {
      treatAsCloudData: true,
      volumeRoot: path.join(os.tmpdir(), `dev-vol-${Date.now()}`),
      skipBackupInit: true,
    });
    setDbSingletonForTests(database);
    expect(isPersistenceDegraded()).toBe(false);
    expect(
      log.mock.calls.some((c) =>
        String(c[0]).includes('已放行临时盘写入（开发模式')
      )
    ).toBe(true);

    database
      .prepare(
        `INSERT INTO users (id, openid, created_at) VALUES ('u_ephemeral', 'o_ephemeral', datetime('now'))`
      )
      .run();
    const issued = issueAgentToken('u_ephemeral');

    const app = createApp();
    const res = await request(app)
      .post('/api/agent/shops')
      .set('Authorization', `Bearer ${issued.token}`)
      .send({ name: '临时盘可写', poiKey: 'ephemeral_poi' });
    expect(res.status).toBe(201);
    database.close();
  });

  test('写操作 debounce 后触发 COS dump', async () => {
    jest.useFakeTimers();
    const storage = createMemoryBackupStorage();
    const database = resetDbForTests();
    initBackupRuntime(database, {
      storage,
      secretId: 'x',
      secretKey: 'y',
      bucket: 'b',
      debounceMs: 50,
    });
    database
      .prepare(
        `INSERT INTO users (id, openid, created_at) VALUES ('u_bk', 'o_bk', datetime('now'))`
      )
      .run();

    await jest.advanceTimersByTimeAsync(60);
    expect(storage.objects.size).toBe(1);
    const uploaded = [...storage.objects.values()][0]!;
    const payload = JSON.parse(uploaded);
    expect(payload.tables.users).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'u_bk' })])
    );
    jest.useRealTimers();
  });

  test('空库从 COS 自愈后可读 Agent 店', async () => {
    const seed = resetDbForTests();
    seed
      .prepare(
        `INSERT INTO users (id, openid, created_at) VALUES ('u_restore', 'o_restore', datetime('now'))`
      )
      .run();
    seed
      .prepare(
        `INSERT INTO shops (id, source_type, source_shop_id, raw_name, city, lat, lng, display_cache_policy)
         VALUES ('s_restore', 'text', 'poi_restore', '恢复的店', '深圳', 22.5, 114, 'minimal')`
      )
      .run();
    seed
      .prepare(
        `INSERT INTO favorites (id, user_id, shop_id, visibility, created_at)
         VALUES ('f_restore', 'u_restore', 's_restore', 'private', datetime('now'))`
      )
      .run();
    const issued = issueAgentToken('u_restore');
    const payload = exportDatabaseSnapshot(seed);
    closeDb();

    const storage = createMemoryBackupStorage({
      'backups/miniprogram-20260101-120000.json': JSON.stringify(payload),
    });
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    const { dir, dbPath } = tempDbFile();
    dirs.push(dir);

    const database = await openDatabaseWithStartup(dbPath, {
      treatAsCloudData: true,
      forcePersistentVolume: true,
      backupStorage: storage,
      skipBackupInit: true,
    });
    setDbSingletonForTests(database);
    expect(
      log.mock.calls.some((c) =>
        String(c[0]).includes(`${BACKUP_LOG_PREFIX} 已从 COS 备份恢复`)
      )
    ).toBe(true);

    const app = createApp();
    const listed = await request(app)
      .get('/api/agent/shops')
      .set('Authorization', `Bearer ${issued.token}`);
    expect(listed.status).toBe(200);
    expect(listed.body.mine).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: '恢复的店' }),
      ])
    );
    database.close();
  });

  test('schemaVersion 不匹配时不恢复、服务可启动', async () => {
    const bad = { ...sampleBackupPayload(), schemaVersion: 999 };
    const storage = createMemoryBackupStorage({
      'backups/miniprogram-bad.json': JSON.stringify(bad),
    });
    const err = jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'log').mockImplementation(() => {});
    const { dir, dbPath } = tempDbFile();
    dirs.push(dir);

    const database = await openDatabaseWithStartup(dbPath, {
      treatAsCloudData: true,
      forcePersistentVolume: true,
      backupStorage: storage,
      skipBackupInit: true,
    });
    const users = database
      .prepare(`SELECT COUNT(*) AS n FROM users`)
      .get() as { n: number };
    expect(users.n).toBe(0);
    expect(
      err.mock.calls.some((c) =>
        String(c[0]).includes('schemaVersion=999')
      )
    ).toBe(true);
    database.close();
  });

  test('无 COS 凭证时打 ERROR 且业务不受影响', async () => {
    const err = jest.spyOn(console, 'error').mockImplementation(() => {});
    const database = openDatabase(':memory:');
    setDbSingletonForTests(database);
    expect(
      err.mock.calls.some((c) =>
        String(c[0]).includes(`${BACKUP_LOG_PREFIX} COS 备份未配置`)
      )
    ).toBe(true);

    const app = createApp();
    const health = await request(app).get('/health');
    expect(health.status).toBe(200);
    expect(health.body.ok).toBe(true);
  });
});
