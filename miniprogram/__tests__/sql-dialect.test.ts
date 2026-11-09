import { describe, expect, test } from '@jest/globals';
import {
  bindSqlParams,
  translateGroupConcat,
  translateSqlToMysql,
} from '../server/engine/sql-dialect.js';

describe('SQLite → MySQL SQL 翻译', () => {
  test('INSERT OR IGNORE / datetime(now) / 命名参数', () => {
    const sql = translateSqlToMysql(
      `INSERT OR IGNORE INTO circle_members (circle_id, user_id, role, joined_at)
       VALUES (@id, ?, 'member', datetime('now'))`
    );
    expect(sql).toContain('INSERT IGNORE');
    expect(sql).not.toMatch(/INSERT OR IGNORE/i);
    expect(sql).toContain("DATE_FORMAT(UTC_TIMESTAMP(), '%Y-%m-%d %H:%i:%s')");

    const bound = bindSqlParams(
      `INSERT INTO users (id, openid) VALUES (@id, @openid)`,
      [{ id: 'u1', openid: 'o1' }]
    );
    expect(bound.sql).toBe('INSERT INTO users (id, openid) VALUES (?, ?)');
    expect(bound.values).toEqual(['u1', 'o1']);
  });

  test('GROUP_CONCAT 两参数含嵌套括号', () => {
    const sql = translateGroupConcat(
      `SELECT GROUP_CONCAT(COALESCE(
                (SELECT created_at FROM favorites WHERE shop_id = shops.id LIMIT 1),
                '9999-12-31'
              ), '|') AS created_ats FROM shops`
    );
    expect(sql).toContain('SEPARATOR');
    expect(sql).toContain("'|'");
    expect(sql).not.toMatch(/GROUP_CONCAT\([^)]+,\s*'\|'\)/);
  });

  test('普通 GROUP_CONCAT(expr) 不改', () => {
    const src = `SELECT GROUP_CONCAT(id) FROM shops`;
    expect(translateGroupConcat(src)).toBe(src);
  });
});
