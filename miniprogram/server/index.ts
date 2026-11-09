import { config } from './config.js';
import { createApp } from './app.js';
import { shutdownBackup } from './backup.js';
import {
  applyBootstrapLogs,
  evaluateBootstrapGate,
} from './bootstrap.js';
import { closeDb, getDb, getPersistenceHealth, markMysqlUnreachable, startupDatabase } from './db.js';
import { isMysqlRequested, resolveDbBackend } from './engine/resolve-backend.js';
import { PERSISTENCE_LOG_PREFIX } from './persistence.js';

async function main(): Promise<void> {
  // 打开库。生产路径若是空库/没挂盘会打 [PERSISTENCE] 警告；真卷上尝试 COS 自愈。
  try {
    await startupDatabase();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      `${PERSISTENCE_LOG_PREFIX} 无法打开数据库，服务仍会监听端口以便 GET /health 排查`,
      err
    );
    if (isMysqlRequested()) {
      markMysqlUnreachable(message);
    } else {
      try {
        getDb();
      } catch {
        /* 二次失败留给 /health persistence.error */
      }
    }
  }

  const mysqlConfigured = (() => {
    try {
      const resolved = resolveDbBackend();
      return resolved.dialect === 'mysql';
    } catch {
      return false;
    }
  })();
  const health = getPersistenceHealth();
  const decision = evaluateBootstrapGate({
    nodeEnv: config.nodeEnv,
    backend: health.backend ?? (mysqlConfigured ? 'mysql' : 'sqlite'),
    preventEmptyStart: process.env.PREVENT_EMPTY_DB_START !== 'false',
    expectedMinUsers: Number(process.env.EXPECTED_MIN_USERS || 0),
    health,
    mysqlConfigured,
  });
  applyBootstrapLogs(decision);
  if (decision.action === 'exit') {
    process.exit(1);
  }

  const app = createApp();
  app.listen(config.port, () => {
    console.log(
      `[miniprogram-api] http://127.0.0.1:${config.port} adapter=${config.sourceAdapter}`
    );
  });

  const onShutdown = (signal: string) => {
    console.log(`[miniprogram-api] 收到 ${signal}，尝试备份后退出`);
    void (async () => {
      try {
        await shutdownBackup({ database: getDb(), flush: true });
      } catch (err) {
        console.error('[BACKUP] SIGTERM 备份失败', err);
      }
      closeDb();
      process.exit(0);
    })();
  };

  process.on('SIGTERM', () => onShutdown('SIGTERM'));
  process.on('SIGINT', () => onShutdown('SIGINT'));
}

void main();
