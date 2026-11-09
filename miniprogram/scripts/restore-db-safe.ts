#!/usr/bin/env tsx
/**
 * 默认 dry-run。拒绝 /data 与 NODE_ENV=production。
 * 用于把备份 JSON 灌进临时 SQLite 或本机 MySQL（由环境变量决定）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { restoreDatabaseFromPayload, type BackupPayload } from '../server/backup.js';
import { closeDb, getDb, openDatabase, startupDatabase } from '../server/db.js';
import {
  assertNoDevOpenids,
  assertSafeRestoreTarget,
} from '../server/engine/snapshot-import.js';
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
  if (!from) throw new Error('需要 --from backup.json');
  const execute = hasFlag('--execute');
  const sqliteTarget = arg('--target');
  const payload = JSON.parse(fs.readFileSync(from, 'utf8')) as BackupPayload;
  if (!payload.tables) throw new Error('不是备份 JSON（缺少 tables）');

  assertNoDevOpenids(payload.tables.users || []);
  if (sqliteTarget) {
    assertSafeRestoreTarget(sqliteTarget, process.env.NODE_ENV || 'development');
  } else {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('NODE_ENV=production 时拒绝 restore');
    }
  }

  const counts = Object.fromEntries(
    Object.entries(payload.tables).map(([k, v]) => [k, v.length])
  );
  console.log(execute ? '将写入：' : 'dry-run（加 --execute 才写入）：');
  console.log(counts);

  if (!execute) {
    console.log('未写入。确认后再加 --execute');
    return;
  }

  if (sqliteTarget) {
    const db = openDatabase(sqliteTarget, { skipBackupInit: true });
    restoreDatabaseFromPayload(db, payload);
    db.close();
    console.log(`已恢复到 SQLite ${sqliteTarget}`);
    return;
  }

  const resolved = resolveDbBackend();
  if (resolved.dialect !== 'mysql') {
    throw new Error('未指定 --target SQLite，且环境也不是 MySQL。请显式传 --target /tmp/restore.db');
  }
  await startupDatabase({ skipBackupInit: true });
  restoreDatabaseFromPayload(getDb(), payload);
  closeDb();
  console.log('已恢复到当前环境的 MySQL（请确认这不是生产）');
}

if (process.argv[1] && path.basename(process.argv[1]).includes('restore-db-safe')) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
