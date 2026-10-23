import { getDb } from '../db.js';
import type { FavoriteVisibility } from '../types.js';

export function listFavorites(userId: string) {
  return getDb()
    .prepare(
      `SELECT f.id, f.note, f.visibility, f.import_batch_id, f.created_at,
              s.id AS shop_id, s.raw_name AS name, s.avg_price, s.category,
              s.district, s.city, s.address, s.lat, s.lng,
              s.source_type, s.source_shop_id, s.amap_poi_id, s.source_url
       FROM favorites f
       JOIN shops s ON s.id = f.shop_id
       WHERE f.user_id = ?
       ORDER BY f.created_at DESC`
    )
    .all(userId);
}

export function deleteFavorite(userId: string, favoriteId: string): void {
  const result = getDb()
    .prepare(`DELETE FROM favorites WHERE id = ? AND user_id = ?`)
    .run(favoriteId, userId);
  if (result.changes === 0) {
    throw Object.assign(new Error('收藏不存在'), { status: 404 });
  }
}

export function updateFavorite(
  userId: string,
  favoriteId: string,
  patch: { visibility?: FavoriteVisibility; note?: string }
): void {
  const db = getDb();
  const row = db
    .prepare(`SELECT id FROM favorites WHERE id = ? AND user_id = ?`)
    .get(favoriteId, userId);
  if (!row) {
    throw Object.assign(new Error('收藏不存在'), { status: 404 });
  }
  if (patch.note !== undefined && patch.note.length > 200) {
    throw Object.assign(new Error('备注最多 200 字'), { status: 400 });
  }
  if (patch.visibility) {
    db.prepare(`UPDATE favorites SET visibility = ? WHERE id = ?`).run(
      patch.visibility,
      favoriteId
    );
  }
  if (patch.note !== undefined) {
    db.prepare(`UPDATE favorites SET note = ? WHERE id = ?`).run(
      patch.note,
      favoriteId
    );
  }
}
