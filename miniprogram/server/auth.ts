import { randomBytes } from 'node:crypto';
import { v4 as uuidv4 } from 'uuid';
import { config } from './config.js';
import { getDb } from './db.js';
import type { UserRow } from './types.js';

function nowIso(): string {
  return new Date().toISOString();
}

export function createSessionForOpenId(
  openid: string,
  profile?: { nickname?: string; avatar?: string; unionid?: string }
): { token: string; user: UserRow } {
  const db = getDb();
  let user = db
    .prepare('SELECT * FROM users WHERE openid = ?')
    .get(openid) as UserRow | undefined;

  if (!user) {
    user = {
      id: uuidv4(),
      openid,
      unionid: profile?.unionid || null,
      nickname: profile?.nickname || null,
      avatar: profile?.avatar || null,
      created_at: nowIso(),
    };
    db.prepare(
      `INSERT INTO users (id, openid, unionid, nickname, avatar, created_at)
       VALUES (@id, @openid, @unionid, @nickname, @avatar, @created_at)`
    ).run(user);
  } else if (profile?.nickname || profile?.avatar) {
    db.prepare(
      `UPDATE users SET nickname = COALESCE(?, nickname), avatar = COALESCE(?, avatar)
       WHERE id = ?`
    ).run(profile.nickname || null, profile.avatar || null, user.id);
    user = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id) as UserRow;
  }

  const token = randomBytes(24).toString('hex');
  db.prepare(
    'INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)'
  ).run(token, user.id, nowIso());

  return { token, user };
}

export type WxGatewayIdentity = {
  openid: string;
  unionid?: string;
};

export type LoginWithWxCodeOptions = {
  /** callContainer 网关已验过的身份；有则不再出网换票 */
  gateway?: WxGatewayIdentity | null;
  /** 测试可注入，避免真打微信 */
  fetchImpl?: typeof fetch;
};

function trimHeader(value: string | undefined | null): string {
  return (value || '').trim();
}

/**
 * 从云托管注入头里读用户是谁。
 *
 * 产品意图：用户从小程序进来时，微信通道已经验过身份，
 * 服务端直接认这张「通行证」，不必再打电话问微信「这人是谁」。
 *
 * 肥猫的云在「美食探索」账号下（资源复用）。官方说明此时
 * X-WX-OPENID 常常没有，真正的调用方 openid 在 X-WX-FROM-OPENID。
 * 所以 FROM-* 优先，普通环境再回退到 X-WX-OPENID。
 *
 * @see https://developers.weixin.qq.com/miniprogram/dev/wxcloudservice/wxcloudrun/src/development/weixin/
 */
export function readWxGatewayIdentity(
  getHeader: (name: string) => string | undefined
): WxGatewayIdentity | null {
  const openid = trimHeader(
    getHeader('x-wx-from-openid') || getHeader('x-wx-openid')
  );
  if (!openid) return null;
  const unionid = trimHeader(
    getHeader('x-wx-from-unionid') || getHeader('x-wx-unionid')
  );
  return { openid, unionid: unionid || undefined };
}

/** Node 出网失败时 message 经常只是 "fetch failed"，用户看不懂 */
function mapWxOutboundError(err: unknown): Error {
  const raw = err instanceof Error ? err.message : String(err || '');
  console.error('[auth] jscode2session 出网失败', raw);
  const isNetwork =
    !raw ||
    /fetch failed|Failed to fetch|ENOTFOUND|ECONNRESET|ETIMEDOUT|ECONNREFUSED|EAI_AGAIN|network|socket/i.test(
      raw
    );
  const message = isNetwork
    ? '无法连接微信登录服务，请稍后重试'
    : `微信登录失败：${raw}`.slice(0, 80);
  return Object.assign(new Error(message), { status: 502 });
}

/**
 * 登录：正式环境优先用网关注入的 openid；没有头再 code 换票；开发态可用 bypass。
 * 密钥走 WECHAT_APP_SECRET，不硬编码、也不在有网关头时强求。
 */
export async function loginWithWxCode(
  code: string,
  options?: LoginWithWxCodeOptions
): Promise<{ token: string; user: UserRow }> {
  if (config.devAuthBypass) {
    const openid = `${config.devOpenIdPrefix}${code || 'anonymous'}`;
    return createSessionForOpenId(openid);
  }

  const gatewayOpenId = trimHeader(options?.gateway?.openid);
  if (gatewayOpenId) {
    return createSessionForOpenId(gatewayOpenId, {
      unionid: options?.gateway?.unionid,
    });
  }

  return loginWithCode2Session(code, options?.fetchImpl);
}

/** 公网调试 / 无网关头时：用 wx.login 的 code 向微信换 openid */
async function loginWithCode2Session(
  code: string,
  fetchImpl?: typeof fetch
): Promise<{ token: string; user: UserRow }> {
  const jsCode = trimHeader(code);
  if (!jsCode) {
    throw Object.assign(new Error('缺少微信登录 code'), { status: 400 });
  }
  if (!config.wechatAppSecret) {
    throw Object.assign(new Error('未配置 WECHAT_APP_SECRET'), { status: 500 });
  }

  const url = new URL('https://api.weixin.qq.com/sns/jscode2session');
  url.searchParams.set('appid', config.wechatAppId);
  url.searchParams.set('secret', config.wechatAppSecret);
  url.searchParams.set('js_code', jsCode);
  url.searchParams.set('grant_type', 'authorization_code');

  const doFetch = fetchImpl || fetch;
  let res: Response;
  try {
    res = await doFetch(url.toString());
  } catch (err) {
    throw mapWxOutboundError(err);
  }

  let data: {
    openid?: string;
    unionid?: string;
    errcode?: number;
    errmsg?: string;
  };
  try {
    data = (await res.json()) as typeof data;
  } catch {
    throw Object.assign(new Error('微信登录服务返回异常'), { status: 502 });
  }
  if (!data.openid) {
    throw Object.assign(new Error(data.errmsg || '微信登录失败'), {
      status: 401,
    });
  }
  return createSessionForOpenId(data.openid, { unionid: data.unionid });
}

export function resolveSession(
  authorization: string | undefined
): { userId: string; openid: string } | null {
  if (!authorization) return null;
  const token = authorization.replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;
  const row = getDb()
    .prepare(
      `SELECT s.user_id as userId, u.openid as openid
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token = ?`
    )
    .get(token) as { userId: string; openid: string } | undefined;
  return row || null;
}

/**
 * 撤销指定会话票。
 * 产品意图：「退出登录 / 撤销授权」后，这台设备上的票立刻作废，不能再调需登录接口。
 */
export function revokeSession(token: string): void {
  if (!token) return;
  getDb().prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

/**
 * 内容安全占位：有密钥时可接 msgSecCheck；测试/无密钥时放行。
 * 产品意图：圈名/昵称/备注上线前走微信审核接口。
 */
export async function msgSecCheck(content: string): Promise<boolean> {
  if (!content || !content.trim()) return true;
  if (config.devAuthBypass || !config.wechatAppSecret) return true;
  // 正式接入需 access_token + msgSecCheck；此处保留扩展点
  return true;
}
