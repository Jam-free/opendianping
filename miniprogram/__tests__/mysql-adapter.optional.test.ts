import { describe, expect, test } from '@jest/globals';

/**
 * 需要本机 MySQL 时设置 MYSQL_TEST_URL=mysql://user:pass@127.0.0.1:3306/feimaocat_test
 * CI / 本环境默认跳过，避免连生产或误连。
 */
const url = process.env.MYSQL_TEST_URL || '';

describe('MySQL 适配器（可选）', () => {
  const maybe = url.startsWith('mysql://') ? test : test.skip;

  maybe('能建表、写入 users、读回计数', async () => {
    const { parseDatabaseUrl } = await import('../server/engine/resolve-backend.js');
    const { openMysqlDatabase, resetMysqlWorkerForTests } = await import(
      '../server/engine/mysql.js'
    );
    const { applySchema } = await import('../server/engine/schema.js');
    const cfg = parseDatabaseUrl(url);
    const db = openMysqlDatabase(cfg);
    try {
      applySchema(db);
      db.exec(`DELETE FROM shop_comments`);
      db.exec(`DELETE FROM favorites`);
      db.exec(`DELETE FROM users WHERE openid = 'mysql_adapter_test'`);
      db.prepare(
        `INSERT INTO users (id, openid, created_at) VALUES (?, ?, datetime('now'))`
      ).run('u_mysql_test', 'mysql_adapter_test');
      const row = db
        .prepare(`SELECT openid FROM users WHERE id = ?`)
        .get('u_mysql_test') as { openid: string };
      expect(row.openid).toBe('mysql_adapter_test');
      db.exec(`DELETE FROM users WHERE id = 'u_mysql_test'`);
    } finally {
      db.close();
      resetMysqlWorkerForTests();
    }
  });
});
