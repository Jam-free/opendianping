/**
 * 业务层只用这一小撮 API（对齐 better-sqlite3 的 prepare/get/all/run/transaction）。
 * 产品意图：本地继续用文件库开发；生产改连 MySQL 时，收藏/Token 的读写代码不用重写一遍。
 */
export type DbDialect = 'sqlite' | 'mysql';

export type RunResult = {
  changes: number;
  lastInsertRowid: number | bigint;
};

export type MiniStatement = {
  get<T = unknown>(...params: unknown[]): T | undefined;
  all<T = unknown>(...params: unknown[]): T[];
  run(...params: unknown[]): RunResult;
};

export type MiniDatabase = {
  dialect: DbDialect;
  prepare(sql: string): MiniStatement;
  exec(sql: string): void;
  transaction<T>(fn: () => T): () => T;
  pragma(source: string): unknown;
  close(): void;
};

export type MysqlConnectionConfig = {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
};

export type ResolvedDbBackend =
  | { dialect: 'sqlite'; reason: string }
  | { dialect: 'mysql'; reason: string; mysql: MysqlConnectionConfig };
