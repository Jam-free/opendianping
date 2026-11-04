/**
 * poi_key 冲突修复脚本
 * 
 * 问题：多个不同的店铺（不同 shop.id）共享同一个 source_shop_id 或 amap_poi_id
 * 导致它们有相同的 poi_key，在圈子视图中被错误合并。
 * 
 * 修复策略：
 * 1. 检测冲突：找出所有共享同一 source_shop_id/amap_poi_id 的店铺
 * 2. 保留第一个（最早创建的）店铺的外部ID
 * 3. 其他冲突店铺的外部ID设为 NULL，让它们使用 shop.id 作为 poi_key
 * 
 * 注意：此脚本需要手动运行，不会自动执行
 * 
 * 使用方法：
 * ```bash
 * cd miniprogram
 * npx tsx scripts/repair-poi-key-collisions.ts --dry-run
 * npx tsx scripts/repair-poi-key-collisions.ts --execute
 * ```
 */

import { openDatabase, closeDb } from '../server/db.js';

type Collision = {
  externalId: string;
  idType: 'source_shop_id' | 'amap_poi_id';
  shopIds: string[];
  shopNames: string[];
  createdAts: string[];
};

function detectCollisions(): Collision[] {
  const db = openDatabase();
  const collisions: Collision[] = [];

  const sourceCollisions = db
    .prepare(
      `SELECT source_shop_id AS external_id,
              GROUP_CONCAT(id, '|') AS shop_ids,
              GROUP_CONCAT(raw_name, '|') AS shop_names,
              GROUP_CONCAT(COALESCE(
                (SELECT created_at FROM favorites WHERE shop_id = shops.id LIMIT 1),
                '9999-12-31'
              ), '|') AS created_ats,
              COUNT(DISTINCT id) AS shop_count
       FROM shops
       WHERE source_shop_id IS NOT NULL
       GROUP BY source_shop_id
       HAVING shop_count > 1`
    )
    .all() as Array<{
      external_id: string;
      shop_ids: string;
      shop_names: string;
      created_ats: string;
    }>;

  for (const row of sourceCollisions) {
    collisions.push({
      externalId: row.external_id,
      idType: 'source_shop_id',
      shopIds: row.shop_ids.split('|'),
      shopNames: row.shop_names.split('|'),
      createdAts: row.created_ats.split('|'),
    });
  }

  const amapCollisions = db
    .prepare(
      `SELECT amap_poi_id AS external_id,
              GROUP_CONCAT(id, '|') AS shop_ids,
              GROUP_CONCAT(raw_name, '|') AS shop_names,
              GROUP_CONCAT(COALESCE(
                (SELECT created_at FROM favorites WHERE shop_id = shops.id LIMIT 1),
                '9999-12-31'
              ), '|') AS created_ats,
              COUNT(DISTINCT id) AS shop_count
       FROM shops
       WHERE amap_poi_id IS NOT NULL
       GROUP BY amap_poi_id
       HAVING shop_count > 1`
    )
    .all() as Array<{
      external_id: string;
      shop_ids: string;
      shop_names: string;
      created_ats: string;
    }>;

  for (const row of amapCollisions) {
    collisions.push({
      externalId: row.external_id,
      idType: 'amap_poi_id',
      shopIds: row.shop_ids.split('|'),
      shopNames: row.shop_names.split('|'),
      createdAts: row.created_ats.split('|'),
    });
  }

  return collisions;
}

function repairCollisions(dryRun: boolean): void {
  const db = openDatabase();
  const collisions = detectCollisions();

  if (collisions.length === 0) {
    console.log('✅ 没有检测到 poi_key 冲突');
    closeDb();
    return;
  }

  console.log(`\n🔍 检测到 ${collisions.length} 个冲突：\n`);

  for (const collision of collisions) {
    console.log(`冲突 ${collision.idType}: ${collision.externalId}`);
    console.log(`  涉及 ${collision.shopIds.length} 个店铺：`);

    const sorted = collision.shopIds
      .map((id, i) => ({
        id,
        name: collision.shopNames[i],
        createdAt: collision.createdAts[i],
      }))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

    sorted.forEach((shop, i) => {
      const keep = i === 0 ? '✓ 保留' : '✗ 清除外部ID';
      console.log(`    ${keep} [${shop.createdAt}] ${shop.name} (${shop.id})`);
    });

    if (!dryRun) {
      const tx = db.transaction(() => {
        for (let i = 1; i < sorted.length; i++) {
          const update =
            collision.idType === 'source_shop_id'
              ? `UPDATE shops SET source_shop_id = NULL WHERE id = ?`
              : `UPDATE shops SET amap_poi_id = NULL WHERE id = ?`;
          db.prepare(update).run(sorted[i].id);
        }
      });
      tx();
      console.log(`  ✅ 已修复\n`);
    } else {
      console.log(`  ⏸️  预览模式，未实际修改\n`);
    }
  }

  if (dryRun) {
    console.log(
      '\n💡 要执行修复，请运行：npx tsx scripts/repair-poi-key-collisions.ts --execute\n'
    );
  } else {
    console.log(`\n✅ 已修复 ${collisions.length} 个冲突\n`);
  }

  closeDb();
}

const args = process.argv.slice(2);
const dryRun = !args.includes('--execute');

console.log('poi_key 冲突修复脚本');
console.log('====================\n');

if (dryRun) {
  console.log('⏸️  预览模式（dry-run）');
  console.log('    只显示冲突，不会修改数据\n');
} else {
  console.log('⚠️  执行模式');
  console.log('    将修改数据库！\n');
}

repairCollisions(dryRun);
