import type { MysqlConnectionConfig, ResolvedDbBackend } from './types.js';

function envBool(env: NodeJS.Dict<string>, key: string): boolean | undefined {
  const v = env[key];
  if (v === undefined || v === '') return undefined;
  if (['1', 'true', 'yes', 'on'].includes(v.toLowerCase())) return true;
  if (['0', 'false', 'no', 'off'].includes(v.toLowerCase())) return false;
  return undefined;
}

export function parseMysqlAddress(address: string): { host: string; port: number } {
  const trimmed = address.trim();
  const idx = trimmed.lastIndexOf(':');
  if (idx <= 0) return { host: trimmed, port: 3306 };
  const host = trimmed.slice(0, idx);
  const port = Number(trimmed.slice(idx + 1) || 3306);
  return { host, port: Number.isFinite(port) ? port : 3306 };
}

export function parseDatabaseUrl(url: string): MysqlConnectionConfig {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('DATABASE_URL 不是合法 URL（示例：mysql://USER:PASSWORD@HOST:3306/feimaocat）');
  }
  if (parsed.protocol !== 'mysql:' && parsed.protocol !== 'mysql2:') {
    throw new Error(`DATABASE_URL 协议必须是 mysql://，现在是 ${parsed.protocol}`);
  }
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, '').split('/')[0] || '');
  if (!database) {
    throw new Error('DATABASE_URL 缺少数据库名（路径部分，例如 /feimaocat）');
  }
  return {
    host: parsed.hostname,
    port: Number(parsed.port || 3306),
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database,
  };
}

export function mysqlSummary(cfg: MysqlConnectionConfig): string {
  return `mysql://${cfg.user}@${cfg.host}:${cfg.port}/${cfg.database}`;
}

/**
 * 决定用 SQLite 还是 MySQL。
 * 优先级：DATABASE_URL（mysql）> DB_BACKEND=mysql > MYSQL_ADDRESS > 默认 SQLite。
 * 生产不要静默回退到容器盘 SQLite：一旦明确要 MySQL，缺连接信息就报错，而不是再建一个空文件库。
 */
export function resolveDbBackend(
  env: NodeJS.Dict<string> = process.env
): ResolvedDbBackend {
  const url = (env.DATABASE_URL || '').trim();
  if (url.startsWith('mysql://') || url.startsWith('mysql2://')) {
    return {
      dialect: 'mysql',
      reason: 'DATABASE_URL',
      mysql: parseDatabaseUrl(url),
    };
  }

  const backend = (env.DB_BACKEND || '').trim().toLowerCase();
  const address = (env.MYSQL_ADDRESS || '').trim();
  const wantMysql = backend === 'mysql' || Boolean(address);

  if (backend === 'sqlite') {
    return { dialect: 'sqlite', reason: 'DB_BACKEND=sqlite' };
  }

  if (wantMysql) {
    if (url && !url.startsWith('mysql://') && !url.startsWith('mysql2://')) {
      throw new Error('已选择 MySQL，但 DATABASE_URL 不是 mysql://');
    }
    const user = (env.MYSQL_USERNAME || env.MYSQL_USER || '').trim();
    const password = env.MYSQL_PASSWORD ?? '';
    const database = (env.MYSQL_DATABASE || env.MYSQL_DB || 'feimaocat').trim();
    if (!address) {
      throw new Error(
        'DB_BACKEND=mysql 但缺少 MYSQL_ADDRESS。请在云托管控制台填写 MYSQL_ADDRESS / MYSQL_USERNAME / MYSQL_PASSWORD（或改用 DATABASE_URL）。'
      );
    }
    if (!user) {
      throw new Error('缺少 MYSQL_USERNAME。云托管 MySQL 控制台可复制用户名。');
    }
    const { host, port } = parseMysqlAddress(address);
    return {
      dialect: 'mysql',
      reason: backend === 'mysql' ? 'DB_BACKEND=mysql' : 'MYSQL_ADDRESS',
      mysql: { host, port, user, password, database },
    };
  }

  return { dialect: 'sqlite', reason: 'default sqlite (no DATABASE_URL / MYSQL_ADDRESS)' };
}

export function isMysqlRequested(env: NodeJS.Dict<string> = process.env): boolean {
  const backend = (env.DB_BACKEND || '').trim().toLowerCase();
  if (backend === 'sqlite') return false;
  const url = (env.DATABASE_URL || '').trim();
  return (
    backend === 'mysql' ||
    url.startsWith('mysql://') ||
    url.startsWith('mysql2://') ||
    Boolean((env.MYSQL_ADDRESS || '').trim())
  );
}

export function envFlag(
  env: NodeJS.Dict<string>,
  key: string,
  fallback: boolean
): boolean {
  return envBool(env, key) ?? fallback;
}
