/**
 * 把业务 SQL 里少数 SQLite 写法转成 MySQL。
 * 只翻译实际出现过的方言：INSERT OR IGNORE、GROUP_CONCAT(x, sep)、datetime('now')、@named。
 * 不解析完整 SQL——复杂查询保持原样，避免「聪明翻译」把语义改坏。
 */

export function findMatchingParen(sql: string, openIndex: number): number {
  let depth = 0;
  let quote: "'" | '"' | null = null;
  for (let i = openIndex; i < sql.length; i += 1) {
    const ch = sql[i]!;
    if (quote) {
      if (ch === '\\' && quote === '"') {
        i += 1;
        continue;
      }
      if (ch === quote) {
        if (quote === "'" && sql[i + 1] === "'") {
          i += 1;
          continue;
        }
        quote = null;
      }
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }
    if (ch === '(') depth += 1;
    else if (ch === ')') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

export function splitTopLevelComma(inner: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let depth = 0;
  let quote: "'" | '"' | null = null;
  for (let i = 0; i < inner.length; i += 1) {
    const ch = inner[i]!;
    if (quote) {
      if (ch === quote) {
        if (quote === "'" && inner[i + 1] === "'") {
          i += 1;
          continue;
        }
        quote = null;
      }
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }
    if (ch === '(') depth += 1;
    else if (ch === ')') depth -= 1;
    else if (ch === ',' && depth === 0) {
      parts.push(inner.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(inner.slice(start));
  return parts;
}

/**
 * SQLite: GROUP_CONCAT(expr, '|')
 * MySQL:  GROUP_CONCAT(expr SEPARATOR '|')
 */
export function translateGroupConcat(sql: string): string {
  const re = /GROUP_CONCAT\s*\(/gi;
  let result = '';
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(sql))) {
    const open = match.index + match[0].length - 1;
    const close = findMatchingParen(sql, open);
    if (close < 0) break;
    const inner = sql.slice(open + 1, close);
    const parts = splitTopLevelComma(inner);
    if (parts.length >= 2) {
      const sep = parts[parts.length - 1]!.trim();
      const expr = parts.slice(0, -1).join(',').trim();
      if (/^['"]/.test(sep)) {
        result += sql.slice(last, match.index) + `GROUP_CONCAT(${expr} SEPARATOR ${sep})`;
        last = close + 1;
        re.lastIndex = last;
        continue;
      }
    }
    re.lastIndex = close + 1;
  }
  return result + sql.slice(last);
}

function mapDatetimeNow(sql: string): string {
  // 对齐 SQLite datetime('now') 的 'YYYY-MM-DD HH:MM:SS'，写入 VARCHAR 时间列。
  return sql.replace(
    /\bdatetime\s*\(\s*'now'\s*\)/gi,
    "DATE_FORMAT(UTC_TIMESTAMP(), '%Y-%m-%d %H:%i:%s')"
  );
}

export function translateSqlToMysql(sql: string): string {
  let out = sql;
  out = out.replace(/\bINSERT\s+OR\s+IGNORE\b/gi, 'INSERT IGNORE');
  out = out.replace(/\bINSERT\s+OR\s+REPLACE\b/gi, 'REPLACE');
  out = mapDatetimeNow(out);
  out = translateGroupConcat(out);
  return out;
}

export type BoundSql = {
  sql: string;
  values: unknown[];
};

const NAMED_RE = /[@:$]([A-Za-z_][A-Za-z0-9_]*)/g;

function isPlainBindObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  if (Array.isArray(value)) return false;
  if (Buffer.isBuffer(value)) return false;
  return true;
}

/**
 * better-sqlite3 允许 `VALUES (@id, @openid)` + `.run(user)`。
 * mysql2 预编译只用 `?`。把对象参数按 SQL 里出现的名字展开。
 */
export function bindSqlParams(sql: string, params: unknown[]): BoundSql {
  if (
    params.length === 1 &&
    isPlainBindObject(params[0]) &&
    /[@:$][A-Za-z_]/.test(sql)
  ) {
    const obj = params[0];
    const names: string[] = [];
    const positional = sql.replace(NAMED_RE, (_m, name: string) => {
      names.push(name);
      return '?';
    });
    return {
      sql: positional,
      values: names.map((n) => (obj[n] === undefined ? null : obj[n])),
    };
  }
  return { sql, values: params };
}

export function isWriteSql(sql: string): boolean {
  return /^\s*(INSERT|UPDATE|DELETE|REPLACE)\b/i.test(sql);
}
