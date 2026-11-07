import { config } from './config.js';
import { getDb, getPersistenceHealth } from './db.js';
import { createApp } from './app.js';
import { PERSISTENCE_LOG_PREFIX } from './persistence.js';

/**
 * 生产环境启动保护：检测空库或持久盘缺失时拒绝启动。
 * 
 * 目的：
 * 1. 防止空库响应覆盖客户端旧缓存
 * 2. 防止新数据写入临时层后再次丢失
 * 3. 强制运维修复持久盘配置
 * 
 * 可通过环境变量 PREVENT_EMPTY_DB_START=true 启用（默认生产开启）
 */
function enforceProductionPersistence(): void {
  // 非生产环境：跳过检查，允许本地首次空库启动
  if (config.nodeEnv !== 'production') {
    console.log('[启动保护] 非生产环境，跳过空库检查');
    return;
  }

  // 检查是否启用保护（默认生产环境开启）
  const preventEmptyStart = process.env.PREVENT_EMPTY_DB_START !== 'false';
  if (!preventEmptyStart) {
    console.warn('⚠️  [启动保护] PREVENT_EMPTY_DB_START=false，保护已关闭');
    return;
  }

  console.log('[启动保护] 检查生产环境持久化状态...');
  
  const health = getPersistenceHealth();

  // 检查 1：数据库路径必须在持久盘上
  if (!health.dbPath.startsWith('/data/')) {
    console.error(`${PERSISTENCE_LOG_PREFIX} ❌ 生产环境 DB 路径错误: ${health.dbPath}`);
    console.error(`${PERSISTENCE_LOG_PREFIX}    必须为: /data/miniprogram.db`);
    console.error(`${PERSISTENCE_LOG_PREFIX}    请检查环境变量 DB_PATH`);
    process.exit(1);
  }

  // 检查 2：持久化警告（/data 未正确挂载）
  if (health.warning) {
    console.error(health.warning);
    console.error(`${PERSISTENCE_LOG_PREFIX} ❌ 检测到持久盘问题，拒绝启动`);
    console.error(`${PERSISTENCE_LOG_PREFIX}    请在云托管控制台配置持久盘:`);
    console.error(`${PERSISTENCE_LOG_PREFIX}    挂载路径: /data`);
    console.error(`${PERSISTENCE_LOG_PREFIX}    容量: 1GB`);
    console.error(`${PERSISTENCE_LOG_PREFIX}    类型: CloudStorage`);
    process.exit(1);
  }

  // 检查 3：空库检测（生产不应该启动时发现空库）
  const isEmpty = 
    health.userCount === 0 &&
    health.favoriteCount === 0 &&
    health.agentTokenCount === 0;

  if (isEmpty) {
    console.error(`${PERSISTENCE_LOG_PREFIX} ❌ 生产环境检测到空数据库，拒绝启动`);
    console.error(`${PERSISTENCE_LOG_PREFIX}    userCount: ${health.userCount}`);
    console.error(`${PERSISTENCE_LOG_PREFIX}    favoriteCount: ${health.favoriteCount}`);
    console.error(`${PERSISTENCE_LOG_PREFIX}    agentTokenCount: ${health.agentTokenCount}`);
    console.error(`${PERSISTENCE_LOG_PREFIX}`);
    console.error(`${PERSISTENCE_LOG_PREFIX}    可能原因:`);
    console.error(`${PERSISTENCE_LOG_PREFIX}    1. 持久盘未正确挂载（虽然路径正确）`);
    console.error(`${PERSISTENCE_LOG_PREFIX}    2. 挂载了错误的持久盘（新建的空盘）`);
    console.error(`${PERSISTENCE_LOG_PREFIX}    3. 数据库文件被误删`);
    console.error(`${PERSISTENCE_LOG_PREFIX}`);
    console.error(`${PERSISTENCE_LOG_PREFIX}    拒绝启动原因:`);
    console.error(`${PERSISTENCE_LOG_PREFIX}    - 防止空响应覆盖客户端缓存`);
    console.error(`${PERSISTENCE_LOG_PREFIX}    - 防止新数据写入后再次丢失`);
    console.error(`${PERSISTENCE_LOG_PREFIX}    - 强制运维检查持久盘配置`);
    console.error(`${PERSISTENCE_LOG_PREFIX}`);
    console.error(`${PERSISTENCE_LOG_PREFIX}    如需首次部署或重建数据，请设置:`);
    console.error(`${PERSISTENCE_LOG_PREFIX}    PREVENT_EMPTY_DB_START=false`);
    process.exit(1);
  }

  // 检查通过
  console.log(`${PERSISTENCE_LOG_PREFIX} ✅ 持久化检查通过`);
  console.log(`${PERSISTENCE_LOG_PREFIX}    dbPath: ${health.dbPath}`);
  console.log(`${PERSISTENCE_LOG_PREFIX}    userCount: ${health.userCount}`);
  console.log(`${PERSISTENCE_LOG_PREFIX}    favoriteCount: ${health.favoriteCount}`);
  console.log(`${PERSISTENCE_LOG_PREFIX}    agentTokenCount: ${health.agentTokenCount}`);
}

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

// 启动保护：生产环境空库时拒绝启动
enforceProductionPersistence();

const app = createApp();
app.listen(config.port, () => {
  console.log(
    `[miniprogram-api] http://127.0.0.1:${config.port} adapter=${config.sourceAdapter} NODE_ENV=${config.nodeEnv}`
  );
});
