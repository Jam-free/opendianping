import { randomUUID as uuidv4 } from 'node:crypto';
import { getDb } from '../db.js';

function nowIso() {
  return new Date().toISOString();
}

export type ShopComment = {
  id: string;
  shopId: string;
  userId: string;
  nickname: string | null;
  avatar: string | null;
  body: string;
  createdAt: string;
  isMine: boolean;
};

/** 某店的评论流（圈子成员可见的共享店） */
export function listShopComments(
  viewerId: string,
  shopId: string
): ShopComment[] {
  const rows = getDb()
    .prepare(
      `SELECT c.id, c.shop_id AS shopId, c.user_id AS userId,
              u.nickname, u.avatar, c.body, c.created_at AS createdAt
       FROM shop_comments c
       JOIN users u ON u.id = c.user_id
       WHERE c.shop_id = ?
       ORDER BY c.created_at ASC`
    )
    .all(shopId) as Array<{
    id: string;
    shopId: string;
    userId: string;
    nickname: string | null;
    avatar: string | null;
    body: string;
    createdAt: string;
  }>;

  return rows.map((r) => ({
    ...r,
    isMine: r.userId === viewerId,
  }));
}

export function addShopComment(
  userId: string,
  shopId: string,
  body: string
): ShopComment {
  const text = body.trim().slice(0, 500);
  if (!text) {
    throw Object.assign(new Error('请写一点内容'), { status: 400 });
  }
  const shop = getDb()
    .prepare(`SELECT id FROM shops WHERE id = ?`)
    .get(shopId) as { id: string } | undefined;
  if (!shop) {
    throw Object.assign(new Error('店铺不存在'), { status: 404 });
  }

  const id = uuidv4();
  const createdAt = nowIso();
  getDb()
    .prepare(
      `INSERT INTO shop_comments (id, shop_id, user_id, body, created_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(id, shopId, userId, text, createdAt);

  const user = getDb()
    .prepare(`SELECT nickname, avatar FROM users WHERE id = ?`)
    .get(userId) as { nickname: string | null; avatar: string | null };

  return {
    id,
    shopId,
    userId,
    nickname: user?.nickname || null,
    avatar: user?.avatar || null,
    body: text,
    createdAt,
    isMine: true,
  };
}

/** 按 poiKey 解析 shop_id（圈子详情用） */
export function resolveShopIdByPoiKey(poiKey: string): string | null {
  const row = getDb()
    .prepare(
      `SELECT id FROM shops
       WHERE COALESCE(source_shop_id, amap_poi_id, id) = ?
       LIMIT 1`
    )
    .get(poiKey) as { id: string } | undefined;
  return row?.id || null;
}
