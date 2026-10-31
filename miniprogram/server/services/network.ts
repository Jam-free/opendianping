import { createHash, randomBytes } from 'node:crypto';
import { v4 as uuidv4 } from 'uuid';
import { msgSecCheck } from '../auth.js';
import { getDb } from '../db.js';
import { tryConsumeAgentShopWrite } from '../rate-limit.js';
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
  phone: string | null;
  note: string | null;
  visibility: string;
  created_at: string;
  origin: string;
  status: 'confirmed' | 'pending';
  wishlist: number;
  photo_url: string | null;
};

/** 小程序「我的店」来源文案；Agent 记下单独一条，避免和「记美食」混成 checkin */
const MY_SHOP_ORIGIN_LABEL: Record<string, string> = {
  imported: '我导入',
  checkin: '我记下',
  from_friend: '来自好友',
  agent: 'Agent 记下',
};

/**
 * H3：有合法 poiKey（amap_poi_id）或专辑导入带来的真实点评 id → confirmed。
 * Agent 只存了一个尚未核验的点评数字 id → pending（服务端没有可靠的单店定位接口）。
 * 仅有未校验坐标、或只有内部 UUID → pending。内部 id 不当作点评 shopId。
 */
function deriveShopStatus(row: {
  amap_poi_id?: string | null;
  source_shop_id?: string | null;
  source_type?: string | null;
  dianping_verified?: number | boolean | null;
}): 'confirmed' | 'pending' {
  const hasPoi = Boolean(row.amap_poi_id && row.amap_poi_id.trim());
  const hasImportedId = Boolean(
    row.source_shop_id &&
      row.source_shop_id.trim() &&
      (row.source_type === 'dianping_album' || row.dianping_verified)
  );
  return hasPoi || hasImportedId ? 'confirmed' : 'pending';
}

/** GET /api/agent/shops 的 mine 单项；POST/PATCH 成功后回同形状（H1 含 status） */
export type AgentMineShop = {
  poiKey: string;
  name: string;
  category: string | null;
  district: string | null;
  city: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  note: string | null;
  origin: string;
  wishlist: boolean;
  phone: string | null;
  status: 'confirmed' | 'pending';
  /** 真实点评数字店 id；没有则为 null。服务端绝不编造。 */
  sourceShopId: string | null;
};

function toAgentMineShop(s: {
  poiKey: string;
  name: string;
  category: string | null;
  district: string | null;
  city: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  note: string | null;
  origin: string;
  wishlist: boolean;
  phone: string | null;
  status: 'confirmed' | 'pending';
  sourceShopId?: string | null;
}): AgentMineShop {
  return {
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
    wishlist: s.wishlist,
    phone: s.phone,
    status: s.status,
    sourceShopId: s.sourceShopId ?? null,
  };
}

/**
 * Tab2：我导入的 + 我记下的 + Agent 记下的 + 我从好友清单收藏的店。
 * origin: imported | checkin | from_friend | agent
 * wishlist=1 →「心心念念」（很想去），熄心不删店。
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
              s.address, s.lat, s.lng, s.source_type, s.head_img, s.phone,
              f.note, f.visibility, f.created_at, f.wishlist, f.photo_url,
              s.amap_poi_id, s.source_shop_id,
              CASE
                WHEN s.source_type = 'agent' THEN 'agent'
                WHEN s.source_type IN ('photo', 'locate') THEN 'checkin'
                WHEN f.import_batch_id IS NOT NULL THEN 'imported'
                ELSE 'from_friend'
              END AS origin,
              EXISTS(
                SELECT 1 FROM shops imported
                WHERE imported.source_shop_id = s.source_shop_id
                  AND imported.source_shop_id IS NOT NULL
                  AND imported.source_type = 'dianping_album'
              ) AS dianping_verified
       FROM favorites f
       JOIN shops s ON s.id = f.shop_id
       WHERE f.user_id = ?
       ORDER BY f.created_at DESC`
    )
    .all(userId) as Array<
    MyShopRow & {
      amap_poi_id: string | null;
      source_shop_id: string | null;
      dianping_verified: number;
    }
  >;

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
        shopCity: r.city ?? undefined,
      });
    }
    const head = r.photo_url || r.head_img;
    const status = deriveShopStatus(r);
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
      sourceShopId: r.source_shop_id,
      phone: r.phone,
      headImg: head,
      headImgProxy: head ? buildProxyPath(head) : null,
      note: r.note,
      visibility: r.visibility,
      createdAt: r.created_at,
      origin: r.origin,
      status,
      wishlist: Boolean(r.wishlist),
      sourceTag: MY_SHOP_ORIGIN_LABEL[r.origin] || '',
      hasCoords: r.lat != null && r.lng != null,
      distanceMeters,
      distanceLabel,
      recommendersLine: MY_SHOP_ORIGIN_LABEL[r.origin] || '',
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
 * 记美食：在当前位置创建一家店并加入「我的店」，默认对美食好友可见。
 * wishlist 默认 0（去过不等于心心念念）；导入专辑才默认亮心。
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
    phone?: string;
    /** 地图 POI id，便于以后对齐 */
    poiId?: string;
    wishlist?: boolean;
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

  // 只接受本服务持久化后的路径，拒绝 wxfile:// 临时路径
  const photoUrl =
    input.photoUrl && input.photoUrl.startsWith('/api/media/local/')
      ? input.photoUrl
      : null;
  const note = (input.note || '').trim().slice(0, 500) || null;
  const phone = (input.phone || '').trim().slice(0, 40) || null;
  const poiId = (input.poiId || '').trim().slice(0, 64) || null;
  const wishlist = input.wishlist ? 1 : 0;

  const db = getDb();
  const shopId = uuidv4();
  const favId = uuidv4();
  const createdAt = nowIso();

  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO shops (
         id, source_type, source_shop_id, amap_poi_id, raw_name, adcode,
         category, district, city, address, avg_price, lat, lng,
         source_url, head_img, phone, display_cache_policy
       ) VALUES (?, 'locate', NULL, ?, ?, NULL, NULL, NULL, NULL, ?, NULL, ?, ?, NULL, ?, ?, 'minimal')`
    ).run(
      shopId,
      poiId,
      name,
      input.address || null,
      input.lat,
      input.lng,
      photoUrl,
      phone
    );

    db.prepare(
      `INSERT INTO favorites (
         id, user_id, shop_id, note, visibility, import_batch_id,
         created_at, photo_url, wishlist
       ) VALUES (?, ?, ?, ?, 'circles', NULL, ?, ?, ?)`
    ).run(favId, userId, shopId, note, createdAt, photoUrl, wishlist);

    if (note) {
      db.prepare(
        `INSERT INTO shop_comments (id, shop_id, user_id, body, created_at)
         VALUES (?, ?, ?, ?, ?)`
      ).run(uuidv4(), shopId, userId, note, createdAt);
    }
  });
  tx();

  return {
    favoriteId: favId,
    shopId,
    poiKey: shopId,
    name,
  };
}

/** 读出可再编辑的记美食记录（仅本人 + locate/photo） */
export function getCheckin(userId: string, favoriteId: string) {
  const row = getDb()
    .prepare(
      `SELECT f.id AS favoriteId, f.shop_id AS shopId, f.note, f.photo_url AS photoUrl,
              f.wishlist, s.raw_name AS name, s.address, s.lat, s.lng, s.phone,
              s.source_type AS sourceType, s.head_img AS headImg
       FROM favorites f
       JOIN shops s ON s.id = f.shop_id
       WHERE f.id = ? AND f.user_id = ?`
    )
    .get(favoriteId, userId) as
    | {
        favoriteId: string;
        shopId: string;
        note: string | null;
        photoUrl: string | null;
        wishlist: number;
        name: string;
        address: string | null;
        lat: number | null;
        lng: number | null;
        phone: string | null;
        sourceType: string;
        headImg: string | null;
      }
    | undefined;
  if (!row) {
    throw Object.assign(new Error('记录不存在'), { status: 404 });
  }
  if (row.sourceType !== 'locate' && row.sourceType !== 'photo') {
    throw Object.assign(new Error('只有自己记下的店可以这样改'), {
      status: 400,
    });
  }
  const head = row.photoUrl || row.headImg;
  return {
    ...row,
    wishlist: Boolean(row.wishlist),
    headImgProxy: head ? buildProxyPath(head) : null,
  };
}

/**
 * 再编辑记美食：改店名 / 地址 / 图 / 电话；新备注作为新评论追加。
 */
export function updateCheckin(
  userId: string,
  favoriteId: string,
  patch: {
    name?: string;
    address?: string;
    photoUrl?: string;
    phone?: string;
    note?: string;
    wishlist?: boolean;
  }
) {
  const existing = getCheckin(userId, favoriteId);
  const db = getDb();
  const name =
    patch.name !== undefined
      ? patch.name.trim().slice(0, 60)
      : existing.name;
  if (!name) {
    throw Object.assign(new Error('请填写店名或地点名'), { status: 400 });
  }

  let photoUrl = existing.photoUrl;
  if (patch.photoUrl !== undefined) {
    if (
      patch.photoUrl === '' ||
      patch.photoUrl === null ||
      patch.photoUrl === undefined
    ) {
      photoUrl = null;
    } else if (patch.photoUrl.startsWith('/api/media/local/')) {
      photoUrl = patch.photoUrl;
    } else {
      throw Object.assign(new Error('请先上传图片'), { status: 400 });
    }
  }

  const address =
    patch.address !== undefined
      ? patch.address.trim().slice(0, 200) || null
      : existing.address;
  const phone =
    patch.phone !== undefined
      ? patch.phone.trim().slice(0, 40) || null
      : existing.phone;
  const wishlist =
    patch.wishlist !== undefined
      ? patch.wishlist
        ? 1
        : 0
      : existing.wishlist
        ? 1
        : 0;
  const newNote = patch.note?.trim().slice(0, 500);

  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE shops SET raw_name = ?, address = ?, head_img = COALESCE(?, head_img), phone = ?
       WHERE id = ?`
    ).run(name, address, photoUrl, phone, existing.shopId);

    db.prepare(
      `UPDATE favorites SET photo_url = ?, wishlist = ? WHERE id = ? AND user_id = ?`
    ).run(photoUrl, wishlist, favoriteId, userId);

    if (newNote) {
      db.prepare(
        `INSERT INTO shop_comments (id, shop_id, user_id, body, created_at)
         VALUES (?, ?, ?, ?, ?)`
      ).run(uuidv4(), existing.shopId, userId, newNote, nowIso());
      db.prepare(`UPDATE favorites SET note = ? WHERE id = ?`).run(
        newNote.slice(0, 200),
        favoriteId
      );
    }
  });
  tx();

  return getCheckin(userId, favoriteId);
}

/**
 * 心心念念开关：只改亮/灭，不从「我的店」删除。
 * 若尚无收藏行（在朋友圈里看到的店），亮心时自动加一条。
 */
export function setWishlistByPoi(
  userId: string,
  poiKey: string,
  wishlist: boolean
) {
  const db = getDb();
  const shop = db
    .prepare(
      `SELECT id FROM shops
       WHERE COALESCE(source_shop_id, amap_poi_id, id) = ?
       LIMIT 1`
    )
    .get(poiKey) as { id: string } | undefined;
  if (!shop) {
    throw Object.assign(new Error('店铺不存在'), { status: 404 });
  }

  const fav = db
    .prepare(`SELECT id FROM favorites WHERE user_id = ? AND shop_id = ?`)
    .get(userId, shop.id) as { id: string } | undefined;

  if (fav) {
    db.prepare(`UPDATE favorites SET wishlist = ? WHERE id = ?`).run(
      wishlist ? 1 : 0,
      fav.id
    );
    return { favoriteId: fav.id, wishlist };
  }

  if (!wishlist) {
    return { favoriteId: null as string | null, wishlist: false };
  }

  const favId = uuidv4();
  db.prepare(
    `INSERT INTO favorites (
       id, user_id, shop_id, note, visibility, import_batch_id,
       created_at, wishlist
     ) VALUES (?, ?, ?, NULL, 'circles', NULL, ?, 1)`
  ).run(favId, userId, shop.id, nowIso());
  return { favoriteId: favId, wishlist: true };
}

export function updateUserProfile(
  userId: string,
  patch: { nickname?: string; avatar?: string }
) {
  const nickname = patch.nickname?.trim().slice(0, 32) || null;
  // 本地上传路径 /api/media/local/... 较短；也兼容少量外链
  const avatar = patch.avatar?.trim().slice(0, 800) || null;
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

function httpError(message: string, status: number): Error {
  return Object.assign(new Error(message), { status });
}

function optionalText(
  value: unknown,
  max: number,
  emptyMessage: string
): string | null {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw httpError(emptyMessage, 400);
  }
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  if (trimmed.length > max) {
    throw httpError(emptyMessage, 400);
  }
  return trimmed;
}

function optionalCoord(value: unknown, label: string): number | null {
  if (value == null || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) {
    throw httpError(`${label}无效`, 400);
  }
  return n;
}

/** 去重键：至少 trim（H2）；展示名另存原文（trim 后的请求文本，不改写用词） */
function normalizeDedupName(name: string): string {
  return name.trim();
}

function normalizeDedupCity(city: string | null | undefined): string {
  return (city || '').trim();
}

/** H5：备注追加，第一次内容必须仍可读 */
function appendNotes(
  existing: string | null,
  incoming: string | null
): string | null {
  const a = (existing || '').trim();
  const b = (incoming || '').trim();
  if (!b) return a || null;
  if (!a) return b;
  if (a.includes(b)) return a;
  const merged = `${a}；${b}`;
  return merged.length <= 200 ? merged : merged.slice(0, 200);
}

type UserShopRow = {
  favorite_id: string;
  shop_id: string;
  raw_name: string;
  city: string | null;
  district: string | null;
  address: string | null;
  category: string | null;
  phone: string | null;
  amap_poi_id: string | null;
  source_shop_id: string | null;
  source_url: string | null;
  lat: number | null;
  lng: number | null;
  note: string | null;
  wishlist: number;
};

function listUserFavoriteShops(userId: string): UserShopRow[] {
  return getDb()
    .prepare(
      `SELECT f.id AS favorite_id, f.note, f.wishlist,
              s.id AS shop_id, s.raw_name, s.city, s.district, s.address,
              s.category, s.phone, s.amap_poi_id, s.source_shop_id,
              s.source_url, s.lat, s.lng
       FROM favorites f
       JOIN shops s ON s.id = f.shop_id
       WHERE f.user_id = ?`
    )
    .all(userId) as UserShopRow[];
}

/**
 * 去重：点评数字 id 优先（同一家点评店）；再本人已有 poiKey；否则规范化店名 + 同城。
 * 不同 poiKey / 不同点评 id 的同名同城不合并，避免把 B 静默丢掉。
 */
function findDuplicateShop(
  rows: UserShopRow[],
  name: string,
  city: string | null,
  poiKey: string | null,
  sourceShopId: string | null
): UserShopRow | undefined {
  if (sourceShopId) {
    const byDianping = rows.find((r) => r.source_shop_id === sourceShopId);
    if (byDianping) return byDianping;
  }
  if (poiKey) {
    const byPoi = rows.find(
      (r) =>
        r.amap_poi_id === poiKey ||
        r.shop_id === poiKey ||
        r.source_shop_id === poiKey
    );
    if (byPoi) return byPoi;
  }
  const keyName = normalizeDedupName(name);
  const keyCity = normalizeDedupCity(city);
  return rows.find((r) => {
    if (poiKey && r.amap_poi_id && r.amap_poi_id !== poiKey) return false;
    if (
      sourceShopId &&
      r.source_shop_id &&
      r.source_shop_id !== sourceShopId
    ) {
      return false;
    }
    return (
      normalizeDedupName(r.raw_name) === keyName &&
      normalizeDedupCity(r.city) === keyCity
    );
  });
}

/** 点评数字店 id：只认 6–15 位数字，拒绝「fake-dianping-id」这类编造字符串 */
const DIANPING_SHOP_ID_RE = /^\d{6,15}$/;

/**
 * 从数字 id 或点评公开页链接里取出店 id。
 * 产品意图：用户或 Agent 粘贴了真实链接才收下；服务端绝不自己编一个 id。
 */
function parseDianpingShopId(value: unknown): string | null {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const raw = String(value).trim();
  if (!raw) return null;
  if (DIANPING_SHOP_ID_RE.test(raw)) return raw;
  const fromUrl = raw.match(
    /(?:https?:\/\/)?(?:[\w-]+\.)?dianping\.com\/(?:appshare\/)?shop\/(\d{6,15})/i
  );
  return fromUrl ? fromUrl[1] : null;
}

function parseDianpingSourceUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  if (!raw) return null;
  if (raw.length > 500) {
    throw httpError('点评链接过长', 400);
  }
  if (!/dianping\.com/i.test(raw)) return null;
  return parseDianpingShopId(raw) ? raw : null;
}

type ImportedDianpingFields = {
  address: string | null;
  category: string | null;
  district: string | null;
  city: string | null;
  phone: string | null;
  lat: number | null;
  lng: number | null;
  source_url: string | null;
  amap_poi_id: string | null;
};

/**
 * 用本地「专辑导入」已经落过的店回填地址/坐标。
 * 不访问 m.dianping.com：公开商详页地址打码、经纬度为 0，不能当定位用。
 */
function lookupImportedDianpingShop(
  sourceShopId: string
): ImportedDianpingFields | null {
  const row = getDb()
    .prepare(
      `SELECT address, category, district, city, phone, lat, lng,
              source_url, amap_poi_id
       FROM shops
       WHERE source_shop_id = ? AND source_type = 'dianping_album'
       LIMIT 1`
    )
    .get(sourceShopId) as ImportedDianpingFields | undefined;
  return row || null;
}

function firstNonEmpty(
  ...values: Array<string | null | undefined>
): string | null {
  for (const value of values) {
    const trimmed = (value || '').trim();
    if (trimmed) return trimmed;
  }
  return null;
}

function firstCoord(
  ...values: Array<number | null | undefined>
): number | null {
  for (const value of values) {
    if (value != null && Number.isFinite(value)) return value;
  }
  return null;
}

type AgentShopFields = {
  name: string | null;
  note: string | null;
  city: string | null;
  district: string | null;
  address: string | null;
  category: string | null;
  phone: string | null;
  poiKey: string | null;
  lat: number | null;
  lng: number | null;
  sourceShopId: string | null;
  sourceUrl: string | null;
  wishlist: boolean;
  wishlistProvided: boolean;
  provided: {
    name: boolean;
    note: boolean;
    city: boolean;
    district: boolean;
    address: boolean;
    category: boolean;
    phone: boolean;
    poiKey: boolean;
    lat: boolean;
    lng: boolean;
    sourceShopId: boolean;
    sourceUrl: boolean;
    wishlist: boolean;
  };
};

function hasOwn(input: Record<string, unknown>, key: string): boolean {
  return (
    Object.prototype.hasOwnProperty.call(input, key) &&
    input[key] !== undefined
  );
}

/**
 * 把 Agent 请求体收成和「我的店」同一套字段。
 * 点评 id 只从数字 / 真实点评链接里取；shopId 若不是数字则丢掉，防止幻觉 id。
 */
function parseAgentShopFields(
  rawInput: Record<string, unknown> | null | undefined
): AgentShopFields {
  const input = rawInput && typeof rawInput === 'object' ? rawInput : {};
  const provided = {
    name: hasOwn(input, 'name'),
    note: hasOwn(input, 'note'),
    city: hasOwn(input, 'city'),
    district: hasOwn(input, 'district'),
    address: hasOwn(input, 'address'),
    category: hasOwn(input, 'category'),
    phone: hasOwn(input, 'phone'),
    poiKey: hasOwn(input, 'poiKey'),
    lat: hasOwn(input, 'lat'),
    lng: hasOwn(input, 'lng'),
    sourceShopId:
      hasOwn(input, 'sourceShopId') ||
      hasOwn(input, 'source_shop_id') ||
      hasOwn(input, 'dianpingShopId') ||
      hasOwn(input, 'shopId'),
    sourceUrl:
      hasOwn(input, 'dianpingUrl') ||
      hasOwn(input, 'sourceUrl') ||
      hasOwn(input, 'source_url'),
    wishlist: hasOwn(input, 'wishlist'),
  };

  let name: string | null = null;
  if (provided.name) {
    if (typeof input.name !== 'string' && input.name != null) {
      throw httpError('请填写店名', 400);
    }
    const trimmed = input.name == null ? '' : String(input.name).trim();
    if (trimmed.length > 80) {
      throw httpError('店名最多 80 字', 400);
    }
    name = trimmed || null;
  }

  const note = optionalText(input.note, 200, '备注最多 200 字');
  const city = optionalText(input.city, 40, '城市最多 40 字');
  const district = optionalText(input.district, 80, '片区最多 80 字');
  const address = optionalText(input.address, 200, '地址最多 200 字');
  const category = optionalText(input.category, 80, '品类最多 80 字');
  const phone = optionalText(input.phone, 40, '电话最多 40 字');
  const poiKey = optionalText(input.poiKey, 64, 'poiKey 过长');
  const lat = optionalCoord(input.lat, '纬度');
  const lng = optionalCoord(input.lng, '经度');
  if (
    (provided.lat || provided.lng || lat != null || lng != null) &&
    (lat == null) !== (lng == null)
  ) {
    throw httpError('经纬度需要成对提供', 400);
  }

  const sourceShopId = parseDianpingShopId(
    input.sourceShopId ??
      input.source_shop_id ??
      input.dianpingShopId ??
      input.shopId
  );
  const sourceUrl = parseDianpingSourceUrl(
    input.dianpingUrl ?? input.sourceUrl ?? input.source_url
  );
  const fromUrlId = parseDianpingShopId(
    input.dianpingUrl ?? input.sourceUrl ?? input.source_url
  );

  return {
    name,
    note,
    city,
    district,
    address,
    category,
    phone,
    poiKey,
    lat,
    lng,
    sourceShopId: sourceShopId || fromUrlId,
    sourceUrl,
    wishlist: Boolean(input.wishlist),
    wishlistProvided: provided.wishlist,
    provided,
  };
}

/** 若本地专辑库已有这家点评店，用真实字段补空（不覆盖 Agent 已给的值） */
function applyImportedDianpingFill(
  fields: AgentShopFields
): AgentShopFields {
  if (!fields.sourceShopId) return fields;
  const known = lookupImportedDianpingShop(fields.sourceShopId);
  if (!known) return fields;
  return {
    ...fields,
    address: firstNonEmpty(fields.address, known.address),
    category: firstNonEmpty(fields.category, known.category),
    district: firstNonEmpty(fields.district, known.district),
    city: firstNonEmpty(fields.city, known.city),
    phone: firstNonEmpty(fields.phone, known.phone),
    lat: firstCoord(fields.lat, known.lat),
    lng: firstCoord(fields.lng, known.lng),
    sourceUrl: firstNonEmpty(fields.sourceUrl, known.source_url),
    poiKey: firstNonEmpty(fields.poiKey, known.amap_poi_id),
  };
}

async function agentShopByFavoriteId(
  userId: string,
  favoriteId: string
): Promise<AgentMineShop> {
  const listed = await listMyShops(userId);
  const item = listed.items.find((s) => s.favoriteId === favoriteId);
  if (!item) {
    throw httpError('写入后未能读出店铺', 500);
  }
  return toAgentMineShop(item);
}

async function assertAgentShopTextSafe(fields: {
  name?: string | null;
  note?: string | null;
  address?: string | null;
  category?: string | null;
}): Promise<void> {
  const texts = [fields.name, fields.note, fields.address, fields.category];
  for (const text of texts) {
    if (text && !(await msgSecCheck(text))) {
      throw httpError('内容未通过安全检查', 400);
    }
  }
}

function consumeAgentShopWriteOrThrow(userId: string): void {
  if (!tryConsumeAgentShopWrite(userId)) {
    throw httpError('记店过于频繁，每分钟最多 30 次、每天最多 200 次', 429);
  }
}

/**
 * Agent 记下一家店，写入调用者自己的「我的店」。
 *
 * 不走 createCheckin：那边强制 lat/lng，且 source_type=locate → origin 会变成「我记下」。
 * 本路径 source_type=agent、文案「Agent 记下」。
 * 字段与小程序收藏店对齐：address / category / phone / lat/lng / note / wishlist / source_shop_id。
 * 点评 id 只存调用方给出的真实数字或点评链接；没有可靠单店定位时保持 pending。
 */
export async function createAgentShop(
  userId: string,
  rawInput: Record<string, unknown> | null | undefined
): Promise<{ created: boolean; shop: AgentMineShop }> {
  const parsed = applyImportedDianpingFill(parseAgentShopFields(rawInput));
  const name = parsed.name;
  if (!name) {
    throw httpError('请填写店名', 400);
  }

  await assertAgentShopTextSafe(parsed);
  consumeAgentShopWriteOrThrow(userId);

  await ensurePersonalNetwork(userId);
  const existing = findDuplicateShop(
    listUserFavoriteShops(userId),
    name,
    parsed.city,
    parsed.poiKey,
    parsed.sourceShopId
  );
  const createdAt = nowIso();
  const db = getDb();

  // H4：body.source 乱传也忽略，永远按 agent 落库
  if (existing) {
    const mergedNote = appendNotes(existing.note, parsed.note);
    const nextWishlist = parsed.wishlistProvided
      ? parsed.wishlist
        ? 1
        : 0
      : existing.wishlist
        ? 1
        : 0;
    const tx = db.transaction(() => {
      db.prepare(
        `UPDATE shops SET
           city = COALESCE(NULLIF(city, ''), ?),
           district = COALESCE(NULLIF(district, ''), ?),
           address = COALESCE(NULLIF(address, ''), ?),
           category = COALESCE(NULLIF(category, ''), ?),
           phone = COALESCE(NULLIF(phone, ''), ?),
           lat = COALESCE(lat, ?),
           lng = COALESCE(lng, ?),
           amap_poi_id = COALESCE(amap_poi_id, ?),
           source_shop_id = COALESCE(source_shop_id, ?),
           source_url = COALESCE(NULLIF(source_url, ''), ?)
         WHERE id = ?`
      ).run(
        parsed.city,
        parsed.district,
        parsed.address,
        parsed.category,
        parsed.phone,
        parsed.lat,
        parsed.lng,
        parsed.poiKey,
        parsed.sourceShopId,
        parsed.sourceUrl,
        existing.shop_id
      );
      db.prepare(
        `UPDATE favorites SET note = ?, wishlist = ? WHERE id = ? AND user_id = ?`
      ).run(mergedNote, nextWishlist, existing.favorite_id, userId);
      if (parsed.note) {
        db.prepare(
          `INSERT INTO shop_comments (id, shop_id, user_id, body, created_at)
           VALUES (?, ?, ?, ?, ?)`
        ).run(uuidv4(), existing.shop_id, userId, parsed.note, createdAt);
      }
    });
    tx();
    console.info(
      JSON.stringify({
        event: 'agent_shop_write',
        userId,
        name,
        merged: true,
        ts: createdAt,
      })
    );
    return {
      created: false,
      shop: await agentShopByFavoriteId(userId, existing.favorite_id),
    };
  }

  const shopId = uuidv4();
  const favId = uuidv4();
  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO shops (
         id, source_type, source_shop_id, amap_poi_id, raw_name, adcode,
         category, district, city, address, avg_price, lat, lng,
         source_url, head_img, phone, display_cache_policy
       ) VALUES (?, 'agent', ?, ?, ?, NULL, ?, ?, ?, ?, NULL, ?, ?, ?, NULL, ?, 'minimal')`
    ).run(
      shopId,
      parsed.sourceShopId,
      parsed.poiKey,
      name,
      parsed.category,
      parsed.district,
      parsed.city,
      parsed.address,
      parsed.lat,
      parsed.lng,
      parsed.sourceUrl,
      parsed.phone
    );
    db.prepare(
      `INSERT INTO favorites (
         id, user_id, shop_id, note, visibility, import_batch_id,
         created_at, photo_url, wishlist
       ) VALUES (?, ?, ?, ?, 'circles', NULL, ?, NULL, ?)`
    ).run(
      favId,
      userId,
      shopId,
      parsed.note,
      createdAt,
      parsed.wishlist ? 1 : 0
    );
    if (parsed.note) {
      db.prepare(
        `INSERT INTO shop_comments (id, shop_id, user_id, body, created_at)
         VALUES (?, ?, ?, ?, ?)`
      ).run(uuidv4(), shopId, userId, parsed.note, createdAt);
    }
  });
  tx();
  console.info(
    JSON.stringify({
      event: 'agent_shop_write',
      userId,
      name,
      merged: false,
      ts: createdAt,
    })
  );
  return {
    created: true,
    shop: await agentShopByFavoriteId(userId, favId),
  };
}

function findOwnerShopByPoiKey(
  userId: string,
  poiKey: string
): UserShopRow | undefined {
  const key = poiKey.trim();
  if (!key) return undefined;
  return getDb()
    .prepare(
      `SELECT f.id AS favorite_id, f.note, f.wishlist,
              s.id AS shop_id, s.raw_name, s.city, s.district, s.address,
              s.category, s.phone, s.amap_poi_id, s.source_shop_id,
              s.source_url, s.lat, s.lng
       FROM favorites f
       JOIN shops s ON s.id = f.shop_id
       WHERE f.user_id = ?
         AND (s.source_shop_id = ? OR s.amap_poi_id = ? OR s.id = ?)
       LIMIT 1`
    )
    .get(userId, key, key, key) as UserShopRow | undefined;
}

/**
 * Agent 改自己的店。只认 Token 主人收藏里的店，改不了朋友的店。
 * 只更新请求里出现的字段；空字符串会清空可选文本（店名除外）。
 */
export async function updateAgentShop(
  userId: string,
  poiKey: string,
  rawInput: Record<string, unknown> | null | undefined
): Promise<AgentMineShop> {
  const key = (poiKey || '').trim();
  if (!key) {
    throw httpError('缺少 poiKey', 400);
  }

  const parsed = applyImportedDianpingFill(parseAgentShopFields(rawInput));
  if (parsed.provided.name && !parsed.name) {
    throw httpError('请填写店名', 400);
  }

  await assertAgentShopTextSafe({
    name: parsed.provided.name ? parsed.name : null,
    note: parsed.provided.note ? parsed.note : null,
    address: parsed.provided.address ? parsed.address : null,
    category: parsed.provided.category ? parsed.category : null,
  });
  consumeAgentShopWriteOrThrow(userId);

  await ensurePersonalNetwork(userId);
  const existing = findOwnerShopByPoiKey(userId, key);
  if (!existing) {
    throw httpError('店铺不存在或不是你的店', 404);
  }

  const nextName = parsed.provided.name ? parsed.name : existing.raw_name;
  const nextCity = parsed.provided.city
    ? parsed.city
    : firstNonEmpty(existing.city, parsed.city);
  const nextDistrict = parsed.provided.district
    ? parsed.district
    : firstNonEmpty(existing.district, parsed.district);
  const nextAddress = parsed.provided.address
    ? parsed.address
    : firstNonEmpty(existing.address, parsed.address);
  const nextCategory = parsed.provided.category
    ? parsed.category
    : firstNonEmpty(existing.category, parsed.category);
  const nextPhone = parsed.provided.phone
    ? parsed.phone
    : firstNonEmpty(existing.phone, parsed.phone);
  const nextLat = parsed.provided.lat
    ? parsed.lat
    : firstCoord(existing.lat, parsed.lat);
  const nextLng = parsed.provided.lng
    ? parsed.lng
    : firstCoord(existing.lng, parsed.lng);
  const nextPoiKey = parsed.provided.poiKey
    ? parsed.poiKey
    : firstNonEmpty(existing.amap_poi_id, parsed.poiKey);
  const nextSourceShopId =
    parsed.sourceShopId || existing.source_shop_id;
  const nextSourceUrl = parsed.provided.sourceUrl
    ? parsed.sourceUrl
    : firstNonEmpty(existing.source_url, parsed.sourceUrl);
  const nextNote = parsed.provided.note
    ? parsed.note
    : existing.note;
  const nextWishlist = parsed.wishlistProvided
    ? parsed.wishlist
      ? 1
      : 0
    : existing.wishlist
      ? 1
      : 0;

  const createdAt = nowIso();
  const db = getDb();
  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE shops SET
         raw_name = ?,
         city = ?,
         district = ?,
         address = ?,
         category = ?,
         phone = ?,
         lat = ?,
         lng = ?,
         amap_poi_id = ?,
         source_shop_id = ?,
         source_url = ?
       WHERE id = ?`
    ).run(
      nextName,
      nextCity,
      nextDistrict,
      nextAddress,
      nextCategory,
      nextPhone,
      nextLat,
      nextLng,
      nextPoiKey,
      nextSourceShopId,
      nextSourceUrl,
      existing.shop_id
    );
    db.prepare(
      `UPDATE favorites SET note = ?, wishlist = ? WHERE id = ? AND user_id = ?`
    ).run(nextNote, nextWishlist, existing.favorite_id, userId);
    if (parsed.provided.note && parsed.note) {
      db.prepare(
        `INSERT INTO shop_comments (id, shop_id, user_id, body, created_at)
         VALUES (?, ?, ?, ?, ?)`
      ).run(uuidv4(), existing.shop_id, userId, parsed.note, createdAt);
    }
  });
  tx();
  console.info(
    JSON.stringify({
      event: 'agent_shop_patch',
      userId,
      poiKey: key,
      ts: createdAt,
    })
  );
  return agentShopByFavoriteId(userId, existing.favorite_id);
}

/** Agent 可读可写本人店：本人收藏 + 美食网内好友共享店（去重） */
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
    mine: mine.items.map((s) => toAgentMineShop(s)),
    friendsShared: friendRows,
    /** 语义说明，方便其他 Agent 理解字段 */
    semantics: {
      wishlist: '心心念念——用户很想去的店；熄灭不等于删除',
      origin:
        'imported=专辑导入 checkin=自己记下 from_friend=来自好友 agent=Agent记下',
      status:
        'confirmed=有合法 poiKey，或专辑导入核验过的点评 id；pending=仅店名/未校验坐标/只存了未核验点评 id',
    },
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
