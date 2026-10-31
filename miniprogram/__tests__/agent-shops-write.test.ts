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
  'sourceShopId',
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
      `SELECT id, source_type, source_shop_id, amap_poi_id, raw_name, city,
              district, address, category, phone, lat, lng, source_url
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
        district: string | null;
        address: string | null;
        category: string | null;
        phone: string | null;
        lat: number | null;
        lng: number | null;
        source_url: string | null;
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
    expect(posted.body.sourceShopId).toBeNull();
    expect(posted.body.address).toBeNull();
    expect(posted.body.category).toBeNull();
    expect(posted.body.phone).toBeNull();
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

  test('E2E-A4 / S5-SEC-02：真实点评数字 id 可存；幻觉 shopId 丢掉；无核验则 pending', async () => {
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
    expect(posted.body.sourceShopId).toBe('1908397290');
    expect(posted.body.poiKey).toBe('1908397290');

    const row = shopRowByName('街角米线');
    expect(row?.raw_name).toBe('街角米线');
    expect(row?.source_shop_id).toBe('1908397290');
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
    expect(skill).toMatch(/PATCH \$FEIMAOCAT_API_BASE\/api\/agent\/shops\/:poiKey/);
    expect(skill).toMatch(/写前确认/);
    expect(skill).toMatch(/`agent` Agent 记下/);
    expect(skill).toMatch(/wishlist 只是加分项/);
    expect(skill).not.toMatch(/用 `wishlist === true` 做「很想去」主候选/);
    expect(skill).not.toMatch(/^- 只读；/m);
  });

  test('新字段：address / category / phone / lat/lng 原样入库，不把 district 当成 address', async () => {
    const { app, agentToken } = seedUser('fields');
    const posted = await request(app)
      .post('/api/agent/shops')
      .set(auth(agentToken))
      .send({
        name: '肥猫面馆',
        city: '深圳',
        district: '南山区',
        address: '科技园路 1 号',
        category: '面馆',
        phone: '0755-12345678',
        note: '汤浓',
        wishlist: true,
        lat: 22.54,
        lng: 113.93,
      });
    expect(posted.status).toBe(201);
    expect(posted.body).toMatchObject({
      name: '肥猫面馆',
      city: '深圳',
      district: '南山区',
      address: '科技园路 1 号',
      category: '面馆',
      phone: '0755-12345678',
      note: '汤浓',
      wishlist: true,
      status: 'pending',
      sourceShopId: null,
    });
    expect(posted.body.lat).toBeCloseTo(22.54);
    expect(posted.body.lng).toBeCloseTo(113.93);
    expect(posted.body.address).not.toBe(posted.body.district);

    const row = shopRowByName('肥猫面馆');
    expect(row?.address).toBe('科技园路 1 号');
    expect(row?.category).toBe('面馆');
    expect(row?.phone).toBe('0755-12345678');
    expect(row?.district).toBe('南山区');
  });

  test('点评链接抽出数字 id；专辑库已有同店则回填坐标并 confirmed', async () => {
    const { app, agentToken } = seedUser('dpfill');
    getDb()
      .prepare(
        `INSERT INTO shops (
           id, source_type, source_shop_id, amap_poi_id, raw_name, adcode,
           category, district, city, address, avg_price, lat, lng,
           source_url, head_img, phone, display_cache_policy
         ) VALUES (
           'imported-shop', 'dianping_album', '1908397290', NULL, '专辑里的店',
           NULL, '川菜', '福田区', '深圳', '福华路 88 号', NULL,
           22.54, 114.06, 'https://m.dianping.com/shop/1908397290',
           NULL, '0755-8888', 'minimal'
         )`
      )
      .run();

    const posted = await request(app)
      .post('/api/agent/shops')
      .set(auth(agentToken))
      .send({
        name: '专辑里的店',
        city: '深圳',
        dianpingUrl: 'https://m.dianping.com/shop/1908397290?from=share',
      });
    expect(posted.status).toBe(201);
    expect(posted.body.sourceShopId).toBe('1908397290');
    expect(posted.body.address).toBe('福华路 88 号');
    expect(posted.body.category).toBe('川菜');
    expect(posted.body.phone).toBe('0755-8888');
    expect(posted.body.status).toBe('confirmed');
    expect(posted.body.lat).toBeCloseTo(22.54);
    expect(posted.body.lng).toBeCloseTo(114.06);
  });

  test('去重合并：空字段用新值补上，已有值不覆盖', async () => {
    const { app, agentToken } = seedUser('merge');
    const first = await request(app)
      .post('/api/agent/shops')
      .set(auth(agentToken))
      .send({
        name: '合并面馆',
        city: '成都',
        address: '春熙路 1 号',
        category: '面馆',
      });
    expect(first.status).toBe(201);
    expect(first.body.phone).toBeNull();

    const second = await request(app)
      .post('/api/agent/shops')
      .set(auth(agentToken))
      .send({
        name: '合并面馆',
        city: '成都',
        address: '不该覆盖的新地址',
        category: '火锅',
        phone: '028-111',
        district: '锦江区',
      });
    expect(second.status).toBe(200);
    expect(second.body.address).toBe('春熙路 1 号');
    expect(second.body.category).toBe('面馆');
    expect(second.body.phone).toBe('028-111');
    expect(second.body.district).toBe('锦江区');
  });

  test('PATCH 只改本人店：更新字段、他人 404、无效 Token 401', async () => {
    const owner = seedUser('patch-owner');
    const other = seedUser('patch-other');

    const created = await request(owner.app)
      .post('/api/agent/shops')
      .set(auth(owner.agentToken))
      .send({ name: '可改的店', city: '杭州', district: '西湖区' });
    expect(created.status).toBe(201);
    const poiKey = created.body.poiKey as string;

    const none = await request(owner.app)
      .patch(`/api/agent/shops/${poiKey}`)
      .send({ address: '不该写入' });
    expect(none.status).toBe(401);

    const sessionAsAgent = await request(owner.app)
      .patch(`/api/agent/shops/${poiKey}`)
      .set('Authorization', `Bearer ${owner.sessionToken}`)
      .send({ address: '不该写入' });
    expect(sessionAsAgent.status).toBe(401);

    const stolen = await request(other.app)
      .patch(`/api/agent/shops/${poiKey}`)
      .set(auth(other.agentToken))
      .send({ address: '偷改' });
    expect(stolen.status).toBe(404);

    const missing = await request(owner.app)
      .patch('/api/agent/shops/not-a-real-shop')
      .set(auth(owner.agentToken))
      .send({ address: '不存在' });
    expect(missing.status).toBe(404);

    const patched = await request(owner.app)
      .patch(`/api/agent/shops/${encodeURIComponent(poiKey)}`)
      .set(auth(owner.agentToken))
      .send({
        address: '湖滨路 2 号',
        category: '杭帮菜',
        phone: '0571-000',
        wishlist: true,
        sourceShopId: '1234567',
      });
    expect(patched.status).toBe(200);
    expect(patched.body).toMatchObject({
      name: '可改的店',
      city: '杭州',
      district: '西湖区',
      address: '湖滨路 2 号',
      category: '杭帮菜',
      phone: '0571-000',
      wishlist: true,
      sourceShopId: '1234567',
      origin: 'agent',
      status: 'pending',
    });
    for (const key of MINE_KEYS) {
      expect(patched.body).toHaveProperty(key);
    }

    const listed = await request(owner.app)
      .get('/api/agent/shops')
      .set(auth(owner.agentToken));
    const hit = (listed.body.mine as Array<Record<string, unknown>>).find(
      (s) => s.name === '可改的店'
    );
    expect(hit).toMatchObject({
      address: '湖滨路 2 号',
      category: '杭帮菜',
      phone: '0571-000',
      wishlist: true,
      sourceShopId: '1234567',
    });
  });
});
