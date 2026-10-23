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

/**
 * 登录：正式环境用 code 换 openid；开发态可用 bypass。
 * 密钥走 WECHAT_APP_SECRET，不硬编码。
 */
export async function loginWithWxCode(
  code: string
): Promise<{ token: string; user: UserRow }> {
  if (config.devAuthBypass) {
    const openid = `${config.devOpenIdPrefix}${code || 'anonymous'}`;
    return createSessionForOpenId(openid);
  }

  if (!config.wechatAppSecret) {
    throw Object.assign(new Error('未配置 WECHAT_APP_SECRET'), { status: 500 });
  }

  const url = new URL('https://api.weixin.qq.com/sns/jscode2session');
  url.searchParams.set('appid', config.wechatAppId);
  url.searchParams.set('secret', config.wechatAppSecret);
  url.searchParams.set('js_code', code);
  url.searchParams.set('grant_type', 'authorization_code');

  const res = await fetch(url.toString());
  const data = (await res.json()) as {
    openid?: string;
    unionid?: string;
    errcode?: number;
    errmsg?: string;
  };
  if (!data.openid) {
    throw Object.assign(
      new Error(data.errmsg || '微信登录失败'),
      { status: 401 }
    );
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
 * 内容安全占位：有密钥时可接 msgSecCheck；测试/无密钥时放行。
 * 产品意图：圈名/昵称/备注上线前走微信审核接口。
 */
export async function msgSecCheck(content: string): Promise<boolean> {
  if (!content || !content.trim()) return true;
  if (config.devAuthBypass || !config.wechatAppSecret) return true;
  // 正式接入需 access_token + msgSecCheck；此处保留扩展点
  return true;
}
