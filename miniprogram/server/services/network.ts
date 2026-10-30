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
 * H3：有合法 poiKey（amap_poi_id）或导入带来的真实点评 id → confirmed。
 * 仅有未校验坐标、或只有内部 UUID → pending。内部 id 不当作点评 shopId。
 */
function deriveShopStatus(row: {
  amap_poi_id?: string | null;
  source_shop_id?: string | null;
}): 'confirmed' | 'pending' {
  const hasPoi = Boolean(row.amap_poi_id && row.amap_poi_id.trim());
  const hasImportedId = Boolean(
    row.source_shop_id && row.source_shop_id.trim()
  );
  return hasPoi || hasImportedId ? 'confirmed' : 'pending';
}

/** GET /api/agent/shops 的 mine 单项；POST 写入成功后回同形状（H1 含 status） */
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
              END AS origin
       FROM favorites f
       JOIN shops s ON s.id = f.shop_id
       WHERE f.user_id = ?
       ORDER BY f.created_at DESC`
    )
    .all(userId) as Array<
    MyShopRow & { amap_poi_id: string | null; source_shop_id: string | null }
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
  amap_poi_id: string | null;
  source_shop_id: string | null;
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
              s.amap_poi_id, s.source_shop_id, s.lat, s.lng
       FROM favorites f
       JOIN shops s ON s.id = f.shop_id
       WHERE f.user_id = ?`
    )
    .all(userId) as UserShopRow[];
}

/**
 * 去重：优先本人已有 poiKey；否则规范化店名 + 同城。
 * 不同 poiKey 的同名同城不合并（S5-API-08），避免把 B 静默丢掉。
 */
function findDuplicateShop(
  rows: UserShopRow[],
  name: string,
  city: string | null,
  poiKey: string | null
): UserShopRow | undefined {
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
    return (
      normalizeDedupName(r.raw_name) === keyName &&
      normalizeDedupCity(r.city) === keyCity
    );
  });
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

/**
 * Agent 记下一家店，写入调用者自己的「我的店」。
 *
 * 不走 createCheckin：那边强制 lat/lng，且 source_type=locate → origin 会变成「我记下」。
 * 本路径 source_type=agent、文案「Agent 记下」；无合法 poiKey 则为 pending；永不写 source_shop_id。
 */
export async function createAgentShop(
  userId: string,
  rawInput: Record<string, unknown> | null | undefined
): Promise<{ created: boolean; shop: AgentMineShop }> {
  const input = rawInput && typeof rawInput === 'object' ? rawInput : {};

  if (typeof input.name !== 'string' && input.name != null) {
    throw httpError('请填写店名', 400);
  }
  const nameRaw = input.name == null ? '' : String(input.name);
  const name = nameRaw.trim();
  if (!name) {
    throw httpError('请填写店名', 400);
  }
  if (name.length > 80) {
    throw httpError('店名最多 80 字', 400);
  }

  const note = optionalText(input.note, 200, '备注最多 200 字');
  const city = optionalText(input.city, 40, '城市最多 40 字');
  const district = optionalText(input.district, 80, '片区最多 80 字');
  const poiKey = optionalText(input.poiKey, 64, 'poiKey 过长');
  const lat = optionalCoord(input.lat, '纬度');
  const lng = optionalCoord(input.lng, '经度');
  if ((lat == null) !== (lng == null)) {
    throw httpError('经纬度需要成对提供', 400);
  }

  const wishlistProvided =
    Object.prototype.hasOwnProperty.call(input, 'wishlist') &&
    input.wishlist !== undefined;
  const wishlist = Boolean(input.wishlist);

  if (!(await msgSecCheck(name)) || (note && !(await msgSecCheck(note)))) {
    throw httpError('内容未通过安全检查', 400);
  }

  if (!tryConsumeAgentShopWrite(userId)) {
    throw httpError('记店过于频繁，每分钟最多 30 次、每天最多 200 次', 429);
  }

  await ensurePersonalNetwork(userId);
  const existing = findDuplicateShop(
    listUserFavoriteShops(userId),
    name,
    city,
    poiKey
  );
  const createdAt = nowIso();
  const db = getDb();

  // H4：body.source 乱传也忽略，永远按 agent 落库
  // H10：任何幻觉点评 id / source_shop_id / shopId 字段一律丢掉
  if (existing) {
    const mergedNote = appendNotes(existing.note, note);
    const nextWishlist = wishlistProvided
      ? wishlist
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
           lat = COALESCE(lat, ?),
           lng = COALESCE(lng, ?),
           amap_poi_id = COALESCE(amap_poi_id, ?)
         WHERE id = ?`
      ).run(
        city,
        district,
        lat,
        lng,
        poiKey,
        existing.shop_id
      );
      db.prepare(
        `UPDATE favorites SET note = ?, wishlist = ? WHERE id = ? AND user_id = ?`
      ).run(mergedNote, nextWishlist, existing.favorite_id, userId);
      if (note) {
        db.prepare(
          `INSERT INTO shop_comments (id, shop_id, user_id, body, created_at)
           VALUES (?, ?, ?, ?, ?)`
        ).run(uuidv4(), existing.shop_id, userId, note, createdAt);
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
       ) VALUES (?, 'agent', NULL, ?, ?, NULL, NULL, ?, ?, ?, NULL, ?, ?, NULL, NULL, NULL, 'minimal')`
    ).run(
      shopId,
      poiKey,
      name,
      district,
      city,
      district,
      lat,
      lng
    );
    db.prepare(
      `INSERT INTO favorites (
         id, user_id, shop_id, note, visibility, import_batch_id,
         created_at, photo_url, wishlist
       ) VALUES (?, ?, ?, ?, 'circles', NULL, ?, NULL, ?)`
    ).run(favId, userId, shopId, note, createdAt, wishlist ? 1 : 0);
    if (note) {
      db.prepare(
        `INSERT INTO shop_comments (id, shop_id, user_id, body, created_at)
         VALUES (?, ?, ?, ?, ?)`
      ).run(uuidv4(), shopId, userId, note, createdAt);
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
      status: 'confirmed=有合法 poiKey pending=仅店名/未校验坐标',
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
