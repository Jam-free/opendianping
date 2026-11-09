import type { MiniDatabase } from './types.js';

export function tableExists(database: MiniDatabase, table: string): boolean {
  if (database.dialect === 'mysql') {
    const row = database
      .prepare(
        `SELECT 1 AS n FROM information_schema.tables
         WHERE table_schema = DATABASE() AND table_name = ?`
      )
      .get(table) as { n: number } | undefined;
    return Boolean(row);
  }
  const row = database
    .prepare(`SELECT 1 AS n FROM sqlite_master WHERE type = 'table' AND name = ?`)
    .get(table) as { n: number } | undefined;
  return Boolean(row);
}

export function listBusinessTablesPresent(
  database: MiniDatabase,
  tables: readonly string[]
): string[] {
  return tables.filter((t) => tableExists(database, t));
}
