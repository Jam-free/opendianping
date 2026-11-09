/**
 * MySQL 跑在独立线程：主线程才能继续用同步的 prepare().get()，业务代码不用全改成 async。
 * 云托管 Serverless MySQL 冷启动会报 resuming，这里自动重试。
 */
import { parentPort, workerData } from 'node:worker_threads';
import { Buffer } from 'node:buffer';
import { createPool } from 'mysql2/promise';

const sab = workerData.sab;
const flag = new Int32Array(sab, 0, 2);
const payload = new Uint8Array(sab, 8);

let pool = null;
let txConn = null;

function jsonSafe(value) {
  return JSON.parse(
    JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? Number(v) : v))
  );
}

function writeResult(obj) {
  const buf = Buffer.from(JSON.stringify(jsonSafe(obj)), 'utf8');
  if (buf.length > payload.length) {
    const tooBig = Buffer.from(
      JSON.stringify({
        ok: false,
        error: { message: `MySQL result too large (${buf.length} bytes)` },
      }),
      'utf8'
    );
    payload.set(tooBig);
    Atomics.store(flag, 1, tooBig.length);
    Atomics.store(flag, 0, 1);
    Atomics.notify(flag, 0);
    return;
  }
  payload.set(buf);
  Atomics.store(flag, 1, buf.length);
  Atomics.store(flag, 0, 1);
  Atomics.notify(flag, 0);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isResumeError(err) {
  const msg = String(err?.message || err || '');
  const code = String(err?.code || '');
  return (
    /resuming/i.test(msg) ||
    /CynosDB/i.test(msg) ||
    code === 'PROTOCOL_CONNECTION_LOST' ||
    code === 'ECONNRESET' ||
    code === 'ETIMEDOUT' ||
    code === 'ECONNREFUSED'
  );
}

async function withRetry(fn, attempts = 8) {
  let last;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      if (!isResumeError(err) || i === attempts - 1) throw err;
      await sleep(1500 * (i + 1));
    }
  }
  throw last;
}

function conn() {
  if (txConn) return txConn;
  if (!pool) throw new Error('MySQL 尚未连接');
  return pool;
}

async function handle(cmd) {
  switch (cmd.op) {
    case 'connect': {
      if (pool) {
        await pool.end().catch(() => {});
        pool = null;
      }
      pool = createPool({
        host: cmd.config.host,
        port: cmd.config.port,
        user: cmd.config.user,
        password: cmd.config.password,
        database: cmd.config.database,
        waitForConnections: true,
        connectionLimit: 8,
        enableKeepAlive: true,
        charset: 'utf8mb4',
        timezone: 'Z',
        multipleStatements: false,
        namedPlaceholders: false,
      });
      await withRetry(() => pool.query('SELECT 1'));
      return { connected: true };
    }
    case 'ping': {
      await withRetry(() => conn().query('SELECT 1'));
      return { ok: true };
    }
    case 'execute': {
      const sql = cmd.sql;
      const params = Array.isArray(cmd.params) ? cmd.params : [];
      const [result] = await withRetry(() => conn().execute(sql, params));
      if (Array.isArray(result)) {
        return { kind: 'rows', rows: result };
      }
      return {
        kind: 'ok',
        affectedRows: Number(result.affectedRows || 0),
        insertId: Number(result.insertId || 0),
      };
    }
    case 'query': {
      const [result] = await withRetry(() => conn().query(cmd.sql));
      if (Array.isArray(result)) {
        return { kind: 'rows', rows: result };
      }
      return {
        kind: 'ok',
        affectedRows: Number(result.affectedRows || 0),
        insertId: Number(result.insertId || 0),
      };
    }
    case 'begin': {
      if (txConn) throw new Error('MySQL 事务已打开（不支持嵌套）');
      if (!pool) throw new Error('MySQL 尚未连接');
      txConn = await pool.getConnection();
      await txConn.beginTransaction();
      return { ok: true };
    }
    case 'commit': {
      if (!txConn) throw new Error('没有进行中的 MySQL 事务');
      try {
        await txConn.commit();
      } finally {
        txConn.release();
        txConn = null;
      }
      return { ok: true };
    }
    case 'rollback': {
      if (!txConn) return { ok: true };
      try {
        await txConn.rollback();
      } finally {
        txConn.release();
        txConn = null;
      }
      return { ok: true };
    }
    case 'close': {
      if (txConn) {
        try {
          await txConn.rollback();
        } catch {
          /* ignore */
        }
        txConn.release();
        txConn = null;
      }
      if (pool) {
        await pool.end();
        pool = null;
      }
      return { ok: true };
    }
    default:
      throw new Error(`unknown mysql worker op: ${cmd.op}`);
  }
}

parentPort.on('message', async (cmd) => {
  try {
    const result = await handle(cmd);
    writeResult({ ok: true, result });
  } catch (err) {
    writeResult({
      ok: false,
      error: {
        message: err instanceof Error ? err.message : String(err),
        code: err && err.code ? String(err.code) : undefined,
      },
    });
  }
});

Atomics.store(flag, 0, 1);
Atomics.notify(flag, 0);
