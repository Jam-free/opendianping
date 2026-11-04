import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

dotenv.config({ path: path.join(rootDir, '.env') });

export type SourceAdapterName = 'opendianping' | 'text_amap';

function envBool(key: string, fallback: boolean): boolean {
  const v = process.env[key];
  if (v === undefined || v === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
}

/**
 * 集中读取环境变量：密钥不进仓库，只走 env（见 .env.example）。
 * 产品意图：换部署环境时只改配置，不改代码。
 */
export const config = {
  port: Number(process.env.PORT || 8787),
  rootDir,
  // 生产必须是 /data/miniprogram.db（持久盘）；本地才用 ./data。禁止无盘发布。
  dbPath: path.resolve(rootDir, process.env.DB_PATH || './data/miniprogram.db'),
  // 有 albumid 时强制走内置专辑解析；无链接时默认文本名单
  sourceAdapter: (process.env.SOURCE_ADAPTER || 'opendianping') as SourceAdapterName,
  importRateLimitPerMin: Number(process.env.IMPORT_RATE_LIMIT_PER_MIN || 5),
  importMaxShops: Number(process.env.IMPORT_MAX_SHOPS || 200),
  /** Agent 写入「我的店」：每 Token/用户每分钟、每天上限 */
  agentShopWritePerMin: Number(process.env.AGENT_SHOP_WRITE_PER_MIN || 30),
  agentShopWritePerDay: Number(process.env.AGENT_SHOP_WRITE_PER_DAY || 200),
  wechatAppId: process.env.WECHAT_APPID || 'touristappid',
  wechatAppSecret: process.env.WECHAT_APP_SECRET || '',
  /** 开发态绕过微信登录；生产必须关闭 */
  devAuthBypass: envBool('DEV_AUTH_BYPASS', true),
  devOpenIdPrefix: process.env.DEV_OPENID_PREFIX || 'dev_',
  amapKey: process.env.AMAP_KEY || '',
  /** 腾讯位置服务 Key（逆地理 / 文本补 POI）；与 AMAP_KEY 二选一即可 */
  tencentMapKey: process.env.TENCENT_MAP_KEY || '',
  /** 邀请 token 有效天数 */
  inviteTokenDays: 7,
  circleMemberLimit: 200,
};
