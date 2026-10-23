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
  dbPath: path.resolve(rootDir, process.env.DB_PATH || './data/miniprogram.db'),
  sourceAdapter: (process.env.SOURCE_ADAPTER || 'opendianping') as SourceAdapterName,
  importRateLimitPerMin: Number(process.env.IMPORT_RATE_LIMIT_PER_MIN || 5),
  importMaxShops: Number(process.env.IMPORT_MAX_SHOPS || 200),
  wechatAppId: process.env.WECHAT_APPID || 'touristappid',
  wechatAppSecret: process.env.WECHAT_APP_SECRET || '',
  /** 开发态绕过微信登录；生产必须关闭 */
  devAuthBypass: envBool('DEV_AUTH_BYPASS', true),
  devOpenIdPrefix: process.env.DEV_OPENID_PREFIX || 'dev_',
  amapKey: process.env.AMAP_KEY || '',
  /** 邀请 token 有效天数 */
  inviteTokenDays: 7,
  circleMemberLimit: 200,
};
