import { createHash, randomBytes } from 'node:crypto';
import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../db.js';
import {
  formatDistanceLabel,
  haversineMeters,
} from '../utils/geo.js';
import { buildProxyPath } from './media-proxy.js';
import { createCircle, listCircleMembers } from './circles.js';

const PERSONAL_NETWORK_NAME = '我的美食网';

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * 首次进入自动确保用户拥有「我的美食网」。
 * 产品层不展示「创建圈子」，只复用 circles 表做邀请与共享。
 */
export async function ensurePersonalNetwork(userId: string) {
  const db = getDb();
  const owned = db
    .prepare(
      `SELECT c.id, c.name, c.invite_token, c.token_expires_at,
              (SELECT COUNT(*) FROM circle_members m WHERE m.circle_id = c.id) AS member_count
       FROM circles c
       WHERE c.owner_id = ?
       ORDER BY c.created_at ASC
       LIMIT 1`
    )
    .get(userId) as
    | {
        id: string;
        name: string;
        invite_token: string;
        token_expires_at: string;
        member_count: number;
      }
    | undefined;

  if (owned) {
    return {
      id: owned.id,
      name: owned.name,
      inviteToken: owned.invite_token,
      tokenExpiresAt: owned.token_expires_at,
      memberCount: owned.member_count,
    };
  }

  const created = await createCircle(userId, PERSONAL_NETWORK_NAME);
  return {
    id: created.id,
    name: created.name,
    inviteToken: created.inviteToken,
    tokenExpiresAt: created.tokenExpiresAt,
    memberCount: 1,
  };
}

/** Tab1：通过我的邀请进入的美食好友（不含自己） */
export async function listFoodFriends(userId: string) {
  const network = await ensurePersonalNetwork(userId);
  const members = listCircleMembers(userId, network.id) as Array<{
    id: string;
    nickname: string | null;
    avatar: string | null;
    role: string;
    joined_at: string;
    shared_shop_count: number;
  }>;

  return {
    networkId: network.id,
    inviteToken: network.inviteToken,
    tokenExpiresAt: network.tokenExpiresAt,
    memberCount: network.memberCount,
    friends: members
      .filter((m) => m.id !== userId)
      .map((m) => ({
        id: m.id,
        nickname: m.nickname,
        avatar: m.avatar,
        role: m.role,
        joinedAt: m.joined_at,
        sharedShopCount: Number(m.shared_shop_count) || 0,
      })),
  };
}

type MyShopRow = {
  favorite_id: string;
  shop_id: string;
  poi_key: string;
  name: string;
  avg_price: string | null;
  category: string | null;
  district: string | null;
  city: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  source_type: string;
  head_img: string | null;
  note: string | null;
  visibility: string;
  created_at: string;
  origin: string;
};

/**
 * Tab2：我导入的 + 我记下的 + 我从好友清单收藏的店。
 * origin: imported | checkin | from_friend
 */
export async function listMyShops(
  userId: string,
  opts?: { lat?: number; lng?: number; userCity?: string }
) {
  await ensurePersonalNetwork(userId);
  const rows = getDb()
    .prepare(
      `SELECT f.id AS favorite_id, s.id AS shop_id,
              COALESCE(s.source_shop_id, s.amap_poi_id, s.id) AS poi_key,
              s.raw_name AS name, s.avg_price, s.category, s.district, s.city,
              s.address, s.lat, s.lng, s.source_type, s.head_img,
              f.note, f.visibility, f.created_at,
              CASE
                WHEN s.source_type IN ('photo', 'locate') THEN 'checkin'
                WHEN f.import_batch_id IS NOT NULL THEN 'imported'
                ELSE 'from_friend'
              END AS origin
       FROM favorites f
       JOIN shops s ON s.id = f.shop_id
       WHERE f.user_id = ?
       ORDER BY f.created_at DESC`
    )
    .all(userId) as MyShopRow[];

  const originLabel: Record<string, string> = {
    imported: '我导入',
    checkin: '我记下',
    from_friend: '来自好友',
  };

  const items = rows.map((r) => {
    let distanceMeters: number | undefined;
    let distanceLabel: string | undefined;
    if (
      opts?.lat != null &&
      opts?.lng != null &&
      r.lat != null &&
      r.lng != null
    ) {
      distanceMeters = haversineMeters(opts.lat, opts.lng, r.lat, r.lng);
      distanceLabel = formatDistanceLabel(distanceMeters, {
        userCity: opts.userCity,
        shopCity: r.city,
      });
    }
    return {
      favoriteId: r.favorite_id,
      shopId: r.shop_id,
      poiKey: r.poi_key,
      name: r.name,
      avgPrice: r.avg_price,
      category: r.category,
      district: r.district,
      city: r.city,
      address: r.address,
      lat: r.lat,
      lng: r.lng,
      sourceType: r.source_type,
      headImg: r.head_img,
      headImgProxy: r.head_img ? buildProxyPath(r.head_img) : null,
      note: r.note,
      visibility: r.visibility,
      createdAt: r.created_at,
      origin: r.origin,
      sourceTag: originLabel[r.origin] || '',
      hasCoords: r.lat != null && r.lng != null,
      distanceMeters,
      distanceLabel,
      recommendersLine: originLabel[r.origin] || '',
      collectors: [],
      collectorCount: 0,
    };
  });

  if (opts?.lat != null && opts?.lng != null) {
    items.sort((a, b) => {
      if (a.distanceMeters == null && b.distanceMeters == null) return 0;
      if (a.distanceMeters == null) return 1;
      if (b.distanceMeters == null) return -1;
      return a.distanceMeters - b.distanceMeters;
    });
  }

  return { items };
}

/**
 * 记美食：在当前位置创建一家店并收藏，默认对美食好友可见。
 */
export async function createCheckin(
  userId: string,
  input: {
    name: string;
    note?: string;
    lat: number;
    lng: number;
    address?: string;
    photoUrl?: string;
  }
) {
  await ensurePersonalNetwork(userId);
  const name = (input.name || '').trim().slice(0, 60);
  if (!name) {
    throw Object.assign(new Error('请填写店名或地点名'), { status: 400 });
  }
  if (!Number.isFinite(input.lat) || !Number.isFinite(input.lng)) {
    throw Object.assign(new Error('需要有效定位'), { status: 400 });
  }

  const db = getDb();
  const shopId = uuidv4();
  const favId = uuidv4();
  const note = (input.note || '').trim().slice(0, 200) || null;
  const createdAt = nowIso();

  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO shops (
         id, source_type, source_shop_id, amap_poi_id, raw_name, adcode,
         category, district, city, address, avg_price, lat, lng,
         source_url, head_img, display_cache_policy
       ) VALUES (?, 'locate', NULL, NULL, ?, NULL, NULL, NULL, NULL, ?, NULL, ?, ?, NULL, ?, 'minimal')`
    ).run(
      shopId,
      name,
      input.address || null,
      input.lat,
      input.lng,
      input.photoUrl || null
    );

    db.prepare(
      `INSERT INTO favorites (id, user_id, shop_id, note, visibility, import_batch_id, created_at, photo_url)
       VALUES (?, ?, ?, ?, 'circles', NULL, ?, ?)`
    ).run(
      favId,
      userId,
      shopId,
      note,
      createdAt,
      input.photoUrl || null
    );
  });
  tx();

  return {
    favoriteId: favId,
    shopId,
    poiKey: shopId,
    name,
  };
}

export function updateUserProfile(
  userId: string,
  patch: { nickname?: string; avatar?: string }
) {
  const nickname = patch.nickname?.trim().slice(0, 32) || null;
  const avatar = patch.avatar?.trim().slice(0, 500) || null;
  if (!nickname && !avatar) {
    throw Object.assign(new Error('请提供昵称或头像'), { status: 400 });
  }
  getDb()
    .prepare(
      `UPDATE users SET
         nickname = COALESCE(?, nickname),
         avatar = COALESCE(?, avatar)
       WHERE id = ?`
    )
    .run(nickname, avatar, userId);

  return getDb()
    .prepare(`SELECT id, nickname, avatar FROM users WHERE id = ?`)
    .get(userId);
}

export function getUserProfile(userId: string) {
  return getDb()
    .prepare(`SELECT id, nickname, avatar, created_at FROM users WHERE id = ?`)
    .get(userId);
}

function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

/** 签发连接 AI 用的个人 Token（明文只返回一次） */
export function issueAgentToken(userId: string) {
  const db = getDb();
  const raw = `fm_${randomBytes(24).toString('hex')}`;
  const id = uuidv4();
  const prefix = raw.slice(0, 10);
  const createdAt = nowIso();

  db.prepare(`DELETE FROM agent_tokens WHERE user_id = ?`).run(userId);
  db.prepare(
    `INSERT INTO agent_tokens (id, user_id, token_hash, token_prefix, created_at, last_used_at)
     VALUES (?, ?, ?, ?, ?, NULL)`
  ).run(id, userId, hashToken(raw), prefix, createdAt);

  return {
    token: raw,
    prefix,
    createdAt,
    lastUsedAt: null as string | null,
  };
}

export function getAgentTokenMeta(userId: string) {
  return getDb()
    .prepare(
      `SELECT token_prefix AS prefix, created_at AS createdAt, last_used_at AS lastUsedAt
       FROM agent_tokens WHERE user_id = ? LIMIT 1`
    )
    .get(userId) as
    | { prefix: string; createdAt: string; lastUsedAt: string | null }
    | undefined;
}

export function resolveAgentToken(
  authorization: string | undefined
): { userId: string } | null {
  if (!authorization) return null;
  const raw = authorization.replace(/^Bearer\s+/i, '').trim();
  if (!raw.startsWith('fm_')) return null;
  const row = getDb()
    .prepare(
      `SELECT user_id AS userId FROM agent_tokens WHERE token_hash = ?`
    )
    .get(hashToken(raw)) as { userId: string } | undefined;
  if (!row) return null;
  getDb()
    .prepare(`UPDATE agent_tokens SET last_used_at = ? WHERE user_id = ?`)
    .run(nowIso(), row.userId);
  return row;
}

/** Agent 只读：本人收藏 + 美食网内好友共享店（去重） */
export async function listAgentShops(userId: string) {
  const network = await ensurePersonalNetwork(userId);
  const mine = await listMyShops(userId);
  const friendRows = getDb()
    .prepare(
      `SELECT DISTINCT
              COALESCE(s.source_shop_id, s.amap_poi_id, s.id) AS poi_key,
              s.raw_name AS name, s.category, s.district, s.city, s.address,
              s.lat, s.lng, s.avg_price, u.nickname AS from_friend
       FROM circle_members cm
       JOIN favorites f ON f.user_id = cm.user_id AND f.visibility = 'circles'
       JOIN shops s ON s.id = f.shop_id
       JOIN users u ON u.id = cm.user_id
       WHERE cm.circle_id = ? AND cm.user_id != ?`
    )
    .all(network.id, userId) as Array<Record<string, unknown>>;

  return {
    mine: mine.items.map((s) => ({
      poiKey: s.poiKey,
      name: s.name,
      category: s.category,
      district: s.district,
      city: s.city,
      address: s.address,
      lat: s.lat,
      lng: s.lng,
      note: s.note,
      origin: s.origin,
    })),
    friendsShared: friendRows,
  };
}

export async function listAgentFriends(userId: string) {
  const data = await listFoodFriends(userId);
  return {
    friends: data.friends.map((f) => ({
      id: f.id,
      nickname: f.nickname,
      sharedShopCount: f.sharedShopCount,
    })),
  };
}
