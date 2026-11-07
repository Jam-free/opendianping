import { config } from './config.js';
import { getDb, getPersistenceHealth } from './db.js';
import { createApp } from './app.js';
import { PERSISTENCE_LOG_PREFIX } from './persistence.js';

/**
 * 生产环境启动保护：检测数据丢失或持久盘缺失时拒绝启动。
 * 
 * 目的：
 * 1. 防止新数据写入临时层后再次丢失
 * 2. 防止用户看到空列表后误操作
 * 3. 强制运维检查持久盘配置
 * 
 * 可通过环境变量 PREVENT_EMPTY_DB_START=true 启用（默认生产开启）
 * 
 * 区分三种情况：
 * - 新环境 bootstrap（EXPECTED_MIN_USERS=0）
 * - 空库/数据丢失（实际=0 但期望>0）
 * - 部分数据丢失（某些表为空但其他表有数据）
 */
function enforceProductionPersistence(): void {
  // 非生产环境：跳过检查，允许本地首次空库启动
  if (config.nodeEnv !== 'production') {
    console.log('[启动保护] 非生产环境，跳过持久化检查');
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
    console.error(`${PERSISTENCE_LOG_PREFIX}    请在云托管控制台配置持久盘`);
    process.exit(1);
  }

  // 检查 3：数据丢失检测
  // 允许设置期望的最小用户数（新环境设为0，生产环境设为实际值）
  const expectedMinUsers = Number(process.env.EXPECTED_MIN_USERS || -1);
  const userCount = health.userCount ?? 0;
  const favoriteCount = health.favoriteCount ?? 0;
  const agentTokenCount = health.agentTokenCount ?? 0;

  // 新环境 bootstrap：期望用户数=0，允许启动
  if (expectedMinUsers === 0) {
    console.log(`${PERSISTENCE_LOG_PREFIX} ✅ 新环境 bootstrap（EXPECTED_MIN_USERS=0）`);
    console.log(`${PERSISTENCE_LOG_PREFIX}    允许空库启动`);
    return;
  }

  // 完全空库检测
  const isCompletelyEmpty = userCount === 0 && favoriteCount === 0 && agentTokenCount === 0;
  
  if (isCompletelyEmpty) {
    // 如果没有设置期望值，拒绝启动（疑似数据丢失）
    if (expectedMinUsers < 0) {
      console.error(`${PERSISTENCE_LOG_PREFIX} ❌ 生产环境检测到完全空库，拒绝启动`);
      console.error(`${PERSISTENCE_LOG_PREFIX}    userCount: ${userCount}`);
      console.error(`${PERSISTENCE_LOG_PREFIX}    favoriteCount: ${favoriteCount}`);
      console.error(`${PERSISTENCE_LOG_PREFIX}    agentTokenCount: ${agentTokenCount}`);
      console.error(`${PERSISTENCE_LOG_PREFIX}`);
      console.error(`${PERSISTENCE_LOG_PREFIX}    可能原因:`);
      console.error(`${PERSISTENCE_LOG_PREFIX}    1. 持久盘未正确挂载`);
      console.error(`${PERSISTENCE_LOG_PREFIX}    2. 挂载了错误的持久盘（新建的空盘）`);
      console.error(`${PERSISTENCE_LOG_PREFIX}    3. 数据库文件被误删`);
      console.error(`${PERSISTENCE_LOG_PREFIX}`);
      console.error(`${PERSISTENCE_LOG_PREFIX}    如需首次部署，请设置:`);
      console.error(`${PERSISTENCE_LOG_PREFIX}    EXPECTED_MIN_USERS=0`);
      process.exit(1);
    }
  }

  // 用户数检测：如果设置了期望值且实际值低于期望，拒绝启动
  if (expectedMinUsers > 0 && userCount < expectedMinUsers) {
    console.error(`${PERSISTENCE_LOG_PREFIX} ❌ 用户数异常下降，拒绝启动`);
    console.error(`${PERSISTENCE_LOG_PREFIX}    期望: >= ${expectedMinUsers}`);
    console.error(`${PERSISTENCE_LOG_PREFIX}    实际: ${userCount}`);
    console.error(`${PERSISTENCE_LOG_PREFIX}    疑似数据丢失`);
    process.exit(1);
  }

  // 部分数据丢失检测（有用户但其他表为空）
  if (userCount > 0) {
    const issues: string[] = [];
    
    // 合理场景：新用户可能没有收藏
    // 但如果用户数较多（>10）而收藏数=0，可能异常
    if (userCount > 10 && favoriteCount === 0) {
      issues.push(`用户数${userCount}但收藏数为0`);
    }
    
    if (issues.length > 0) {
      console.warn(`${PERSISTENCE_LOG_PREFIX} ⚠️  检测到数据异常（非致命）:`);
      issues.forEach(issue => {
        console.warn(`${PERSISTENCE_LOG_PREFIX}    - ${issue}`);
      });
      console.warn(`${PERSISTENCE_LOG_PREFIX}    如确认正常，可忽略`);
    }
  }

  // 检查通过
  console.log(`${PERSISTENCE_LOG_PREFIX} ✅ 持久化检查通过`);
  console.log(`${PERSISTENCE_LOG_PREFIX}    dbPath: ${health.dbPath}`);
  console.log(`${PERSISTENCE_LOG_PREFIX}    userCount: ${userCount}`);
  console.log(`${PERSISTENCE_LOG_PREFIX}    favoriteCount: ${favoriteCount}`);
  console.log(`${PERSISTENCE_LOG_PREFIX}    agentTokenCount: ${agentTokenCount}`);
  if (expectedMinUsers > 0) {
    console.log(`${PERSISTENCE_LOG_PREFIX}    期望最小用户数: ${expectedMinUsers}`);
  }
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
