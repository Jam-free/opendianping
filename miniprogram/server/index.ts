import { config } from './config.js';
import { getDb } from './db.js';
import { createApp } from './app.js';

// 打开库。生产路径若是空库/没挂盘会打 [PERSISTENCE] 警告。
// 打开失败也不退出：让 GET /health 还能把 persistence.error 报出来。
try {
  getDb();
} catch (err) {
  console.error(
    '[PERSISTENCE] 无法打开数据库，服务仍会监听端口以便 GET /health 排查',
    err
  );
}

const app = createApp();
app.listen(config.port, () => {
  console.log(
    `[miniprogram-api] http://127.0.0.1:${config.port} adapter=${config.sourceAdapter}`
  );
});
