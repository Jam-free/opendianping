import type { PersistenceHealth } from './persistence.js';
import { PERSISTENCE_LOG_PREFIX } from './persistence.js';
import type { DbDialect } from './engine/types.js';

/**
 * 启动门禁：生产空库 / MySQL 连不上时拒绝对外写。
 * 切 MySQL 的第一次部署默认 EXPECTED_MIN_USERS=0，允许空库；导入快照后再把期望值调成 1。
 */

export type BootstrapInput = {
  nodeEnv: string;
  backend: DbDialect;
  preventEmptyStart: boolean;
  /** 0 = 允许空库（首次切库）；>0 = 用户数低于此值则拒绝启动 */
  expectedMinUsers: number;
  health: PersistenceHealth;
  mysqlConfigured: boolean;
};

export type BootstrapLog = {
  level: 'log' | 'warn' | 'error';
  message: string;
};

export type BootstrapDecision = {
  action: 'allow' | 'exit';
  logs: BootstrapLog[];
};

function log(
  logs: BootstrapLog[],
  level: BootstrapLog['level'],
  message: string
): void {
  logs.push({ level, message });
}

export function evaluateBootstrapGate(input: BootstrapInput): BootstrapDecision {
  const logs: BootstrapLog[] = [];
  if (input.nodeEnv !== 'production') {
    log(logs, 'log', '[启动保护] 非生产环境，跳过持久化检查');
    return { action: 'allow', logs };
  }

  if (!input.preventEmptyStart) {
    log(
      logs,
      'warn',
      `${PERSISTENCE_LOG_PREFIX} PREVENT_EMPTY_DB_START=false，启动门禁已关闭`
    );
    return { action: 'allow', logs };
  }

  const userCount = input.health.userCount ?? 0;
  const favoriteCount = input.health.favoriteCount ?? 0;
  const agentTokenCount = input.health.agentTokenCount ?? 0;

  if (input.backend === 'mysql') {
    if (!input.mysqlConfigured || input.health.error) {
      log(
        logs,
        'error',
        `${PERSISTENCE_LOG_PREFIX} MySQL 未就绪（${input.health.error || '缺少 MYSQL_ADDRESS / DATABASE_URL'}）。服务会监听 /health，业务接口 503。`
      );
      log(
        logs,
        'error',
        `${PERSISTENCE_LOG_PREFIX} 请在云托管控制台开通 MySQL 并注入连接信息后再发版。不会回退到容器盘 SQLite。`
      );
      return { action: 'allow', logs };
    }
  } else {
    const dbPath = input.health.dbPath || '';
    if (!dbPath.startsWith('/data/') && dbPath !== ':memory:') {
      log(
        logs,
        'error',
        `${PERSISTENCE_LOG_PREFIX} 生产仍走 SQLite 且路径不是 /data/: ${dbPath}`
      );
      log(
        logs,
        'error',
        `${PERSISTENCE_LOG_PREFIX} 请改用云托管 MySQL（DB_BACKEND=mysql），不要把库落在容器盘上`
      );
      return { action: 'exit', logs };
    }
    if (input.health.warning) {
      log(logs, 'error', input.health.warning);
      log(
        logs,
        'error',
        `${PERSISTENCE_LOG_PREFIX} 检测到 SQLite 持久盘问题，拒绝启动。生产请迁 MySQL。`
      );
      return { action: 'exit', logs };
    }
  }

  const empty =
    userCount === 0 && favoriteCount === 0 && agentTokenCount === 0;

  if (input.expectedMinUsers === 0) {
    log(
      logs,
      'log',
      `${PERSISTENCE_LOG_PREFIX} 允许空库启动（EXPECTED_MIN_USERS=0）。导入快照后请改成 >=1。`
    );
    if (empty) {
      log(
        logs,
        'warn',
        `${PERSISTENCE_LOG_PREFIX} 当前库是空的 users=0 favorites=0 agent_tokens=0 backend=${input.backend}`
      );
    }
    return { action: 'allow', logs };
  }

  if (empty && input.expectedMinUsers > 0) {
    log(
      logs,
      'error',
      `${PERSISTENCE_LOG_PREFIX} 生产空库且 EXPECTED_MIN_USERS=${input.expectedMinUsers}，拒绝启动`
    );
    return { action: 'exit', logs };
  }

  if (userCount < input.expectedMinUsers) {
    log(
      logs,
      'error',
      `${PERSISTENCE_LOG_PREFIX} 用户数异常下降，期望 >= ${input.expectedMinUsers}，实际 ${userCount}，拒绝启动`
    );
    return { action: 'exit', logs };
  }

  if (userCount > 10 && favoriteCount === 0) {
    log(
      logs,
      'warn',
      `${PERSISTENCE_LOG_PREFIX} 用户数 ${userCount} 但收藏数为 0，请人工确认是否丢数据`
    );
  }

  log(
    logs,
    'log',
    `${PERSISTENCE_LOG_PREFIX} 持久化检查通过 backend=${input.backend} dbPath=${input.health.dbPath} users=${userCount} favorites=${favoriteCount} tokens=${agentTokenCount}`
  );
  return { action: 'allow', logs };
}

export function applyBootstrapLogs(
  decision: BootstrapDecision,
  logger: Pick<Console, 'log' | 'warn' | 'error'> = console
): void {
  for (const line of decision.logs) {
    logger[line.level](line.message);
  }
}
