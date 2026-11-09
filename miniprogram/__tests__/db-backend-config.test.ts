import { describe, expect, test } from '@jest/globals';
import {
  parseDatabaseUrl,
  parseMysqlAddress,
  resolveDbBackend,
} from '../server/engine/resolve-backend.js';
import { assessProductionPersistence } from '../server/persistence.js';

describe('数据库后端选择', () => {
  test('默认 SQLite', () => {
    const r = resolveDbBackend({});
    expect(r.dialect).toBe('sqlite');
  });

  test('DATABASE_URL 优先且不含密码泄露到 summary 以外', () => {
    const r = resolveDbBackend({
      DATABASE_URL: 'mysql://cat:s3cret@10.0.0.8:3306/feimaocat',
      DB_BACKEND: 'sqlite',
    });
    expect(r.dialect).toBe('mysql');
    if (r.dialect !== 'mysql') throw new Error('expected mysql');
    expect(r.mysql.user).toBe('cat');
    expect(r.mysql.password).toBe('s3cret');
    expect(r.mysql.database).toBe('feimaocat');
    expect(r.mysql.host).toBe('10.0.0.8');
  });

  test('DB_BACKEND=mysql 缺地址会抛错，避免静默建空 SQLite', () => {
    expect(() => resolveDbBackend({ DB_BACKEND: 'mysql' })).toThrow(/MYSQL_ADDRESS/);
  });

  test('MYSQL_ADDRESS + 用户名', () => {
    const r = resolveDbBackend({
      MYSQL_ADDRESS: '10.1.2.3:3306',
      MYSQL_USERNAME: 'root',
      MYSQL_PASSWORD: 'x',
      MYSQL_DATABASE: 'feimaocat',
    });
    expect(r.dialect).toBe('mysql');
    if (r.dialect !== 'mysql') throw new Error('expected mysql');
    expect(r.mysql.host).toBe('10.1.2.3');
    expect(r.mysql.port).toBe(3306);
  });

  test('parse helpers', () => {
    expect(parseMysqlAddress('10.0.0.1:3307')).toEqual({ host: '10.0.0.1', port: 3307 });
    const u = parseDatabaseUrl('mysql://u:p@h:3306/feimaocat');
    expect(u.database).toBe('feimaocat');
  });
});

describe('MySQL 生产告警', () => {
  test('本地 MySQL 空库不告警；连不上要告警', () => {
    const localEmpty = assessProductionPersistence({
      dbPath: 'mysql://root@127.0.0.1:3306/feimaocat',
      cloudDataPath: false,
      createdNewFile: true,
      ephemeralMount: false,
      userCount: 0,
      favoriteCount: 0,
      agentTokenCount: 0,
      backend: 'mysql',
      mysqlConnected: true,
    });
    expect(localEmpty.shouldWarn).toBe(false);

    const down = assessProductionPersistence({
      dbPath: 'mysql://root@10.0.0.8:3306/feimaocat',
      cloudDataPath: true,
      createdNewFile: true,
      ephemeralMount: false,
      userCount: 0,
      favoriteCount: 0,
      agentTokenCount: 0,
      backend: 'mysql',
      mysqlConnected: false,
    });
    expect(down.shouldWarn).toBe(true);
  });

  test('生产 MySQL 空库要告警', () => {
    const empty = assessProductionPersistence({
      dbPath: 'mysql://root@10.0.0.8:3306/feimaocat',
      cloudDataPath: true,
      createdNewFile: true,
      ephemeralMount: false,
      userCount: 0,
      favoriteCount: 0,
      agentTokenCount: 0,
      backend: 'mysql',
      mysqlConnected: true,
    });
    expect(empty.shouldWarn).toBe(true);
  });
});
