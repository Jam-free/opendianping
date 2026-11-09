import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import {
  initBackupRuntime,
  resetBackupForTests,
  tryRestoreFromLatestBackup,
  BACKUP_LOG_PREFIX,
  type BackupStorage,
} from './backup.js';
import {
  assessProductionPersistence,
  formatPersistenceWarning,
  isAllowEphemeralWrites,
  isCloudRunDataPath,
  looksLikeEphemeralDataMount,
  PERSISTENCE_LOG_PREFIX,
  readPersistenceCounts,
  type PersistenceHealth,
} from './persistence.js';
import { applySchema } from './engine/schema.js';
import { openMysqlDatabase } from './engine/mysql.js';
import { resolveDbBackend } from './engine/resolve-backend.js';
import { openSqliteRaw, wrapSqliteDatabase } from './engine/sqlite.js';
import type { MiniDatabase, MysqlConnectionConfig } from './engine/types.js';

export type { MiniDatabase } from './engine/types.js';

let db: MiniDatabase | null = null;
let openedDbPath: string = config.dbPath;
let lastPersistenceWarning: string | null = null;
let persistenceDegraded = false;
let lastOpenCreatedNewFile = false;
let lastBackend: MiniDatabase['dialect'] = 'sqlite';

export type OpenDatabaseOptions = {
  /**
   * 测试用：把任意临时路径当成云托管 /data 来验证告警。
   * 生产代码不要传。
   */
  treatAsCloudData?: boolean;
  /** 测试用：覆盖「持久盘根目录」，默认 /data */
  volumeRoot?: string;
  /** 测试用：强制视为已挂持久盘（跳过临时盘判定与降级） */
  forcePersistentVolume?: boolean;
  /** 测试用：注入 COS，用于备份/恢复 */
  backupStorage?: BackupStorage;
  backupDebounceMs?: number;
  logger?: Pick<Console, 'error' | 'log'>;
  skipBackupInit?: boolean;
};

export function isPersistenceDegraded(): boolean {
  return persistenceDegraded;
}

type OpenDatabaseMeta = {
  dbPath: string;
  cloudDataPath: boolean;
  createdNewFile: boolean;
  ephemeralMount: boolean;
  backend: MiniDatabase['dialect'];
  mysqlConnected?: boolean;
};

function shouldAttemptCosRestore(
  database: MiniDatabase,
  meta: OpenDatabaseMeta
): boolean {
  if (meta.backend === 'mysql') {
    if (meta.mysqlConnected === false) return false;
    const c = readPersistenceCounts(database);
    return c.userCount === 0 && c.favoriteCount === 0 && c.agentTokenCount === 0;
  }
  if (!meta.cloudDataPath || meta.ephemeralMount) return false;
  if (meta.createdNewFile) return true;
  const c = readPersistenceCounts(database);
  return (
    c.userCount === 0 && c.favoriteCount === 0 && c.agentTokenCount === 0
  );
}

function prepareDatabaseFile(
  dbPath: string,
  options: OpenDatabaseOptions
): OpenDatabaseMeta {
  const cloudDataPath =
    dbPath !== ':memory:' &&
    (options.treatAsCloudData === true || isCloudRunDataPath(dbPath));

  let createdNewFile = false;
  let ephemeralMount = false;

  if (dbPath !== ':memory:') {
    if (cloudDataPath && !options.forcePersistentVolume) {
      ephemeralMount = looksLikeEphemeralDataMount(
        options.volumeRoot ?? '/data'
      );
    }
    createdNewFile = !fs.existsSync(dbPath);
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }

  return {
    dbPath,
    cloudDataPath,
    createdNewFile,
    ephemeralMount,
    backend: 'sqlite',
  };
}

function finalizeOpenDatabase(
  database: MiniDatabase,
  meta: OpenDatabaseMeta,
  options: OpenDatabaseOptions
): MiniDatabase {
  const logger = options.logger ?? console;
  const { dbPath, cloudDataPath, createdNewFile, ephemeralMount } = meta;
  lastOpenCreatedNewFile = createdNewFile;
  lastBackend = meta.backend;

  const counts = readPersistenceCounts(database);
  const signals = {
    dbPath,
    cloudDataPath,
    createdNewFile,
    ephemeralMount,
    backend: meta.backend,
    mysqlConnected: meta.mysqlConnected,
    ...counts,
  };
  const assessment = assessProductionPersistence(signals);
  lastPersistenceWarning = assessment.shouldWarn
    ? formatPersistenceWarning(signals, assessment.reasons)
    : null;
  openedDbPath = dbPath;

  if (meta.backend === 'mysql') {
    persistenceDegraded =
      meta.mysqlConnected === false && !isAllowEphemeralWrites();
  } else {
    persistenceDegraded =
      cloudDataPath &&
      ephemeralMount &&
      !isAllowEphemeralWrites() &&
      dbPath !== ':memory:';
  }

  if (persistenceDegraded) {
    logger.error(
      meta.backend === 'mysql'
        ? `${PERSISTENCE_LOG_PREFIX} 已进入降级模式：MySQL 不可用，业务写入将全部拒绝`
        : `${PERSISTENCE_LOG_PREFIX} 已进入降级模式：云托管路径且持久盘未挂载，业务写入将全部拒绝`
    );
  } else if (
    meta.backend === 'sqlite' &&
    cloudDataPath &&
    ephemeralMount &&
    isAllowEphemeralWrites()
  ) {
    logger.log(
      `${PERSISTENCE_LOG_PREFIX} 已放行临时盘写入（开发模式 ALLOW_EPHEMERAL_WRITES=true）`
    );
  }

  if (lastPersistenceWarning) {
    logger.error(lastPersistenceWarning);
  }

  if (!options.skipBackupInit) {
    initBackupRuntime(database, {
      storage: options.backupStorage,
      debounceMs: options.backupDebounceMs,
      logger,
    });
  }

  return database;
}

function openSqliteDatabase(
  dbPath: string,
  options: OpenDatabaseOptions,
  withCosRestore: boolean
): MiniDatabase | Promise<MiniDatabase> {
  const logger = options.logger ?? console;
  const meta = prepareDatabaseFile(dbPath, options);
  const raw = openSqliteRaw(dbPath);
  const database = wrapSqliteDatabase(raw);
  applySchema(database);

  if (meta.cloudDataPath && meta.ephemeralMount) {
    logger.log(`${BACKUP_LOG_PREFIX} 临时盘：跳过备份恢复`);
  }

  if (withCosRestore && shouldAttemptCosRestore(database, meta)) {
    return tryRestoreFromLatestBackup(database, {
      storage: options.backupStorage,
      logger,
    }).then(() => finalizeOpenDatabase(database, meta, options));
  }

  return finalizeOpenDatabase(database, meta, options);
}

/**
 * 打开 SQLite。Agent Token 和收藏都在这一个文件里，不要拆库。
 * 产品意图：换镜像只换代码，盘上的「连接 AI」口令和我的店必须还在。
 * 同步路径不等待 COS 恢复；生产入口请用 startupDatabase()。
 */
export function openDatabase(
  dbPath: string = config.dbPath,
  options: OpenDatabaseOptions = {}
): MiniDatabase {
  return openSqliteDatabase(dbPath, options, false) as MiniDatabase;
}

/**
 * 生产启动：在云托管真卷上 await COS 自愈后再对外服务。
 */
export async function openDatabaseWithStartup(
  dbPath: string = config.dbPath,
  options: OpenDatabaseOptions = {}
): Promise<MiniDatabase> {
  return openSqliteDatabase(dbPath, options, true);
}

function mysqlCloudSignals(options: OpenDatabaseOptions): boolean {
  return (
    options.treatAsCloudData === true ||
    process.env.NODE_ENV === 'production'
  );
}

function openMysqlAndSchema(
  mysql: MysqlConnectionConfig,
  options: OpenDatabaseOptions,
  withCosRestore: boolean
): MiniDatabase | Promise<MiniDatabase> {
  const logger = options.logger ?? console;
  const database = openMysqlDatabase(mysql);
  applySchema(database);
  const counts = readPersistenceCounts(database);
  const empty =
    counts.userCount === 0 &&
    counts.favoriteCount === 0 &&
    counts.agentTokenCount === 0;
  const meta: OpenDatabaseMeta = {
    dbPath: database.summary,
    cloudDataPath: mysqlCloudSignals(options),
    createdNewFile: empty,
    ephemeralMount: false,
    backend: 'mysql',
    mysqlConnected: true,
  };
  if (withCosRestore && shouldAttemptCosRestore(database, meta)) {
    logger.log(`${BACKUP_LOG_PREFIX} MySQL 空库：尝试从 COS 备份恢复`);
    return tryRestoreFromLatestBackup(database, {
      storage: options.backupStorage,
      logger,
    }).then(() => finalizeOpenDatabase(database, meta, options));
  }
  return finalizeOpenDatabase(database, meta, options);
}

export async function startupDatabase(
  options: OpenDatabaseOptions = {}
): Promise<void> {
  if (db) return;
  const resolved = resolveDbBackend();
  if (resolved.dialect === 'mysql') {
    db = await openMysqlAndSchema(resolved.mysql, options, true);
    return;
  }
  db = await openDatabaseWithStartup(config.dbPath, options);
}

export function getDb(): MiniDatabase {
  if (!db) {
    if (lastBackend === 'mysql' && persistenceDegraded) {
      throw new Error(lastPersistenceWarning || 'MySQL 不可用');
    }
    const resolved = resolveDbBackend();
    if (resolved.dialect === 'mysql') {
      db = openMysqlAndSchema(resolved.mysql, {}, false) as MiniDatabase;
    } else {
      db = openDatabase();
    }
  }
  return db;
}

export function getOpenedDbPath(): string {
  return openedDbPath;
}

export function getLastPersistenceWarning(): string | null {
  return lastPersistenceWarning;
}

export function getOpenedDbBackend(): MiniDatabase['dialect'] {
  return lastBackend;
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
      backend: database.dialect,
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
      backend: lastBackend,
      agentTokenCount: null,
      favoriteCount: null,
      userCount: null,
      warning: lastPersistenceWarning,
      error: message,
    };
  }
}

/** 仅供测试：重置为全新库 */
export function resetDbForTests(database?: MiniDatabase): MiniDatabase {
  if (db) {
    try {
      db.close();
    } catch {
      /* ignore */
    }
  }
  lastPersistenceWarning = null;
  persistenceDegraded = false;
  lastOpenCreatedNewFile = false;
  lastBackend = 'sqlite';
  resetBackupForTests();
  db = database || openDatabase(':memory:', { skipBackupInit: true });
  openedDbPath = ':memory:';
  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}

/** 测试用：把已打开的库挂到进程单例（配合 createApp / getDb） */
export function setDbSingletonForTests(database: MiniDatabase): void {
  db = database;
  lastBackend = database.dialect;
}

export function markMysqlUnreachable(message: string, logger: Pick<Console, 'error'> = console): void {
  persistenceDegraded = true;
  lastBackend = 'mysql';
  lastPersistenceWarning = `${PERSISTENCE_LOG_PREFIX} MySQL 不可用: ${message}`;
  logger.error(lastPersistenceWarning);
}
