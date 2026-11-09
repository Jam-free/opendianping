import { Buffer } from 'node:buffer';
import { Worker } from 'node:worker_threads';
import type { MiniDatabase, MiniStatement, MysqlConnectionConfig, RunResult } from './types.js';
import { bindSqlParams, translateSqlToMysql } from './sql-dialect.js';

const HEADER_BYTES = 8;
const PAYLOAD_BYTES = 16 * 1024 * 1024;
const READY_TIMEOUT_MS = 15_000;
const CALL_TIMEOUT_MS = 120_000;

type WorkerCall = {
  worker: Worker;
  sab: SharedArrayBuffer;
  flag: Int32Array;
  payload: Uint8Array;
};

let workerCall: WorkerCall | null = null;

function ensureWorker(): WorkerCall {
  if (workerCall) return workerCall;
  const sab = new SharedArrayBuffer(HEADER_BYTES + PAYLOAD_BYTES);
  const flag = new Int32Array(sab, 0, 2);
  Atomics.store(flag, 0, 0);
  const worker = new Worker(new URL('./mysql-worker.mjs', import.meta.url), {
    workerData: { sab },
  });
  worker.on('error', (err) => {
    console.error('[mysql-worker]', err);
  });
  const wait = Atomics.wait(flag, 0, 0, READY_TIMEOUT_MS);
  if (wait === 'timed-out') {
    worker.terminate();
    throw new Error('MySQL worker 启动超时');
  }
  workerCall = {
    worker,
    sab,
    flag,
    payload: new Uint8Array(sab, HEADER_BYTES),
  };
  return workerCall;
}

function dispatch(cmd: Record<string, unknown>): unknown {
  const state = ensureWorker();
  Atomics.store(state.flag, 0, 0);
  state.worker.postMessage(cmd);
  const wait = Atomics.wait(state.flag, 0, 0, CALL_TIMEOUT_MS);
  if (wait === 'timed-out') {
    throw new Error(`MySQL 调用超时: ${String(cmd.op)}`);
  }
  const len = Atomics.load(state.flag, 1);
  const slice = Buffer.from(state.payload.subarray(0, len));
  const parsed = JSON.parse(slice.toString('utf8')) as {
    ok: boolean;
    result?: unknown;
    error?: { message: string; code?: string };
  };
  if (!parsed.ok) {
    const err = new Error(parsed.error?.message || 'MySQL error');
    if (parsed.error?.code) (err as Error & { code?: string }).code = parsed.error.code;
    throw err;
  }
  return parsed.result;
}

export function mysqlDispatchForTests(cmd: Record<string, unknown>): unknown {
  return dispatch(cmd);
}

function parseTableInfoPragma(source: string): string | null {
  const m = source.match(/^\s*table_info\(\s*([A-Za-z0-9_]+)\s*\)\s*$/i);
  return m ? m[1]! : null;
}

function mysqlTableColumns(table: string): Array<{ name: string }> {
  const result = dispatch({
    op: 'execute',
    sql: `SELECT COLUMN_NAME AS name
          FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
          ORDER BY ORDINAL_POSITION`,
    params: [table],
  }) as { kind: string; rows: Array<{ name: string }> };
  return result.rows || [];
}

function createStatement(originalSql: string): MiniStatement {
  const mysqlSql = translateSqlToMysql(originalSql);
  const runExecute = (...params: unknown[]) => {
    const bound = bindSqlParams(mysqlSql, params);
    return dispatch({
      op: 'execute',
      sql: bound.sql,
      params: bound.values,
    }) as { kind: string; rows?: unknown[]; affectedRows?: number; insertId?: number };
  };

  return {
    get<T = unknown>(...params: unknown[]): T | undefined {
      const result = runExecute(...params);
      const rows = result.rows || [];
      return rows[0] as T | undefined;
    },
    all<T = unknown>(...params: unknown[]): T[] {
      const result = runExecute(...params);
      return (result.rows || []) as T[];
    },
    run(...params: unknown[]): RunResult {
      const result = runExecute(...params);
      return {
        changes: Number(result.affectedRows || 0),
        lastInsertRowid: Number(result.insertId || 0),
      };
    },
  };
}

export class MysqlDatabase implements MiniDatabase {
  readonly dialect = 'mysql' as const;
  private closed = false;

  constructor(readonly summary: string) {}

  prepare = (sql: string): MiniStatement => {
    this.ensureOpen();
    return createStatement(sql);
  };

  exec(sql: string): void {
    this.ensureOpen();
    const statements = splitMysqlStatements(translateSqlToMysql(sql));
    for (const stmt of statements) {
      if (!stmt.trim()) continue;
      dispatch({ op: 'query', sql: stmt });
    }
  }

  transaction<T>(fn: () => T): () => T {
    return () => {
      this.ensureOpen();
      dispatch({ op: 'begin' });
      try {
        const value = fn();
        dispatch({ op: 'commit' });
        return value;
      } catch (err) {
        try {
          dispatch({ op: 'rollback' });
        } catch {
          /* ignore rollback errors */
        }
        throw err;
      }
    };
  }

  pragma(source: string): unknown {
    this.ensureOpen();
    const table = parseTableInfoPragma(source);
    if (table) return mysqlTableColumns(table);
    throw new Error(`MySQL adapter 不支持 PRAGMA ${source}`);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    try {
      dispatch({ op: 'close' });
    } finally {
      if (workerCall) {
        void workerCall.worker.terminate();
        workerCall = null;
      }
    }
  }

  ping(): void {
    this.ensureOpen();
    dispatch({ op: 'ping' });
  }

  private ensureOpen(): void {
    if (this.closed) throw new Error('MySQL 连接已关闭');
  }
}

export function splitMysqlStatements(sql: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let depth = 0;
  let quote: "'" | '"' | '`' | null = null;
  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i]!;
    if (quote) {
      if (ch === '\\') {
        i += 1;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '(') depth += 1;
    else if (ch === ')') depth -= 1;
    else if (ch === ';' && depth === 0) {
      parts.push(sql.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(sql.slice(start));
  return parts.map((p) => p.trim()).filter(Boolean);
}

export function openMysqlDatabase(config: MysqlConnectionConfig): MysqlDatabase {
  dispatch({ op: 'connect', config });
  const db = new MysqlDatabase(
    `mysql://${config.user}@${config.host}:${config.port}/${config.database}`
  );
  return db;
}

export function resetMysqlWorkerForTests(): void {
  if (!workerCall) return;
  try {
    dispatch({ op: 'close' });
  } catch {
    /* ignore */
  }
  void workerCall.worker.terminate();
  workerCall = null;
}
