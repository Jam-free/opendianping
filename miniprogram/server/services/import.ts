import { v4 as uuidv4 } from 'uuid';
import { config } from '../config.js';
import { getDb } from '../db.js';
import { SlidingWindowRateLimiter } from '../rate-limit.js';
import { parseUserInput } from '../adapters/index.js';
import type { ParseInput } from '../adapters/types.js';
import type { FavoriteVisibility, ParsedShop, SourceType } from '../types.js';
import { buildProxyPath } from './media-proxy.js';

export const importRateLimiter = new SlidingWindowRateLimiter(
  config.importRateLimitPerMin
);

/** 预览会话：解析结果暂存内存，保存时再落库 */
const previewStore = new Map<
  string,
  { userId: string; shops: ParsedShop[]; sourceUrl: string; albumId?: string; sourceType: SourceType; expiresAt: number }
>();

export function clearPreviewStore(): void {
  previewStore.clear();
}

export async function parseImport(
  userId: string,
  input: ParseInput & { sourceUrl?: string }
): Promise<{
  previewId: string;
  shops: ParsedShop[];
  adapter: string;
  truncated: boolean;
  message?: string;
  albumId?: string;
}> {
  if (!importRateLimiter.tryConsume(userId)) {
    const err = Object.assign(
      new Error(`导入过于频繁，每分钟最多 ${config.importRateLimitPerMin} 次`),
      { status: 429 }
    );
    throw err;
  }

  const parsed = await parseUserInput(input);
  if (parsed.shops.length === 0) {
    const err = Object.assign(
      new Error(parsed.message || '解析失败：未得到任何店铺'),
      { status: 400 }
    );
    throw err;
  }

  const previewId = uuidv4();
  previewStore.set(previewId, {
    userId,
    shops: parsed.shops,
    sourceUrl: input.sourceUrl || input.text.slice(0, 500),
    albumId: parsed.albumId,
    sourceType: parsed.sourceType,
    expiresAt: Date.now() + 30 * 60_000,
  });

  // 预览卡片与「我的店」列表统一走代理路径，客户端不拼外链域名
  const shopsForClient = parsed.shops.map((s) => ({
    ...s,
    headImgProxy: s.headImg ? buildProxyPath(s.headImg) : null,
  }));

  return {
    previewId,
    shops: shopsForClient,
    adapter: parsed.adapter,
    truncated: parsed.truncated,
    message: parsed.message,
    albumId: parsed.albumId,
  };
}

/** 同店去重键：优先 source_shop_id，其次 amap_poi_id（规格验收 3） */
function findExistingShopId(shop: ParsedShop): string | undefined {
  const db = getDb();
  if (shop.sourceShopId) {
    const bySource = db
      .prepare(`SELECT id FROM shops WHERE source_shop_id = ?`)
      .get(shop.sourceShopId) as { id: string } | undefined;
    if (bySource) return bySource.id;
  }
  if (shop.amapPoiId) {
    const byAmap = db
      .prepare(`SELECT id FROM shops WHERE amap_poi_id = ?`)
      .get(shop.amapPoiId) as { id: string } | undefined;
    if (byAmap) return byAmap.id;
  }
  return undefined;
}

function upsertShop(shop: ParsedShop): string {
  const existing = findExistingShopId(shop);
  const db = getDb();
  if (existing) {
    // 同店去重：来源字段取并集式更新（有值才覆盖空）
    db.prepare(
      `UPDATE shops SET
         raw_name = COALESCE(NULLIF(?, ''), raw_name),
         category = COALESCE(?, category),
         district = COALESCE(?, district),
         city = COALESCE(?, city),
         address = COALESCE(?, address),
         avg_price = COALESCE(?, avg_price),
         lat = COALESCE(?, lat),
         lng = COALESCE(?, lng),
         source_url = COALESCE(?, source_url),
         head_img = COALESCE(?, head_img),
         amap_poi_id = COALESCE(?, amap_poi_id),
         source_shop_id = COALESCE(?, source_shop_id)
       WHERE id = ?`
    ).run(
      shop.name,
      shop.category ?? null,
      shop.district ?? null,
      shop.city ?? null,
      shop.address ?? null,
      shop.avgPrice ?? null,
      shop.lat ?? null,
      shop.lng ?? null,
      shop.sourceUrl ?? null,
      shop.headImg ?? null,
      shop.amapPoiId ?? null,
      shop.sourceShopId ?? null,
      existing
    );
    return existing;
  }

  const id = uuidv4();
  db.prepare(
    `INSERT INTO shops (
      id, source_type, source_shop_id, amap_poi_id, raw_name, adcode,
      category, district, city, address, avg_price, lat, lng, source_url, head_img, display_cache_policy
    ) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'minimal')`
  ).run(
    id,
    shop.sourceType,
    shop.sourceShopId ?? null,
    shop.amapPoiId ?? null,
    shop.name,
    shop.category ?? null,
    shop.district ?? null,
    shop.city ?? null,
    shop.address ?? null,
    shop.avgPrice ?? null,
    shop.lat ?? null,
    shop.lng ?? null,
    shop.sourceUrl ?? null,
    shop.headImg ?? null
  );
  return id;
}

export function saveImportSelection(params: {
  userId: string;
  previewId: string;
  /** 选中的店铺在 preview.shops 中的下标 */
  selectedIndexes: number[];
  visibility: FavoriteVisibility;
  shareToCircleIds?: string[];
}): {
  batchId: string;
  success: number;
  duplicate: number;
  failed: number;
} {
  const preview = previewStore.get(params.previewId);
  if (!preview || preview.userId !== params.userId) {
    throw Object.assign(new Error('预览已过期，请重新解析'), { status: 400 });
  }
  if (preview.expiresAt < Date.now()) {
    previewStore.delete(params.previewId);
    throw Object.assign(new Error('预览已过期，请重新解析'), { status: 400 });
  }

  const indexes = [...new Set(params.selectedIndexes)].filter(
    (i) => i >= 0 && i < preview.shops.length
  );
  if (indexes.length === 0) {
    throw Object.assign(new Error('请至少选择一家店铺'), { status: 400 });
  }

  const db = getDb();
  const batchId = uuidv4();
  let success = 0;
  let duplicate = 0;
  let failed = 0;

  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO import_batches (id, user_id, source_type, source_url, albumid, status, counts, created_at)
       VALUES (?, ?, ?, ?, ?, 'saving', '{}', ?)`
    ).run(
      batchId,
      params.userId,
      preview.sourceType,
      preview.sourceUrl,
      preview.albumId ?? null,
      new Date().toISOString()
    );

    for (const idx of indexes) {
      try {
        const shop = preview.shops[idx];
        const shopId = upsertShop(shop);
        const existingFav = db
          .prepare(
            `SELECT id FROM favorites WHERE user_id = ? AND shop_id = ?`
          )
          .get(params.userId, shopId) as { id: string } | undefined;

        if (existingFav) {
          duplicate += 1;
          // 重复：若本次要共享，提升可见性
          if (params.visibility === 'circles') {
            db.prepare(
              `UPDATE favorites SET visibility = 'circles' WHERE id = ?`
            ).run(existingFav.id);
          }
          continue;
        }

        const favId = uuidv4();
        db.prepare(
          `INSERT INTO favorites (id, user_id, shop_id, note, visibility, import_batch_id, created_at)
           VALUES (?, ?, ?, NULL, ?, ?, ?)`
        ).run(
          favId,
          params.userId,
          shopId,
          params.visibility,
          batchId,
          new Date().toISOString()
        );

        if (params.shareToCircleIds?.length) {
          for (const circleId of params.shareToCircleIds) {
            const member = db
              .prepare(
                `SELECT 1 FROM circle_members WHERE circle_id = ? AND user_id = ?`
              )
              .get(circleId, params.userId);
            if (!member) continue;
            db.prepare(
              `INSERT OR IGNORE INTO circle_shares (circle_id, favorite_id) VALUES (?, ?)`
            ).run(circleId, favId);
          }
        }
        success += 1;
      } catch {
        failed += 1;
      }
    }

    db.prepare(
      `UPDATE import_batches SET status = 'done', counts = ? WHERE id = ?`
    ).run(JSON.stringify({ success, duplicate, failed }), batchId);
  });

  tx();
  previewStore.delete(params.previewId);
  return { batchId, success, duplicate, failed };
}

export function undoImportBatch(userId: string, batchId: string): number {
  const db = getDb();
  const batch = db
    .prepare(`SELECT id FROM import_batches WHERE id = ? AND user_id = ?`)
    .get(batchId, userId);
  if (!batch) {
    throw Object.assign(new Error('批次不存在'), { status: 404 });
  }
  const result = db
    .prepare(`DELETE FROM favorites WHERE user_id = ? AND import_batch_id = ?`)
    .run(userId, batchId);
  db.prepare(
    `UPDATE import_batches SET status = 'undone' WHERE id = ?`
  ).run(batchId);
  return result.changes;
}
