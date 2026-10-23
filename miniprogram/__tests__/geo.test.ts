import {
  formatDistanceLabel,
  formatRecommendersLine,
  haversineMeters,
} from '../server/utils/geo.js';
import { resetDbForTests, closeDb } from '../server/db.js';
import { createSessionForOpenId } from '../server/auth.js';
import * as circles from '../server/services/circles.js';
import { getDb } from '../server/db.js';

describe('距离与推荐文案', () => {
  beforeEach(() => {
    resetDbForTests();
  });

  afterAll(() => {
    closeDb();
  });

  test('Haversine 与距离文案', () => {
    const m = haversineMeters(22.5431, 114.0579, 22.548, 114.064);
    expect(m).toBeGreaterThan(500);
    expect(m).toBeLessThan(1200);
    expect(formatDistanceLabel(350)).toBe('350 m');
    expect(formatDistanceLabel(1500)).toBe('1.5 km');
    expect(
      formatDistanceLabel(5000, { userCity: '深圳', shopCity: '广州' })
    ).toBe('广州');
  });

  test('推荐人展示文案', () => {
    expect(
      formatRecommendersLine(
        [{ nickname: '小王' }, { nickname: '阿云' }, { nickname: '老李' }],
        3
      )
    ).toBe('小王、阿云等 3 人推荐');
  });

  test('圈内店铺按距离排序，无坐标排在最后', async () => {
    const owner = createSessionForOpenId('geo_owner');
    const circle = await circles.createCircle(owner.user.id, '距离圈');
    const db = getDb();

    const insertShop = (
      name: string,
      lat: number | null,
      lng: number | null
    ) => {
      const shopId = `shop-${name}`;
      db.prepare(
        `INSERT INTO shops (id, source_type, raw_name, lat, lng, display_cache_policy)
         VALUES (?, 'text', ?, ?, ?, 'minimal')`
      ).run(shopId, name, lat, lng);
      db.prepare(
        `INSERT INTO favorites (id, user_id, shop_id, visibility, created_at)
         VALUES (?, ?, ?, 'circles', ?)`
      ).run(`fav-${name}`, owner.user.id, shopId, new Date().toISOString());
    };

    insertShop('近店', 22.5431, 114.0579);
    insertShop('远店', 22.55, 114.07);
    insertShop('无坐标', null, null);

    const res = circles.listCircleShops(owner.user.id, circle.id, {
      lat: 22.5431,
      lng: 114.0579,
    });

    expect(res.items.map((s) => s.name)).toEqual(['近店', '远店', '无坐标']);
    expect(res.withoutCoordsCount).toBe(1);
    expect(res.items[0].distanceLabel).toMatch(/m|km/);
  });
});
