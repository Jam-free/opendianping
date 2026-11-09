import { tableExists } from './engine/table-exists.js';
import type { MiniDatabase } from './engine/types.js';

export const BACKUP_LOG_PREFIX = '[BACKUP]';

/**
 * 备份 JSON 的 schema 版本。表结构有破坏性变更时人工 +1，旧备份将不再自动恢复。
 */
export const BACKUP_SCHEMA_VERSION = 1;

/** 与 initSchema / migrateSchema 一致的业务表（导出全集；恢复按外键顺序写入）。 */
export const BACKUP_BUSINESS_TABLES = [
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

export type BackupBusinessTable = (typeof BACKUP_BUSINESS_TABLES)[number];

export type BackupPayload = {
  schemaVersion: number;
  exportedAt: string;
  tables: Record<string, Record<string, unknown>[]>;
};

export type BackupStorage = {
  putObject(key: string, body: string): Promise<void>;
  listKeys(prefix: string): Promise<string[]>;
  deleteObject(key: string): Promise<void>;
  getLatestObjectKey(prefix: string): Promise<string | null>;
  getObject(key: string): Promise<string>;
};

export type BackupRuntimeOptions = {
  secretId?: string;
  secretKey?: string;
  bucket?: string;
  region?: string;
  prefix?: string;
  debounceMs?: number;
  keepCount?: number;
  storage?: BackupStorage;
  logger?: Pick<Console, 'error' | 'log'>;
};

type BackupRuntime = {
  enabled: boolean;
  debounceMs: number;
  keepCount: number;
  prefix: string;
  storage: BackupStorage | null;
  dirty: boolean;
  timer: ReturnType<typeof setTimeout> | null;
  flushing: boolean;
  logger: Pick<Console, 'error' | 'log'>;
};

let runtime: BackupRuntime | null = null;
let instrumentedDb: MiniDatabase | null = null;

function envBackupPrefix(): string {
  return process.env.BACKUP_PREFIX || 'backups';
}

function envBackupRegion(): string {
  return process.env.BACKUP_REGION || 'ap-guangzhou';
}

export function listTablesPresentInDb(database: MiniDatabase): string[] {
  if (database.dialect === 'mysql') {
    const rows = database
      .prepare(
        `SELECT table_name AS name FROM information_schema.tables
         WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE'
         ORDER BY table_name`
      )
      .all() as Array<{ name: string }>;
    return rows.map((r) => r.name);
  }
  const rows = database
    .prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`
    )
    .all() as Array<{ name: string }>;
  return rows.map((r) => r.name);
}

export function exportDatabaseSnapshot(
  database: MiniDatabase
): BackupPayload {
  const tables: BackupPayload['tables'] = {};
  for (const table of BACKUP_BUSINESS_TABLES) {
    if (!tableExists(database, table)) continue;
    tables[table] = database
      .prepare(`SELECT * FROM ${table}`)
      .all() as Record<string, unknown>[];
  }
  return {
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    tables,
  };
}

function setForeignKeys(database: MiniDatabase, enabled: boolean): void {
  if (database.dialect === 'mysql') {
    database.exec(`SET FOREIGN_KEY_CHECKS=${enabled ? 1 : 0}`);
    return;
  }
  database.pragma(enabled ? 'foreign_keys = ON' : 'foreign_keys = OFF');
}

export function restoreDatabaseFromPayload(
  database: MiniDatabase,
  payload: BackupPayload
): void {
  const restoreOrder: BackupBusinessTable[] = [...BACKUP_BUSINESS_TABLES];
  const deleteOrder = [...restoreOrder].reverse();

  const tx = database.transaction(() => {
    setForeignKeys(database, false);
    for (const table of deleteOrder) {
      if (!tableExists(database, table)) continue;
      database.exec(`DELETE FROM ${table}`);
    }
    for (const table of restoreOrder) {
      const rows = payload.tables[table];
      if (!rows?.length) continue;
      const columns = Object.keys(rows[0]);
      const placeholders = columns.map(() => '?').join(', ');
      const sql = `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`;
      const insert = database.prepare(sql);
      for (const row of rows) {
        insert.run(...columns.map((c) => row[c]));
      }
    }
    setForeignKeys(database, true);
  });
  tx();
}

function backupObjectKey(prefix: string): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `${prefix}/miniprogram-${stamp}.json`;
}

async function pruneOldBackups(
  storage: BackupStorage,
  prefix: string,
  keepCount: number,
  logger: Pick<Console, 'error'>
): Promise<void> {
  try {
    const keys = (await storage.listKeys(`${prefix}/`))
      .filter((k) => k.includes('miniprogram-') && k.endsWith('.json'))
      .sort();
    const excess = keys.length - keepCount;
    if (excess <= 0) return;
    for (const key of keys.slice(0, excess)) {
      await storage.deleteObject(key);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`${BACKUP_LOG_PREFIX} 清理旧备份失败: ${message}`);
  }
}

async function performDump(
  database: MiniDatabase,
  rt: BackupRuntime,
  force = false
): Promise<void> {
  if (!rt.enabled || !rt.storage) return;
  if (!force && !rt.dirty) return;
  rt.flushing = true;
  try {
    const payload = exportDatabaseSnapshot(database);
    const key = backupObjectKey(rt.prefix);
    const body = JSON.stringify(payload);
    await rt.storage.putObject(key, body);
    rt.dirty = false;
    await pruneOldBackups(rt.storage, rt.prefix, rt.keepCount, rt.logger);
    const counts = BACKUP_BUSINESS_TABLES.map((t) => {
      const n = payload.tables[t]?.length ?? 0;
      return `${t}=${n}`;
    }).join(' ');
    rt.logger.log(`${BACKUP_LOG_PREFIX} 已上传 COS 备份 ${key} ${counts}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    rt.logger.error(`${BACKUP_LOG_PREFIX} 上传备份失败: ${message}`);
    rt.dirty = true;
  } finally {
    rt.flushing = false;
  }
}

function scheduleDebouncedDump(database: MiniDatabase): void {
  const rt = runtime;
  if (!rt?.enabled) return;
  if (rt.timer) clearTimeout(rt.timer);
  rt.timer = setTimeout(() => {
    rt.timer = null;
    void performDump(database, rt, false);
  }, rt.debounceMs);
}

export function markBackupDirty(): void {
  const rt = runtime;
  if (!rt?.enabled) return;
  rt.dirty = true;
  if (instrumentedDb) scheduleDebouncedDump(instrumentedDb);
}

export function instrumentDatabaseWrites(database: MiniDatabase): void {
  if (instrumentedDb === database) return;
  instrumentedDb = database;
  const origPrepare = database.prepare.bind(database);
  database.prepare = function instrumentedPrepare(
    this: MiniDatabase,
    sql: string
  ) {
    const stmt = origPrepare(sql);
    const isWrite = /^\s*(INSERT|UPDATE|DELETE|REPLACE)\b/i.test(sql);
    if (!isWrite) return stmt;
    const origRun = stmt.run.bind(stmt);
    stmt.run = function instrumentedRun(...args: unknown[]) {
      const result = origRun(...(args as Parameters<typeof origRun>));
      markBackupDirty();
      return result;
    };
    return stmt;
  };
}

export function initBackupRuntime(
  database: MiniDatabase,
  options: BackupRuntimeOptions = {}
): void {
  const logger = options.logger ?? console;
  const secretId = options.secretId ?? process.env.TENCENTCLOUD_SECRETID;
  const secretKey = options.secretKey ?? process.env.TENCENTCLOUD_SECRETKEY;
  const bucket = options.bucket ?? process.env.BACKUP_BUCKET;
  const prefix = options.prefix ?? envBackupPrefix();
  const debounceMs = options.debounceMs ?? 60_000;
  const keepCount = options.keepCount ?? 20;

  if (runtime) {
    if (runtime.timer) clearTimeout(runtime.timer);
  }

  const missing: string[] = [];
  if (!secretId) missing.push('TENCENTCLOUD_SECRETID');
  if (!secretKey) missing.push('TENCENTCLOUD_SECRETKEY');
  if (!bucket) missing.push('BACKUP_BUCKET');

  let storage = options.storage ?? null;
  let enabled = false;

  if (options.storage) {
    storage = options.storage;
    enabled = true;
  } else if (missing.length === 0) {
    storage = createCosStorage({
      secretId: secretId!,
      secretKey: secretKey!,
      bucket: bucket!,
      region: envBackupRegion(),
    });
    enabled = true;
  } else {
    logger.error(
      `${BACKUP_LOG_PREFIX} COS 备份未配置——实例替换时数据仍会丢失（缺少: ${missing.join(', ')}）`
    );
  }

  runtime = {
    enabled,
    debounceMs,
    keepCount,
    prefix,
    storage,
    dirty: false,
    timer: null,
    flushing: false,
    logger,
  };

  if (enabled) {
    instrumentDatabaseWrites(database);
  }
}

export async function flushBackupNow(
  database?: MiniDatabase
): Promise<void> {
  const db = database ?? instrumentedDb;
  const rt = runtime;
  if (!rt?.enabled || !db) return;
  if (rt.timer) {
    clearTimeout(rt.timer);
    rt.timer = null;
  }
  await performDump(db, rt, true);
}

export async function shutdownBackup(options?: {
  database?: MiniDatabase;
  flush?: boolean;
}): Promise<void> {
  const rt = runtime;
  if (!rt) return;
  if (rt.timer) {
    clearTimeout(rt.timer);
    rt.timer = null;
  }
  if (options?.flush) {
    await flushBackupNow(options.database);
  }
}

export async function tryRestoreFromLatestBackup(
  database: MiniDatabase,
  options: {
    storage?: BackupStorage;
    logger?: Pick<Console, 'error' | 'log'>;
  } = {}
): Promise<boolean> {
  const logger = options.logger ?? console;
  const secretId = process.env.TENCENTCLOUD_SECRETID;
  const secretKey = process.env.TENCENTCLOUD_SECRETKEY;
  const bucket = process.env.BACKUP_BUCKET;
  const prefix = envBackupPrefix();

  let storage = options.storage;
  if (!storage) {
    if (!secretId || !secretKey || !bucket) {
      return false;
    }
    storage = createCosStorage({
      secretId,
      secretKey,
      bucket,
      region: envBackupRegion(),
    });
  }

  try {
    const latestKey = await storage.getLatestObjectKey(`${prefix}/`);
    if (!latestKey) {
      logger.log(`${BACKUP_LOG_PREFIX} 无可用 COS 备份，跳过恢复`);
      return false;
    }
    const raw = await storage.getObject(latestKey);
    const payload = JSON.parse(raw) as BackupPayload;
    if (payload.schemaVersion !== BACKUP_SCHEMA_VERSION) {
      logger.error(
        `${BACKUP_LOG_PREFIX} 备份 schemaVersion=${payload.schemaVersion} 与当前 ${BACKUP_SCHEMA_VERSION} 不一致，跳过自动恢复`
      );
      return false;
    }
    restoreDatabaseFromPayload(database, payload);
    const summary = BACKUP_BUSINESS_TABLES.map(
      (t) => `${t}=${payload.tables[t]?.length ?? 0}`
    ).join(' ');
    logger.log(
      `${BACKUP_LOG_PREFIX} 已从 COS 备份恢复：${summary}（来源 ${latestKey}）`
    );
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`${BACKUP_LOG_PREFIX} 自动恢复失败: ${message}`);
    return false;
  }
}

type CosModule = {
  default: new (options: Record<string, unknown>) => CosClient;
};

type CosClient = {
  putObject(
    params: Record<string, unknown>,
    cb: (err: Error | null, data?: unknown) => void
  ): void;
  getObject(
    params: Record<string, unknown>,
    cb: (err: Error | null, data?: { Body?: Buffer | string }) => void
  ): void;
  listObjects(
    params: Record<string, unknown>,
    cb: (
      err: Error | null,
      data?: { Contents?: Array<{ Key?: string }> }
    ) => void
  ): void;
  deleteObject(
    params: Record<string, unknown>,
    cb: (err: Error | null) => void
  ): void;
};

function createCosStorage(opts: {
  secretId: string;
  secretKey: string;
  bucket: string;
  region: string;
}): BackupStorage {
  let client: CosClient | null = null;

  const getClient = async (): Promise<CosClient> => {
    if (client) return client;
    const mod = (await import('cos-nodejs-sdk-v5')) as CosModule;
    client = new mod.default({
      SecretId: opts.secretId,
      SecretKey: opts.secretKey,
    });
    return client;
  };

  const promisify = <T>(
    fn: (cb: (err: Error | null, data?: T) => void) => void
  ): Promise<T | undefined> =>
    new Promise((resolve, reject) => {
      fn((err, data) => {
        if (err) reject(err);
        else resolve(data);
      });
    });

  return {
    async putObject(key, body) {
      const cos = await getClient();
      await promisify((cb) =>
        cos.putObject(
          {
            Bucket: opts.bucket,
            Region: opts.region,
            Key: key,
            Body: body,
            ContentType: 'application/json',
          },
          cb
        )
      );
    },
    async listKeys(prefix) {
      const cos = await getClient();
      const data = await promisify<{ Contents?: Array<{ Key?: string }> }>(
        (cb) =>
          cos.listObjects(
            { Bucket: opts.bucket, Region: opts.region, Prefix: prefix },
            cb
          )
      );
      return (data?.Contents ?? [])
        .map((c) => c.Key)
        .filter((k): k is string => Boolean(k));
    },
    async deleteObject(key) {
      const cos = await getClient();
      await promisify((cb) =>
        cos.deleteObject(
          { Bucket: opts.bucket, Region: opts.region, Key: key },
          cb
        )
      );
    },
    async getLatestObjectKey(prefix) {
      const keys = (await this.listKeys(prefix))
        .filter((k) => k.includes('miniprogram-') && k.endsWith('.json'))
        .sort();
      return keys.length ? keys[keys.length - 1]! : null;
    },
    async getObject(key) {
      const cos = await getClient();
      const data = await promisify<{ Body?: Buffer | string }>((cb) =>
        cos.getObject(
          { Bucket: opts.bucket, Region: opts.region, Key: key },
          cb
        )
      );
      const body = data?.Body;
      if (body == null) return '';
      return typeof body === 'string' ? body : body.toString('utf8');
    },
  };
}

/** 测试用：重置备份运行时与写库挂钩 */
export function resetBackupForTests(): void {
  if (runtime?.timer) clearTimeout(runtime.timer);
  runtime = null;
  instrumentedDb = null;
}

export function isBackupEnabledForTests(): boolean {
  return Boolean(runtime?.enabled);
}
