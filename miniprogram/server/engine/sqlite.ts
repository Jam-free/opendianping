import Database from 'better-sqlite3';
import type { MiniDatabase, MiniStatement } from './types.js';

/**
 * 给 better-sqlite3 贴上 dialect，让备份/门禁知道这是文件库。
 * prepare 做成实例字段，COS 写库挂钩才能替换它。
 */
export function wrapSqliteDatabase(raw: Database.Database): MiniDatabase {
  const wrapped: MiniDatabase = {
    dialect: 'sqlite',
    prepare: (sql: string) => raw.prepare(sql) as MiniStatement,
    exec: (sql: string) => {
      raw.exec(sql);
    },
    transaction: <T>(fn: () => T) => raw.transaction(fn),
    pragma: (source: string) => raw.pragma(source),
    close: () => raw.close(),
  };
  return wrapped;
}

export function openSqliteRaw(dbPath: string): Database.Database {
  const database = new Database(dbPath);
  database.pragma('journal_mode = WAL');
  database.pragma('foreign_keys = ON');
  return database;
}
