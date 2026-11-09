import { describe, expect, test } from '@jest/globals';
import { evaluateBootstrapGate } from '../server/bootstrap.js';
import { runPreDeployCheck } from '../scripts/pre-deploy-check.js';

const health = {
  dbPath: 'mysql://root@10.0.0.8:3306/feimaocat',
  backend: 'mysql' as const,
  userCount: 0,
  favoriteCount: 0,
  agentTokenCount: 0,
  warning: null,
};

describe('启动门禁', () => {
  test('非生产直接放行', () => {
    const d = evaluateBootstrapGate({
      nodeEnv: 'test',
      backend: 'mysql',
      preventEmptyStart: true,
      expectedMinUsers: 1,
      health,
      mysqlConfigured: true,
    });
    expect(d.action).toBe('allow');
  });

  test('MySQL 未就绪时仍监听 /health，不退出把容器打成崩溃循环', () => {
    const d = evaluateBootstrapGate({
      nodeEnv: 'production',
      backend: 'mysql',
      preventEmptyStart: true,
      expectedMinUsers: 0,
      health: { ...health, error: 'connect ECONNREFUSED' },
      mysqlConfigured: false,
    });
    expect(d.action).toBe('allow');
    expect(d.logs.some((l) => l.level === 'error')).toBe(true);
  });

  test('EXPECTED_MIN_USERS=0 允许切库当天的空库', () => {
    const d = evaluateBootstrapGate({
      nodeEnv: 'production',
      backend: 'mysql',
      preventEmptyStart: true,
      expectedMinUsers: 0,
      health,
      mysqlConfigured: true,
    });
    expect(d.action).toBe('allow');
  });

  test('期望用户数 > 实际则拒绝启动', () => {
    const d = evaluateBootstrapGate({
      nodeEnv: 'production',
      backend: 'mysql',
      preventEmptyStart: true,
      expectedMinUsers: 3,
      health: { ...health, userCount: 1, favoriteCount: 9, agentTokenCount: 0 },
      mysqlConfigured: true,
    });
    expect(d.action).toBe('exit');
  });

  test('生产 SQLite 不在 /data 则拒绝', () => {
    const d = evaluateBootstrapGate({
      nodeEnv: 'production',
      backend: 'sqlite',
      preventEmptyStart: true,
      expectedMinUsers: 0,
      health: {
        dbPath: '/workspace/data/miniprogram.db',
        backend: 'sqlite',
        userCount: 1,
        favoriteCount: 1,
        agentTokenCount: 1,
        warning: null,
      },
      mysqlConfigured: false,
    });
    expect(d.action).toBe('exit');
  });
});

describe('pre-deploy-check', () => {
  test('当前仓库已声明 MySQL 且不含密码', () => {
    const results = runPreDeployCheck();
    const errors = results.filter((r) => !r.passed && r.severity === 'error');
    expect(errors).toEqual([]);
    expect(results.some((r) => r.name === 'db_backend_mysql' && r.passed)).toBe(
      true
    );
  });
});
