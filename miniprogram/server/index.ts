import { config } from './config.js';
import { createApp } from './app.js';
import { shutdownBackup } from './backup.js';
import { closeDb, getDb, startupDatabase } from './db.js';
import { PERSISTENCE_LOG_PREFIX } from './persistence.js';

async function main(): Promise<void> {
  // 打开库。生产路径若是空库/没挂盘会打 [PERSISTENCE] 警告；真卷上尝试 COS 自愈。
  try {
    await startupDatabase();
  } catch (err) {
    console.error(
      `${PERSISTENCE_LOG_PREFIX} 无法打开数据库，服务仍会监听端口以便 GET /health 排查`,
      err
    );
    try {
      getDb();
    } catch {
      /* 二次失败留给 /health persistence.error */
    }
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
