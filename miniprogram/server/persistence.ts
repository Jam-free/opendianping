import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';

/**
 * 稳定日志前缀：云托管控制台按这个搜，就能看到「盘没挂上 / 库被建成空的」。
 * 产品意图：发版后 Token 突然全失效时，不要让值班的人在普通启动日志里翻。
 */
export const PERSISTENCE_LOG_PREFIX = '[PERSISTENCE]';

/** 微信云托管约定：持久盘挂载点，和 DB 文件都在这块盘上。 */
export const CLOUD_DATA_VOLUME_ROOT = '/data';

export type PersistenceCounts = {
  userCount: number;
  favoriteCount: number;
  agentTokenCount: number;
};

export type PersistenceSignals = {
  dbPath: string;
  /** 路径落在云托管持久盘约定位置（/data/...），不是本地 ./data */
  cloudDataPath: boolean;
  /** 打开前文件不存在，本次会新建空库 */
  createdNewFile: boolean;
  /** /data 看起来像容器可写层，而不是独立持久盘 */
  ephemeralMount: boolean;
  userCount: number;
  favoriteCount: number;
  agentTokenCount: number;
};

export type PersistenceAssessment = {
  shouldWarn: boolean;
  reasons: string[];
};

export type PersistenceHealth = {
  dbPath: string;
  agentTokenCount: number | null;
  favoriteCount: number | null;
  userCount: number | null;
  warning: string | null;
  error?: string;
};

/**
 * 是不是云托管那条「必须落在持久盘」的路径。
 * `/workspace/.../data/miniprogram.db` 这种本地相对路径不算。
 */
export function isCloudRunDataPath(dbPath: string): boolean {
  if (!dbPath || dbPath === ':memory:') return false;
  const resolved = path.resolve(dbPath);
  return (
    resolved === CLOUD_DATA_VOLUME_ROOT ||
    resolved.startsWith(`${CLOUD_DATA_VOLUME_ROOT}/`)
  );
}

function isLinuxMountPoint(absPath: string): boolean {
  const resolved = path.resolve(absPath);
  if (resolved === '/') return true;
  try {
    const st = fs.statSync(resolved);
    const parentSt = fs.statSync(path.dirname(resolved));
    if (st.dev !== parentSt.dev) return true;
  } catch {
    return false;
  }
  // bind mount 可能与父目录同设备，再看内核挂载表
  try {
    const text = fs.readFileSync('/proc/self/mountinfo', 'utf8');
    for (const line of text.split('\n')) {
      if (!line) continue;
      const mountPoint = line.split(' ')[4]?.replace(/\\040/g, ' ');
      if (mountPoint === resolved) return true;
    }
  } catch {
    /* 非 Linux 或无法读 /proc：退回设备号判断 */
  }
  return false;
}

/**
 * 缺盘时的真实行为（已在本环境验证）：/data 不存在时，mkdir 会在镜像可写层
 * 建出目录，better-sqlite3 接着建空库，接口照样 200。所以「能打开库」不等于「挂了盘」。
 */
export function looksLikeEphemeralDataMount(
  volumeRoot: string = CLOUD_DATA_VOLUME_ROOT
): boolean {
  try {
    if (!fs.existsSync(volumeRoot)) return true;
    const st = fs.statSync(volumeRoot);
    if (!st.isDirectory()) return true;
    if (isLinuxMountPoint(volumeRoot)) return false;
    const parentSt = fs.statSync(path.dirname(path.resolve(volumeRoot)));
    return st.dev === parentSt.dev;
  } catch {
    return true;
  }
}

export function readPersistenceCounts(
  database: Database.Database
): PersistenceCounts {
  const count = (table: 'users' | 'favorites' | 'agent_tokens'): number => {
    const row = database.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as {
      n: number;
    };
    return Number(row?.n) || 0;
  };
  return {
    userCount: count('users'),
    favoriteCount: count('favorites'),
    agentTokenCount: count('agent_tokens'),
  };
}

/**
 * 生产路径（/data/...）不允许把空库当成「第一次开机很正常」。
 * 本地 ./data/miniprogram.db 首次创建保持安静。
 */
export function assessProductionPersistence(
  signals: PersistenceSignals
): PersistenceAssessment {
  const reasons: string[] = [];
  if (!signals.cloudDataPath) {
    return { shouldWarn: false, reasons };
  }
  if (signals.ephemeralMount) {
    reasons.push(
      '/data 看起来像容器临时盘（未挂载持久卷，或缺目录将被 mkdir 到镜像可写层）'
    );
  }
  if (signals.createdNewFile) {
    reasons.push('打开前数据库文件不存在，本次会新建空库');
  }
  if (
    signals.userCount === 0 &&
    signals.favoriteCount === 0 &&
    signals.agentTokenCount === 0
  ) {
    reasons.push(
      `库是空的：users=${signals.userCount} favorites=${signals.favoriteCount} agent_tokens=${signals.agentTokenCount}`
    );
  }
  return { shouldWarn: reasons.length > 0, reasons };
}

export function formatPersistenceWarning(
  signals: PersistenceSignals,
  reasons: string[]
): string {
  const lines = [
    `${PERSISTENCE_LOG_PREFIX} 生产 SQLite 看起来像丢盘或空库，不要当成健康的第一次启动。`,
    `${PERSISTENCE_LOG_PREFIX} dbPath=${signals.dbPath}`,
    `${PERSISTENCE_LOG_PREFIX} 禁止无盘发布：必须挂载持久盘到 /data，且 DB_PATH=/data/miniprogram.db。`,
    `${PERSISTENCE_LOG_PREFIX} Token 与收藏同库同盘；发版不得清表。用户只能主动点「连接 AI」重置 Token。`,
    ...reasons.map((r) => `${PERSISTENCE_LOG_PREFIX} 原因: ${r}`),
  ];
  return lines.join('\n');
}
