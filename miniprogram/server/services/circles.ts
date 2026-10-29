import { randomBytes } from 'node:crypto';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config.js';
import { getDb } from '../db.js';
import { msgSecCheck } from '../auth.js';
import {
  formatDistanceLabel,
  formatRecommendersLine,
  haversineMeters,
} from '../utils/geo.js';
import { buildProxyPath } from './media-proxy.js';

function nowIso(): string {
  return new Date().toISOString();
}

function tokenExpiresAt(from = new Date()): string {
  const d = new Date(from);
  d.setDate(d.getDate() + config.inviteTokenDays);
  return d.toISOString();
}

function newInviteToken(): string {
  return randomBytes(16).toString('hex');
}

function assertMember(circleId: string, userId: string): { role: string } {
  const row = getDb()
    .prepare(
      `SELECT role FROM circle_members WHERE circle_id = ? AND user_id = ?`
    )
    .get(circleId, userId) as { role: string } | undefined;
  if (!row) {
    throw Object.assign(new Error('无权访问该收藏圈'), { status: 403 });
  }
  return row;
}

export async function createCircle(userId: string, name: string) {
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 30) {
    throw Object.assign(new Error('圈名需 1–30 字'), { status: 400 });
  }
  if (!(await msgSecCheck(trimmed))) {
    throw Object.assign(new Error('圈名未通过内容安全检查'), { status: 400 });
  }

  const db = getDb();
  const id = uuidv4();
  const inviteToken = newInviteToken();
  const createdAt = nowIso();
  const expires = tokenExpiresAt();

  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO circles (id, name, owner_id, invite_token, token_expires_at, opengid, member_limit, created_at)
       VALUES (?, ?, ?, ?, ?, NULL, ?, ?)`
    ).run(id, trimmed, userId, inviteToken, expires, config.circleMemberLimit, createdAt);
    db.prepare(
      `INSERT INTO circle_members (circle_id, user_id, role, joined_at)
       VALUES (?, ?, 'owner', ?)`
    ).run(id, userId, createdAt);
  });
  tx();

  return {
    id,
    name: trimmed,
    inviteToken,
    tokenExpiresAt: expires,
    memberLimit: config.circleMemberLimit,
  };
}

export function resetInviteToken(userId: string, circleId: string) {
  const member = assertMember(circleId, userId);
  if (member.role !== 'owner') {
    throw Object.assign(new Error('仅圈主可重置邀请'), { status: 403 });
  }
  const inviteToken = newInviteToken();
  const expires = tokenExpiresAt();
  getDb()
    .prepare(
      `UPDATE circles SET invite_token = ?, token_expires_at = ? WHERE id = ?`
    )
    .run(inviteToken, expires, circleId);
  return { inviteToken, tokenExpiresAt: expires };
}

export async function renameCircle(
  userId: string,
  circleId: string,
  name: string
) {
  const member = assertMember(circleId, userId);
  if (member.role !== 'owner') {
    throw Object.assign(new Error('仅圈主可改名'), { status: 403 });
  }
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 30) {
    throw Object.assign(new Error('圈名需 1–30 字'), { status: 400 });
  }
  if (!(await msgSecCheck(trimmed))) {
    throw Object.assign(new Error('圈名未通过内容安全检查'), { status: 400 });
  }
  getDb().prepare(`UPDATE circles SET name = ? WHERE id = ?`).run(trimmed, circleId);
  return { id: circleId, name: trimmed };
}

/**
 * 加入收藏圈：必须主动调用；校验 token 未过期且未被重置。
 */
export function joinCircle(
  userId: string,
  circleId: string,
  token: string,
  opengid?: string
) {
  const db = getDb();
  const circle = db
    .prepare(`SELECT * FROM circles WHERE id = ?`)
    .get(circleId) as
    | {
        id: string;
        name: string;
        invite_token: string;
        token_expires_at: string;
        opengid: string | null;
        member_limit: number;
      }
    | undefined;

  if (!circle) {
    throw Object.assign(new Error('收藏圈不存在'), { status: 404 });
  }
  if (circle.invite_token !== token) {
    throw Object.assign(new Error('邀请已失效（可能已重置）'), { status: 403 });
  }
  if (new Date(circle.token_expires_at).getTime() < Date.now()) {
    throw Object.assign(new Error('邀请已过期'), { status: 403 });
  }
  // 可选群绑定：圈已绑 opengid 时，加入者必须带同一 opengid
  if (circle.opengid) {
    if (!opengid || opengid !== circle.opengid) {
      throw Object.assign(new Error('仅限指定微信群成员加入'), { status: 403 });
    }
  } else if (opengid) {
    db.prepare(`UPDATE circles SET opengid = ? WHERE id = ?`).run(opengid, circleId);
  }

  const existing = db
    .prepare(
      `SELECT role FROM circle_members WHERE circle_id = ? AND user_id = ?`
    )
    .get(circleId, userId);
  if (existing) {
    return { circleId, name: circle.name, alreadyMember: true };
  }

  const count = (
    db
      .prepare(`SELECT COUNT(*) AS c FROM circle_members WHERE circle_id = ?`)
      .get(circleId) as { c: number }
  ).c;
  if (count >= circle.member_limit) {
    throw Object.assign(new Error('收藏圈人数已满'), { status: 403 });
  }

  db.prepare(
    `INSERT INTO circle_members (circle_id, user_id, role, joined_at)
     VALUES (?, ?, 'member', ?)`
  ).run(circleId, userId, nowIso());

  return { circleId, name: circle.name, alreadyMember: false };
}

export function leaveCircle(userId: string, circleId: string): void {
  const member = assertMember(circleId, userId);
  if (member.role === 'owner') {
    throw Object.assign(
      new Error('圈主请先解散圈，或转让后再退出'),
      { status: 400 }
    );
  }
  getDb()
    .prepare(`DELETE FROM circle_members WHERE circle_id = ? AND user_id = ?`)
    .run(circleId, userId);
}

export function removeMember(
  ownerId: string,
  circleId: string,
  targetUserId: string
): void {
  const member = assertMember(circleId, ownerId);
  if (member.role !== 'owner') {
    throw Object.assign(new Error('仅圈主可移除成员'), { status: 403 });
  }
  if (targetUserId === ownerId) {
    throw Object.assign(new Error('不能移除自己'), { status: 400 });
  }
  const result = getDb()
    .prepare(`DELETE FROM circle_members WHERE circle_id = ? AND user_id = ?`)
    .run(circleId, targetUserId);
  if (result.changes === 0) {
    throw Object.assign(new Error('成员不存在'), { status: 404 });
  }
}

export function dissolveCircle(ownerId: string, circleId: string): void {
  const member = assertMember(circleId, ownerId);
  if (member.role !== 'owner') {
    throw Object.assign(new Error('仅圈主可解散'), { status: 403 });
  }
  const db = getDb();
  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM circle_shares WHERE circle_id = ?`).run(circleId);
    db.prepare(`DELETE FROM circle_members WHERE circle_id = ?`).run(circleId);
    db.prepare(`DELETE FROM circles WHERE id = ?`).run(circleId);
  });
  tx();
}

export function listMyCircles(userId: string) {
  const rows = getDb()
    .prepare(
      `SELECT c.id, c.name, c.owner_id, cm.role, c.created_at,
              c.invite_token, c.token_expires_at,
              (SELECT COUNT(*) FROM circle_members m WHERE m.circle_id = c.id) AS member_count
       FROM circles c
       JOIN circle_members cm ON cm.circle_id = c.id
       WHERE cm.user_id = ?
       ORDER BY c.created_at DESC`
    )
    .all(userId) as Array<Record<string, unknown>>;

  // 邀请 token 仅圈主可见，避免成员复制后滥用
  return rows.map((r) => {
    if (r.role !== 'owner') {
      const { invite_token: _t, token_expires_at: _e, ...rest } = r;
      return rest;
    }
    return r;
  });
}

export function getCirclePublicInfo(circleId: string) {
  const row = getDb()
    .prepare(
      `SELECT id, name, owner_id, token_expires_at, member_limit, created_at,
              (SELECT COUNT(*) FROM circle_members m WHERE m.circle_id = circles.id) AS member_count
       FROM circles WHERE id = ?`
    )
    .get(circleId);
  if (!row) {
    throw Object.assign(new Error('收藏圈不存在'), { status: 404 });
  }
  return row;
}

/**
 * 圈视图：仅成员可读；SQL 层过滤 visibility=circles；
 * 私密收藏绝不出现（含聚合计数）。
 * 若存在 circle_shares 记录，则仅展示显式分享的收藏；否则展示该成员全部 visibility=circles。
 */
type CircleShopRow = {
  shop_key: string;
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
  favorite_id: string;
  collector_id: string;
  collector_nickname: string | null;
  collector_avatar: string | null;
  note: string | null;
  favorited_at: string;
  source_url: string | null;
  source_shop_id: string | null;
};

export type AggregatedCircleShop = {
  shopKey: string;
  poiKey: string;
  name: string;
  avgPrice?: string;
  category?: string;
  district?: string;
  city?: string;
  address?: string;
  lat?: number;
  lng?: number;
  sourceType: string;
  sourceUrl?: string;
  sourceShopId?: string;
  headImg?: string;
  headImgProxy?: string;
  collectorCount: number;
  recommendersLine: string;
  collectors: Array<{
    userId: string;
    nickname: string | null;
    avatar: string | null;
    note: string | null;
    favoritedAt: string;
    favoriteId?: string;
  }>;
  /** 当前用户在这家店上的收藏（用于改自己的备注） */
  myFavoriteId?: string;
  myNote?: string;
  distanceMeters?: number;
  distanceLabel?: string;
  hasCoords: boolean;
};

function queryCircleShopRows(
  circleId: string,
  filters?: { city?: string; memberId?: string; category?: string }
): CircleShopRow[] {
  const db = getDb();
  const params: unknown[] = [circleId];
  let sql = `
    SELECT
      s.id AS shop_key,
      COALESCE(s.source_shop_id, s.amap_poi_id, s.id) AS poi_key,
      s.raw_name AS name,
      s.avg_price,
      s.category,
      s.district,
      s.city,
      s.address,
      s.lat,
      s.lng,
      s.source_type,
      s.source_url,
      s.source_shop_id,
      s.head_img,
      f.id AS favorite_id,
      f.user_id AS collector_id,
      u.nickname AS collector_nickname,
      u.avatar AS collector_avatar,
      f.note,
      f.created_at AS favorited_at
    FROM circle_members cm
    JOIN favorites f ON f.user_id = cm.user_id
    JOIN shops s ON s.id = f.shop_id
    JOIN users u ON u.id = f.user_id
    WHERE cm.circle_id = ?
      AND f.visibility = 'circles'
      AND (
        NOT EXISTS (SELECT 1 FROM circle_shares cs WHERE cs.circle_id = ?)
        OR EXISTS (
          SELECT 1 FROM circle_shares cs2
          WHERE cs2.circle_id = ? AND cs2.favorite_id = f.id
        )
      )
  `;
  params.push(circleId, circleId);

  if (filters?.city) {
    sql += ` AND s.city = ?`;
    params.push(filters.city);
  }
  if (filters?.memberId) {
    sql += ` AND f.user_id = ?`;
    params.push(filters.memberId);
  }
  if (filters?.category) {
    sql += ` AND s.category LIKE ?`;
    params.push(`%${filters.category}%`);
  }

  sql += ` ORDER BY f.created_at DESC`;

  return db.prepare(sql).all(...params) as CircleShopRow[];
}

function aggregateCircleShops(rows: CircleShopRow[]): AggregatedCircleShop[] {
  const map = new Map<string, AggregatedCircleShop>();

  for (const r of rows) {
    let agg = map.get(r.poi_key);
    if (!agg) {
      agg = {
        shopKey: r.shop_key,
        poiKey: r.poi_key,
        name: r.name,
        sourceType: r.source_type,
        collectorCount: 0,
        recommendersLine: '',
        collectors: [],
        hasCoords: r.lat != null && r.lng != null && r.lat !== 0 && r.lng !== 0,
      };
      if (r.avg_price) agg.avgPrice = r.avg_price;
      if (r.category) agg.category = r.category;
      if (r.district) agg.district = r.district;
      if (r.city) agg.city = r.city;
      if (r.address) agg.address = r.address;
      if (r.lat != null && r.lng != null) {
        agg.lat = r.lat;
        agg.lng = r.lng;
      }
      if (r.source_url) agg.sourceUrl = r.source_url;
      if (r.source_shop_id) agg.sourceShopId = r.source_shop_id;
      if (r.head_img) {
        agg.headImg = r.head_img;
        agg.headImgProxy = buildProxyPath(r.head_img);
      }
      map.set(r.poi_key, agg);
    } else {
      if (!agg.headImg && r.head_img) {
        agg.headImg = r.head_img;
        agg.headImgProxy = buildProxyPath(r.head_img);
      }
      if (!agg.sourceUrl && r.source_url) agg.sourceUrl = r.source_url;
      if (!agg.sourceShopId && r.source_shop_id) {
        agg.sourceShopId = r.source_shop_id;
      }
    }

    const existing = agg.collectors.find((c) => c.userId === r.collector_id);
    if (!existing) {
      agg.collectors.push({
        userId: r.collector_id,
        nickname: r.collector_nickname,
        avatar: r.collector_avatar,
        note: r.note,
        favoritedAt: r.favorited_at,
        favoriteId: r.favorite_id,
      });
    }
  }

  const items = [...map.values()].map((item) => {
    item.collectors.sort(
      (a, b) =>
        new Date(a.favoritedAt).getTime() - new Date(b.favoritedAt).getTime()
    );
    item.collectorCount = item.collectors.length;
    item.recommendersLine = formatRecommendersLine(
      item.collectors,
      item.collectorCount
    );
    return item;
  });

  return items;
}

function sortShopsByDistance(
  items: AggregatedCircleShop[],
  lat?: number,
  lng?: number,
  userCity?: string
): { withCoords: AggregatedCircleShop[]; withoutCoords: AggregatedCircleShop[] } {
  const withCoords: AggregatedCircleShop[] = [];
  const withoutCoords: AggregatedCircleShop[] = [];

  for (const item of items) {
    const shopHasCoords =
      item.lat != null && item.lng != null && item.lat !== 0 && item.lng !== 0;
    if (lat != null && lng != null && shopHasCoords) {
      const meters = haversineMeters(lat, lng, item.lat!, item.lng!);
      item.distanceMeters = meters;
      item.distanceLabel = formatDistanceLabel(meters, {
        userCity,
        shopCity: item.city,
      });
      withCoords.push(item);
    } else if (shopHasCoords) {
      withCoords.push(item);
    } else {
      withoutCoords.push(item);
    }
  }

  if (lat != null && lng != null) {
    withCoords.sort(
      (a, b) => (a.distanceMeters ?? 0) - (b.distanceMeters ?? 0)
    );
  } else {
    withCoords.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
  }
  withoutCoords.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));

  return { withCoords, withoutCoords };
}

export function listCircleShops(
  userId: string,
  circleId: string,
  filters?: {
    city?: string;
    memberId?: string;
    category?: string;
    lat?: number;
    lng?: number;
    userCity?: string;
    page?: number;
    pageSize?: number;
  }
) {
  assertMember(circleId, userId);
  const rows = queryCircleShopRows(circleId, filters);
  const aggregated = aggregateCircleShops(rows);
  const { withCoords, withoutCoords } = sortShopsByDistance(
    aggregated,
    filters?.lat,
    filters?.lng,
    filters?.userCity
  );

  const pageSize = filters?.pageSize ?? 20;
  const page = Math.max(1, filters?.page ?? 1);
  const ordered = [...withCoords, ...withoutCoords];
  const start = (page - 1) * pageSize;
  const slice = ordered.slice(start, start + pageSize);

  return {
    items: slice,
    withCoordsCount: withCoords.length,
    withoutCoordsCount: withoutCoords.length,
    page,
    pageSize,
    total: ordered.length,
    hasMore: start + pageSize < ordered.length,
  };
}

export function getCircleShopDetail(
  userId: string,
  circleId: string,
  poiKey: string,
  opts?: { lat?: number; lng?: number; userCity?: string }
): AggregatedCircleShop | null {
  assertMember(circleId, userId);
  const rows = queryCircleShopRows(circleId);
  const aggregated = aggregateCircleShops(rows);
  const shop = aggregated.find((s) => s.poiKey === poiKey);
  if (!shop) return null;

  if (
    opts?.lat != null &&
    opts?.lng != null &&
    shop.lat != null &&
    shop.lng != null
  ) {
    const meters = haversineMeters(opts.lat, opts.lng, shop.lat, shop.lng);
    shop.distanceMeters = meters;
    shop.distanceLabel = formatDistanceLabel(meters, {
      userCity: opts.userCity,
      shopCity: shop.city,
    });
  }

  const mine = shop.collectors.find((c) => c.userId === userId);
  if (mine) {
    shop.myFavoriteId = mine.favoriteId;
    shop.myNote = mine.note || '';
  } else {
    shop.myNote = '';
  }
  // 朋友备注列表里不重复展示「我」——我的备注单独编辑
  shop.collectors = shop.collectors.filter((c) => c.userId !== userId);
  shop.collectorCount = shop.collectors.length;
  shop.recommendersLine = formatRecommendersLine(
    shop.collectors,
    shop.collectorCount
  );

  return shop;
}

export function listCircleMembers(userId: string, circleId: string) {
  assertMember(circleId, userId);
  return getDb()
    .prepare(
      `SELECT u.id, u.nickname, u.avatar, cm.role, cm.joined_at,
              (
                SELECT COUNT(DISTINCT f.shop_id)
                FROM favorites f
                WHERE f.user_id = u.id
                  AND f.visibility = 'circles'
                  AND (
                    NOT EXISTS (SELECT 1 FROM circle_shares cs WHERE cs.circle_id = ?)
                    OR EXISTS (
                      SELECT 1 FROM circle_shares cs2
                      WHERE cs2.circle_id = ? AND cs2.favorite_id = f.id
                    )
                  )
              ) AS shared_shop_count
       FROM circle_members cm
       JOIN users u ON u.id = cm.user_id
       WHERE cm.circle_id = ?
       ORDER BY CASE cm.role WHEN 'owner' THEN 0 ELSE 1 END, cm.joined_at`
    )
    .all(circleId, circleId, circleId);
}

/** 记美食：对圈内已有 shop 追加收藏（带备注），默认可被圈友看见 */
export function addFavoriteFromCircleShop(
  userId: string,
  circleId: string,
  poiKey: string,
  note: string
) {
  assertMember(circleId, userId);
  const trimmed = note.trim().slice(0, 200);
  if (!(trimmed || note === '')) {
    throw Object.assign(new Error('备注格式无效'), { status: 400 });
  }

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

  const existing = db
    .prepare(`SELECT id FROM favorites WHERE user_id = ? AND shop_id = ?`)
    .get(userId, shop.id) as { id: string } | undefined;

  if (existing) {
    db.prepare(
      `UPDATE favorites SET note = ?, visibility = 'circles' WHERE id = ?`
    ).run(trimmed || null, existing.id);
    return { favoriteId: existing.id, updated: true };
  }

  const favId = uuidv4();
  db.prepare(
    `INSERT INTO favorites (id, user_id, shop_id, note, visibility, import_batch_id, created_at)
     VALUES (?, ?, ?, ?, 'circles', NULL, ?)`
  ).run(favId, userId, shop.id, trimmed || null, nowIso());

  return { favoriteId: favId, updated: false };
}

/** 测试辅助：直接写过期/错误 token */
export function setCircleInviteForTest(
  circleId: string,
  token: string,
  expiresAt: string
): void {
  getDb()
    .prepare(
      `UPDATE circles SET invite_token = ?, token_expires_at = ? WHERE id = ?`
    )
    .run(token, expiresAt, circleId);
}

export { assertMember };
