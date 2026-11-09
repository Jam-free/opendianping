#!/usr/bin/env tsx
/**
 * 只读导出：去掉 session、Agent Token 哈希，手机号脱敏。
 * 不会连生产；目标默认写到当前目录以外的文件。
 */
import fs from 'node:fs';
import path from 'node:path';
import { exportDatabaseSnapshot } from '../server/backup.js';
import { openDatabase, closeDb, startupDatabase, getDb } from '../server/db.js';
import { redactBackupPayload } from '../server/engine/snapshot-import.js';
import { resolveDbBackend } from '../server/engine/resolve-backend.js';

function arg(name: string, fallback?: string): string | undefined {
  const idx = process.argv.indexOf(name);
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1];
  return fallback;
}

async function main(): Promise<void> {
  const sqlitePath = arg('--sqlite');
  const out = arg('--out', `feimaocat-export-${Date.now()}.json`)!;
  if (path.resolve(out).startsWith('/data/')) {
    throw new Error('拒绝写到 /data/');
  }

  if (sqlitePath) {
    const db = openDatabase(sqlitePath, { skipBackupInit: true });
    const payload = redactBackupPayload(exportDatabaseSnapshot(db));
    fs.writeFileSync(out, JSON.stringify(payload, null, 2));
    db.close();
  } else {
    const resolved = resolveDbBackend();
    if (resolved.dialect === 'mysql') {
      await startupDatabase({ skipBackupInit: true });
      const payload = redactBackupPayload(exportDatabaseSnapshot(getDb()));
      fs.writeFileSync(out, JSON.stringify(payload, null, 2));
      closeDb();
    } else {
      const db = openDatabase(undefined, { skipBackupInit: true });
      const payload = redactBackupPayload(exportDatabaseSnapshot(db));
      fs.writeFileSync(out, JSON.stringify(payload, null, 2));
      db.close();
    }
  }
  console.log(`已写入 ${out}（已去掉 sessions / token_hash，手机号已脱敏）`);
}

if (process.argv[1] && path.basename(process.argv[1]).includes('export-db-safe')) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
