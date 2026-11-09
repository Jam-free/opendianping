#!/usr/bin/env tsx
/**
 * 导入本机快照（fm_shops.json / inventory csv / 备份 JSON）到 SQLite 或 MySQL。
 * 默认 dry-run。不要对生产跑 --execute，除非 Jam 已确认持久化就绪。
 */
import fs from 'node:fs';
import path from 'node:path';
import { closeDb, getDb, openDatabase, startupDatabase } from '../server/db.js';
import {
  applyShopImport,
  parseSnapshotPayload,
  planShopImport,
} from '../server/engine/snapshot-import.js';
import { restoreDatabaseFromPayload, type BackupPayload } from '../server/backup.js';
import { resolveDbBackend } from '../server/engine/resolve-backend.js';

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function arg(name: string, fallback?: string): string | undefined {
  const idx = process.argv.indexOf(name);
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1];
  return fallback;
}

async function main(): Promise<void> {
  const from = arg('--from');
  if (!from) {
    throw new Error('需要 --from <fm_shops.json|inventory.csv|backup.json>');
  }
  const execute = hasFlag('--execute');
  const includePending = hasFlag('--include-pending');
  const userId = arg('--user-id');
  const sqliteTarget = arg('--target');
  const fullBackup = hasFlag('--full-backup');

  if (process.env.NODE_ENV === 'production' && !hasFlag('--i-understand-production')) {
    throw new Error('生产环境拒绝导入。Jam 确认后才能加 --i-understand-production');
  }
  if (sqliteTarget && (sqliteTarget === '/data' || sqliteTarget.startsWith('/data/'))) {
    throw new Error('拒绝写入 /data/');
  }

  const rawText = fs.readFileSync(from, 'utf8');
  const isCsv = from.toLowerCase().endsWith('.csv');
  const parsed = isCsv
    ? parseSnapshotPayload(null, rawText)
    : parseSnapshotPayload(JSON.parse(rawText) as unknown);

  console.log(`快照类型=${parsed.kind} 店铺=${parsed.shops.length}`);

  const open = async () => {
    if (sqliteTarget) return openDatabase(sqliteTarget, { skipBackupInit: true });
    const resolved = resolveDbBackend();
    if (resolved.dialect === 'mysql') {
      await startupDatabase({ skipBackupInit: true });
      return getDb();
    }
    return openDatabase(undefined, { skipBackupInit: true });
  };

  const db = await open();
  try {
    if (fullBackup && parsed.backupTables) {
      const payload = JSON.parse(rawText) as BackupPayload;
      console.log('完整备份表：', Object.fromEntries(
        Object.entries(payload.tables).map(([k, v]) => [k, v.length])
      ));
      if (!execute) {
        console.log('dry-run：完整恢复未写入。加 --execute 才写。');
        return;
      }
      restoreDatabaseFromPayload(db, payload);
      console.log('已按备份 JSON 全量恢复');
      return;
    }

    const plan = execute
      ? applyShopImport(db, parsed.shops, { includePending, userId })
      : planShopImport(db, parsed.shops, { includePending, userId });

    console.log(execute ? '已写入：' : 'dry-run：');
    console.log({
      shopInserts: plan.shopInserts,
      shopUpdates: plan.shopUpdates,
      favoriteInserts: plan.favoriteInserts,
      skipped: plan.skipped,
      userId: userId || '(未指定，只导入店铺不建收藏)',
    });
    if (!execute) console.log('确认后加 --execute');
  } finally {
    if (sqliteTarget) db.close();
    else closeDb();
  }
}

if (process.argv[1] && path.basename(process.argv[1]).includes('import-snapshot')) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}

export { main as importSnapshotMain };
