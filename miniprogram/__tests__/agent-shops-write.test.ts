import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import { createApp } from '../server/app.js';
import { createSessionForOpenId } from '../server/auth.js';
import { closeDb, getDb, resetDbForTests } from '../server/db.js';
import {
  agentShopWriteDayLimiter,
  agentShopWriteMinuteLimiter,
  resetAgentShopWriteLimiters,
  tryConsumeAgentShopWrite,
} from '../server/rate-limit.js';
import { issueAgentToken, listMyShops } from '../server/services/network.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const MINE_KEYS = [
  'poiKey',
  'name',
  'category',
  'district',
  'city',
  'address',
  'lat',
  'lng',
  'note',
  'origin',
  'wishlist',
  'phone',
  'status',
] as const;

let userSeq = 0;

function seedUser(suffix = '') {
  userSeq += 1;
  const session = createSessionForOpenId(`agent_writer_${userSeq}_${suffix}`);
  const issued = issueAgentToken(session.user.id);
  return {
    app: createApp(),
    user: session.user,
    sessionToken: session.token,
    agentToken: issued.token,
  };
}

function auth(agentToken: string) {
  return { Authorization: `Bearer ${agentToken}` };
}

function shopRowByName(name: string) {
  return getDb()
    .prepare(
      `SELECT id, source_type, source_shop_id, amap_poi_id, raw_name, city, lat, lng
       FROM shops WHERE raw_name = ? ORDER BY rowid DESC LIMIT 1`
    )
    .get(name) as
    | {
        id: string;
        source_type: string;
        source_shop_id: string | null;
        amap_poi_id: string | null;
        raw_name: string;
        city: string | null;
        lat: number | null;
        lng: number | null;
      }
    | undefined;
}

describe('S5 Agent 写入本人店', () => {
  beforeEach(() => {
    resetDbForTests();
    resetAgentShopWriteLimiters();
  });

  afterAll(() => {
    closeDb();
  });

  test('S5-NEG-01/02/03/04：无效 Token 一律 401', async () => {
    const { app, sessionToken } = seedUser('neg');
    const body = { name: '泰式河粉', city: '曼谷' };

    const none = await request(app).post('/api/agent/shops').send(body);
    expect(none.status).toBe(401);

    const bogus = await request(app)
      .post('/api/agent/shops')
      .set(auth('fm_deadbeefdeadbeefdeadbeefdeadbeef'))
      .send(body);
    expect(bogus.status).toBe(401);

    const sessionAsAgent = await request(app)
      .post('/api/agent/shops')
      .set('Authorization', `Bearer ${sessionToken}`)
      .send(body);
    expect(sessionAsAgent.status).toBe(401);
  });

  test('E2E-A1 / S5-API-01/02/04：首写 201、pending、GET mine 可见、不编造 shopId', async () => {
    const { app, agentToken, user } = seedUser('a1');
    const posted = await request(app)
      .post('/api/agent/shops')
      .set(auth(agentToken))
      .send({
        name: '泰式河粉',
        city: '曼谷',
        district: '都市酒店天桥下',
        note: '酒店天桥下那家',
        wishlist: false,
      });

    expect(posted.status).toBe(201);
    expect(posted.body.name).toBe('泰式河粉');
    expect(posted.body.city).toBe('曼谷');
    expect(posted.body.district).toContain('都市酒店天桥下');
    expect(posted.body.note).toBe('酒店天桥下那家');
    expect(posted.body.wishlist).toBe(false);
    expect(posted.body.origin).toBe('agent');
    expect(posted.body.status).toBe('pending');
    expect(posted.body.source_shop_id).toBeUndefined();
    for (const key of MINE_KEYS) {
      expect(posted.body).toHaveProperty(key);
    }

    const listed = await request(app)
      .get('/api/agent/shops')
      .set(auth(agentToken));
    expect(listed.status).toBe(200);
    const mine = listed.body.mine as Array<Record<string, unknown>>;
    const hit = mine.filter((s) => s.name === '泰式河粉' && s.city === '曼谷');
    expect(hit).toHaveLength(1);
    expect(hit[0]).toMatchObject({
      origin: 'agent',
      status: 'pending',
      note: '酒店天桥下那家',
      wishlist: false,
    });
    expect(listed.body.semantics.origin).toMatch(/agent=/);

    const my = await listMyShops(user.id);
    expect(my.items[0].sourceTag).toBe('Agent 记下');
    expect(my.items[0].recommendersLine).toBe('Agent 记下');
    expect(my.items[0].status).toBe('pending');

    const row = shopRowByName('泰式河粉');
    expect(row?.source_shop_id).toBeNull();
    expect(row?.source_type).toBe('agent');
    expect(row?.amap_poi_id).toBeNull();
  });

  test('E2E-A2：wishlist=true 后 GET 可按心心念念筛到', async () => {
    const { app, agentToken } = seedUser('a2');
    const posted = await request(app)
      .post('/api/agent/shops')
      .set(auth(agentToken))
      .send({
        name: '清迈咖啡',
        city: '清迈',
        note: '古城边',
        wishlist: true,
      });
    expect(posted.status).toBe(201);
    expect(posted.body.wishlist).toBe(true);

    const listed = await request(app)
      .get('/api/agent/shops')
      .set(auth(agentToken));
    const wanted = (listed.body.mine as Array<Record<string, unknown>>).filter(
      (s) => s.wishlist === true
    );
    expect(wanted.some((s) => s.name === '清迈咖啡' && s.city === '清迈')).toBe(
      true
    );
  });

  test('E2E-A3：重置 Token 后旧票 401，新票可写', async () => {
    const { app, user, sessionToken, agentToken: oldToken } = seedUser('a3');
    expect(
      (await request(app).get('/api/agent/shops').set(auth(oldToken))).status
    ).toBe(200);

    const reset = await request(app)
      .post('/api/agent-tokens/reset')
      .set('Authorization', `Bearer ${sessionToken}`);
    expect(reset.status).toBe(200);
    const newToken = reset.body.token as string;
    expect(newToken).toBeTruthy();
    expect(newToken).not.toBe(oldToken);

    const tokens = getDb()
      .prepare(`SELECT token_hash FROM agent_tokens WHERE user_id = ?`)
      .all(user.id);
    expect(tokens).toHaveLength(1);

    const oldPost = await request(app)
      .post('/api/agent/shops')
      .set(auth(oldToken))
      .send({ name: '旧票不该写入', city: '上海' });
    expect(oldPost.status).toBe(401);
    expect(
      (await request(app).get('/api/agent/shops').set(auth(oldToken))).status
    ).toBe(401);

    const fresh = await request(app)
      .post('/api/agent/shops')
      .set(auth(newToken))
      .send({ name: '重置后可写店', city: '上海' });
    expect(fresh.status).toBe(201);
    const mine = (
      await request(app).get('/api/agent/shops').set(auth(newToken))
    ).body.mine as Array<{ name: string }>;
    expect(mine.some((s) => s.name === '重置后可写店')).toBe(true);
  });

  test('E2E-A4 / S5-SEC-02：仅 name+city → pending，永不写 source_shop_id', async () => {
    const { app, agentToken } = seedUser('a4');
    const posted = await request(app)
      .post('/api/agent/shops')
      .set(auth(agentToken))
      .send({
        name: '街角米线',
        city: '昆明',
        source_shop_id: '1908397290',
        shopId: 'fake-dianping-id',
        source: 'dianping',
      });
    expect(posted.status).toBe(201);
    expect(posted.body.status).toBe('pending');
    expect(posted.body.origin).toBe('agent');
    expect(posted.body.wishlist).toBe(false);
    expect(posted.body.name).toBe('街角米线');
    expect(posted.body.source_shop_id).toBeUndefined();

    const row = shopRowByName('街角米线');
    expect(row?.raw_name).toBe('街角米线');
    expect(row?.source_shop_id).toBeNull();
    expect(row?.amap_poi_id).toBeNull();
  });

  test('E2E-A5 / H5 / H6：同名同城二次 POST 200，备注追加，wishlist=true', async () => {
    const { app, agentToken, user } = seedUser('a5');
    const first = await request(app)
      .post('/api/agent/shops')
      .set(auth(agentToken))
      .send({
        name: '泰式河粉',
        city: '曼谷',
        note: '第一次备注',
        wishlist: false,
      });
    expect(first.status).toBe(201);

    const second = await request(app)
      .post('/api/agent/shops')
      .set(auth(agentToken))
      .send({
        name: ' 泰式河粉 ',
        city: '曼谷',
        note: '第二次补充',
        wishlist: true,
      });
    expect(second.status).toBe(200);
    expect(second.body.wishlist).toBe(true);
    expect(second.body.note).toContain('第一次备注');
    expect(second.body.note).toContain('第二次补充');

    const mine = (
      await request(app).get('/api/agent/shops').set(auth(agentToken))
    ).body.mine as Array<{ name: string; city: string }>;
    expect(mine.filter((s) => s.name === '泰式河粉' && s.city === '曼谷')).toHaveLength(
      1
    );

    const favs = getDb()
      .prepare(`SELECT id FROM favorites WHERE user_id = ?`)
      .all(user.id);
    expect(favs).toHaveLength(1);
  });

  test('S5-API-07：不同城同名是两家店', async () => {
    const { app, agentToken } = seedUser('city');
    expect(
      (
        await request(app)
          .post('/api/agent/shops')
          .set(auth(agentToken))
          .send({ name: '泰式河粉', city: '曼谷' })
      ).status
    ).toBe(201);
    expect(
      (
        await request(app)
          .post('/api/agent/shops')
          .set(auth(agentToken))
          .send({ name: '泰式河粉', city: '清迈' })
      ).status
    ).toBe(201);
    const mine = (
      await request(app).get('/api/agent/shops').set(auth(agentToken))
    ).body.mine as Array<{ name: string; city: string }>;
    expect(mine.filter((s) => s.name === '泰式河粉')).toHaveLength(2);
  });

  test('S5-API-05/08：同 poiKey 合并；不同 poiKey 不误合并', async () => {
    const { app, agentToken } = seedUser('poi');
    const first = await request(app)
      .post('/api/agent/shops')
      .set(auth(agentToken))
      .send({
        name: '河粉店',
        city: '曼谷',
        poiKey: 'amap_K1',
        note: '钥匙A',
      });
    expect(first.status).toBe(201);
    expect(first.body.status).toBe('confirmed');

    const sameKey = await request(app)
      .post('/api/agent/shops')
      .set(auth(agentToken))
      .send({
        name: '另一店名也算同一 POI',
        city: '清迈',
        poiKey: 'amap_K1',
        note: '仍是A',
      });
    expect(sameKey.status).toBe(200);
    expect(String(sameKey.body.note)).toContain('钥匙A');
    expect(String(sameKey.body.note)).toContain('仍是A');

    const otherKey = await request(app)
      .post('/api/agent/shops')
      .set(auth(agentToken))
      .send({
        name: '河粉店',
        city: '曼谷',
        poiKey: 'amap_K2',
      });
    expect(otherKey.status).toBe(201);

    const mine = (
      await request(app).get('/api/agent/shops').set(auth(agentToken))
    ).body.mine as Array<{ poiKey: string }>;
    const keys = mine.map((s) => s.poiKey);
    expect(keys).toEqual(expect.arrayContaining(['amap_K1', 'amap_K2']));
  });

  test('H3：仅有未校验坐标仍 pending；合法 poiKey 才 confirmed', async () => {
    const { app, agentToken } = seedUser('h3');
    const coordsOnly = await request(app)
      .post('/api/agent/shops')
      .set(auth(agentToken))
      .send({
        name: '天桥下河粉',
        city: '曼谷',
        lat: 13.7563,
        lng: 100.5018,
      });
    expect(coordsOnly.status).toBe(201);
    expect(coordsOnly.body.status).toBe('pending');
    expect(coordsOnly.body.lat).toBeCloseTo(13.7563);
    expect(shopRowByName('天桥下河粉')?.source_shop_id).toBeNull();

    const withPoi = await request(app)
      .post('/api/agent/shops')
      .set(auth(agentToken))
      .send({
        name: '有钥匙的店',
        city: '曼谷',
        poiKey: 'amap_B000A8URM1',
      });
    expect(withPoi.status).toBe(201);
    expect(withPoi.body.status).toBe('confirmed');
    expect(withPoi.body.poiKey).toBe('amap_B000A8URM1');
    expect(shopRowByName('有钥匙的店')?.source_shop_id).toBeNull();
    expect(shopRowByName('有钥匙的店')?.amap_poi_id).toBe('amap_B000A8URM1');
  });

  test('H2 / S5-API-13：展示名保留原文，去重只用 trim', async () => {
    const { app, agentToken } = seedUser('h2');
    const posted = await request(app)
      .post('/api/agent/shops')
      .set(auth(agentToken))
      .send({ name: 'Thai 河粉 Shop', city: 'Bangkok' });
    expect(posted.status).toBe(201);
    expect(posted.body.name).toBe('Thai 河粉 Shop');
    expect(shopRowByName('Thai 河粉 Shop')?.raw_name).toBe('Thai 河粉 Shop');
  });

  test('H7 / S5-OUT-01：数组 body → 400，不落库', async () => {
    const { app, agentToken, user } = seedUser('h7');
    const asArray = await request(app)
      .post('/api/agent/shops')
      .set(auth(agentToken))
      .send([{ name: '店A', city: '曼谷' }, { name: '店B', city: '曼谷' }]);
    expect(asArray.status).toBe(400);

    const batch = await request(app)
      .post('/api/agent/shops')
      .set(auth(agentToken))
      .send({
        shops: Array.from({ length: 21 }, (_, i) => ({
          name: `批量店${i}`,
          city: '曼谷',
        })),
      });
    expect(batch.status).toBe(400);

    const count = getDb()
      .prepare(`SELECT COUNT(*) AS n FROM favorites WHERE user_id = ?`)
      .get(user.id) as { n: number };
    expect(count.n).toBe(0);
  });

  test('S5-VAL：缺 name / 空白 / 超长 → 400', async () => {
    const { app, agentToken } = seedUser('val');
    expect(
      (
        await request(app)
          .post('/api/agent/shops')
          .set(auth(agentToken))
          .send({ city: '曼谷' })
      ).status
    ).toBe(400);
    expect(
      (
        await request(app)
          .post('/api/agent/shops')
          .set(auth(agentToken))
          .send({ name: '   ', city: '曼谷' })
      ).status
    ).toBe(400);
    expect(
      (
        await request(app)
          .post('/api/agent/shops')
          .set(auth(agentToken))
          .send({ name: '啊'.repeat(81), city: '曼谷' })
      ).status
    ).toBe(400);
    expect(
      (
        await request(app)
          .post('/api/agent/shops')
          .set(auth(agentToken))
          .send({ name: '合法店', city: '曼谷', note: '备'.repeat(201) })
      ).status
    ).toBe(400);

    const okName = await request(app)
      .post('/api/agent/shops')
      .set(auth(agentToken))
      .send({ name: '啊'.repeat(80), city: '曼谷', note: '备'.repeat(200) });
    expect(okName.status).toBe(201);
  });

  test('S5-NEG-05：body 里的 userId 不能写到别人名下', async () => {
    const a = seedUser('owner');
    const b = seedUser('other');
    const posted = await request(a.app)
      .post('/api/agent/shops')
      .set(auth(a.agentToken))
      .send({
        name: '只属于A',
        city: '上海',
        userId: b.user.id,
        user_id: b.user.id,
      });
    expect(posted.status).toBe(201);

    const aMine = (
      await request(a.app).get('/api/agent/shops').set(auth(a.agentToken))
    ).body.mine as Array<{ name: string }>;
    const bMine = (
      await request(b.app).get('/api/agent/shops').set(auth(b.agentToken))
    ).body.mine as Array<{ name: string }>;
    expect(aMine.some((s) => s.name === '只属于A')).toBe(true);
    expect(bMine.some((s) => s.name === '只属于A')).toBe(false);
  });

  test('S5-NEG-07 / S5-OUT-02/03：Agent Token 不能冒充登录写接口；新店只出现在 mine', async () => {
    const { app, agentToken } = seedUser('iso');
    const checkin = await request(app)
      .post('/api/me/checkins')
      .set(auth(agentToken))
      .send({ name: '不该走记美食', lat: 1, lng: 2 });
    expect(checkin.status).toBe(401);

    const circle = await request(app)
      .post('/api/circles')
      .set(auth(agentToken))
      .send({ name: '不该建圈' });
    expect(circle.status).toBe(401);

    const posted = await request(app)
      .post('/api/agent/shops')
      .set(auth(agentToken))
      .send({ name: '本人店', city: '杭州' });
    expect(posted.status).toBe(201);
    const listed = await request(app)
      .get('/api/agent/shops')
      .set(auth(agentToken));
    expect(
      (listed.body.mine as Array<{ name: string }>).some((s) => s.name === '本人店')
    ).toBe(true);
    expect(
      (listed.body.friendsShared as Array<{ name?: string }>).some(
        (s) => s.name === '本人店'
      )
    ).toBe(false);
  });

  test('S5-RL-01：每分钟超过 30 次 → 429（打桩分钟闸）', async () => {
    const { app, agentToken, user } = seedUser('rl1');
    for (let i = 0; i < 30; i++) {
      expect(agentShopWriteMinuteLimiter.tryConsume(user.id)).toBe(true);
    }
    const res = await request(app)
      .post('/api/agent/shops')
      .set(auth(agentToken))
      .send({ name: '第31家', city: '深圳' });
    expect(res.status).toBe(429);
    expect(String(res.body.error)).toMatch(/频繁/);
  });

  test('S5-RL-02：限流按用户隔离', async () => {
    const a = seedUser('rlA');
    const b = seedUser('rlB');
    for (let i = 0; i < 30; i++) {
      agentShopWriteMinuteLimiter.tryConsume(a.user.id);
    }
    const blocked = await request(a.app)
      .post('/api/agent/shops')
      .set(auth(a.agentToken))
      .send({ name: 'A超限', city: '深圳' });
    expect(blocked.status).toBe(429);

    const ok = await request(b.app)
      .post('/api/agent/shops')
      .set(auth(b.agentToken))
      .send({ name: 'B仍可写', city: '深圳' });
    expect(ok.status).toBe(201);
  });

  test('S5-RL-03 P2：日限额 200 可打桩 429', async () => {
    const { app, agentToken, user } = seedUser('rlday');
    for (let i = 0; i < 200; i++) {
      expect(agentShopWriteDayLimiter.tryConsume(user.id)).toBe(true);
    }
    const res = await request(app)
      .post('/api/agent/shops')
      .set(auth(agentToken))
      .send({ name: '第201家', city: '深圳' });
    expect(res.status).toBe(429);
  });

  test('S5-RL-01 辅助：tryConsumeAgentShopWrite 第 31 次失败', () => {
    const key = 'quota-user';
    for (let i = 0; i < 30; i++) {
      expect(tryConsumeAgentShopWrite(key)).toBe(true);
    }
    expect(tryConsumeAgentShopWrite(key)).toBe(false);
  });

  test('S5-NEG-08：写入 429 后 GET 仍可用', async () => {
    const { app, agentToken, user } = seedUser('rlget');
    for (let i = 0; i < 30; i++) {
      agentShopWriteMinuteLimiter.tryConsume(user.id);
    }
    expect(
      (
        await request(app)
          .post('/api/agent/shops')
          .set(auth(agentToken))
          .send({ name: '超限', city: '深圳' })
      ).status
    ).toBe(429);
    expect(
      (await request(app).get('/api/agent/shops').set(auth(agentToken))).status
    ).toBe(200);
  });

  test('S5-SEC-05：note 含脚本按原文入库，JSON 回读不执行', async () => {
    const { app, agentToken } = seedUser('xss');
    const note = '<script>alert(1)</script>';
    const posted = await request(app)
      .post('/api/agent/shops')
      .set(auth(agentToken))
      .send({ name: '脚本店', city: '成都', note });
    expect(posted.status).toBe(201);
    expect(posted.body.note).toBe(note);
  });

  test('S5-API-12：POST 响应字段集合与 GET mine 单项一致', async () => {
    const { app, agentToken } = seedUser('shape');
    const posted = await request(app)
      .post('/api/agent/shops')
      .set(auth(agentToken))
      .send({ name: '对齐字段', city: '南京' });
    const listed = await request(app)
      .get('/api/agent/shops')
      .set(auth(agentToken));
    const mineItem = (listed.body.mine as Array<Record<string, unknown>>)[0];
    expect(Object.keys(posted.body).sort()).toEqual(Object.keys(mineItem).sort());
    expect(posted.body.status).toBe(mineItem.status);
  });

  test('S5-DOC-01：skill 从只读改为可写本人店', () => {
    const skill = fs.readFileSync(
      path.resolve(__dirname, '../../skills/feimaocat-cloud/SKILL.md'),
      'utf8'
    );
    expect(skill).toMatch(/POST \$FEIMAOCAT_API_BASE\/api\/agent\/shops/);
    expect(skill).toMatch(/写前向用户确认店名与是否心心念念/);
    expect(skill).toMatch(/origin: agent/);
    expect(skill).not.toMatch(/^- 只读；/m);
  });
});
