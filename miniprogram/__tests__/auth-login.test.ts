import { afterAll, afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import request from 'supertest';
import { config } from '../server/config.js';
import { resetDbForTests, closeDb, getDb } from '../server/db.js';
import {
  loginWithWxCode,
  readWxGatewayIdentity,
} from '../server/auth.js';
import { createApp } from '../server/app.js';

const configSnapshot = {
  devAuthBypass: config.devAuthBypass,
  wechatAppId: config.wechatAppId,
  wechatAppSecret: config.wechatAppSecret,
  devOpenIdPrefix: config.devOpenIdPrefix,
};

function productionLoginEnv() {
  config.devAuthBypass = false;
  config.wechatAppId = 'wx_test_appid';
  config.wechatAppSecret = 'test_secret';
}

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    json: async () => body,
  } as Response;
}

describe('登录：网关头 / code 换票 / 出网失败', () => {
  beforeEach(() => {
    resetDbForTests();
    productionLoginEnv();
  });

  afterEach(() => {
    Object.assign(config, configSnapshot);
    jest.restoreAllMocks();
  });

  afterAll(() => {
    Object.assign(config, configSnapshot);
    closeDb();
  });

  test('readWxGatewayIdentity：资源复用 FROM-OPENID 优先于 OPENID', () => {
    const headers: Record<string, string> = {
      'x-wx-openid': 'owner_or_empty',
      'x-wx-from-openid': 'feimao_user',
      'x-wx-unionid': 'u_owner',
      'x-wx-from-unionid': 'u_feimao',
    };
    expect(readWxGatewayIdentity((name) => headers[name])).toEqual({
      openid: 'feimao_user',
      unionid: 'u_feimao',
    });
  });

  test('readWxGatewayIdentity：无 FROM 时用 X-WX-OPENID；空白头视为没有', () => {
    expect(
      readWxGatewayIdentity((name) =>
        name === 'x-wx-openid' ? '  oPLAIN  ' : undefined
      )
    ).toEqual({ openid: 'oPLAIN', unionid: undefined });

    expect(
      readWxGatewayIdentity((name) => (name === 'x-wx-openid' ? '  ' : ''))
    ).toBeNull();
  });

  test('带 x-wx-openid 头时登录成功，且不调用外网', async () => {
    const fetchSpy = jest
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('fetch failed'));

    const app = createApp();
    const res = await request(app)
      .post('/api/auth/login')
      .set('x-wx-openid', 'oHEADER_USER')
      .set('x-wx-unionid', 'uHEADER')
      .send({ code: 'should_be_ignored' });

    expect(res.status).toBe(200);
    expect(res.body.token).toMatch(/^[a-f0-9]{48}$/);
    expect(res.body.user.id).toBeTruthy();
    expect(res.body.networkId).toBeTruthy();
    expect(fetchSpy).not.toHaveBeenCalled();

    const row = getDb()
      .prepare('SELECT openid, unionid FROM users WHERE id = ?')
      .get(res.body.user.id) as { openid: string; unionid: string | null };
    expect(row.openid).toBe('oHEADER_USER');
    expect(row.unionid).toBe('uHEADER');
  });

  test('资源复用 x-wx-from-openid：无密钥也能登录，不打微信', async () => {
    config.wechatAppSecret = '';
    const fetchSpy = jest.spyOn(globalThis, 'fetch');

    const app = createApp();
    const res = await request(app)
      .post('/api/auth/login')
      .set('x-wx-from-openid', 'oFROM_USER')
      .send({ code: '' });

    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
    expect(fetchSpy).not.toHaveBeenCalled();

    const row = getDb()
      .prepare('SELECT openid FROM users WHERE id = ?')
      .get(res.body.user.id) as { openid: string };
    expect(row.openid).toBe('oFROM_USER');
  });

  test('无网关头时 mock 微信接口仍可走 code 换票', async () => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ openid: 'oFROM_CODE', unionid: 'uFROM_CODE' })
    );

    const app = createApp();
    const res = await request(app)
      .post('/api/auth/login')
      .send({ code: 'wx_js_code_1' });

    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const calledUrl = String(fetchSpy.mock.calls[0][0]);
    expect(calledUrl).toContain('https://api.weixin.qq.com/sns/jscode2session');
    expect(calledUrl).toContain('js_code=wx_js_code_1');
    expect(calledUrl).toContain('appid=wx_test_appid');

    const row = getDb()
      .prepare('SELECT openid, unionid FROM users WHERE id = ?')
      .get(res.body.user.id) as { openid: string; unionid: string | null };
    expect(row.openid).toBe('oFROM_CODE');
    expect(row.unionid).toBe('uFROM_CODE');
  });

  test('外网 fetch 抛错时返回可读中文，不原样回 fetch failed', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('fetch failed'));

    const app = createApp();
    const res = await request(app)
      .post('/api/auth/login')
      .send({ code: 'any_code' });

    expect(res.status).toBe(502);
    expect(res.body.error).toBe('无法连接微信登录服务，请稍后重试');
    expect(String(res.body.error)).not.toMatch(/fetch failed/i);
  });

  test('DEV_AUTH_BYPASS=false 时不会走 dev_ 假 openid', async () => {
    const session = await loginWithWxCode('abc', {
      gateway: { openid: 'oREAL' },
    });
    expect(session.user.openid).toBe('oREAL');
    expect(session.user.openid.startsWith(config.devOpenIdPrefix)).toBe(false);
  });

  test('无头且缺 code：400；无头且缺密钥：500 文案保持原样', async () => {
    const app = createApp();
    const missingCode = await request(app).post('/api/auth/login').send({});
    expect(missingCode.status).toBe(400);
    expect(missingCode.body.error).toBe('缺少微信登录 code');

    config.wechatAppSecret = '';
    const missingSecret = await request(app)
      .post('/api/auth/login')
      .send({ code: 'wx_code' });
    expect(missingSecret.status).toBe(500);
    expect(missingSecret.body.error).toBe('未配置 WECHAT_APP_SECRET');
  });
});
