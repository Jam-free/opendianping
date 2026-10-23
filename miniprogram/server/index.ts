import { config } from './config.js';
import { getDb } from './db.js';
import { createApp } from './app.js';

// 启动时初始化 DB
getDb();

const app = createApp();
app.listen(config.port, () => {
  console.log(
    `[miniprogram-api] http://127.0.0.1:${config.port} adapter=${config.sourceAdapter}`
  );
});
