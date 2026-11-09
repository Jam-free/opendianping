import { describe, expect, test, beforeEach, afterEach } from '@jest/globals';
import { resetDbForTests, closeDb, getDb } from '../server/db.js';
import { restoreDatabaseFromPayload } from '../server/backup.js';
import {
  applyShopImport,
  assertNoDevOpenids,
  assertSafeRestoreTarget,
  maskPhone,
  parseCsvInventory,
  parseSnapshotPayload,
  planShopImport,
  redactBackupPayload,
} from '../server/engine/snapshot-import.js';

const FM_JSON = {
  mine: [
    {
      poiKey: '1028635148',
      name: '一樂·烧肉居酒屋（世界之窗店）',
      category: '日式烧烤 烤肉',
      district: '益田假日',
      city: '深圳',
      address: null,
      lat: 22.537503,
      lng: 113.977038,
      note: null,
      origin: 'imported',
      wishlist: true,
      phone: '13812345678',
      status: 'confirmed',
    },
    {
      poiKey: 'pending-1',
      name: '未确认店',
      origin: 'checkin',
      wishlist: false,
      status: 'pending',
    },
  ],
  friendsShared: [],
};

const CSV = `#,poiKey,name,category,city,district,address,origin,status,wishlist,inDemoDB
1,1028635148,一樂·烧肉居酒屋（世界之窗店）,日式烧烤 烤肉,深圳,益田假日,,imported,confirmed,True,False
`;

describe('快照解析与导入', () => {
  beforeEach(() => {
    resetDbForTests();
  });
  afterEach(() => {
    closeDb();
  });

  test('解析 fm_shops.json 与 CSV', () => {
    const json = parseSnapshotPayload(FM_JSON);
    expect(json.kind).toBe('fm_shops');
    expect(json.shops).toHaveLength(2);
    const csv = parseCsvInventory(CSV);
    expect(csv[0]?.poiKey).toBe('1028635148');
  });

  test('dry-run 不写库，execute 写入店铺和收藏', () => {
    const db = getDb();
    db.prepare(
      `INSERT INTO users (id, openid, created_at) VALUES ('u1', 'o1', datetime('now'))`
    ).run();
    const parsed = parseSnapshotPayload(FM_JSON);
    const plan = planShopImport(db, parsed.shops, { userId: 'u1' });
    expect(plan.shopInserts).toBe(1);
    expect(plan.skipped).toBe(1);
    expect(
      (db.prepare(`SELECT COUNT(*) AS n FROM shops`).get() as { n: number }).n
    ).toBe(0);

    const applied = applyShopImport(db, parsed.shops, { userId: 'u1' });
    expect(applied.shopInserts).toBe(1);
    expect(applied.favoriteInserts).toBe(1);
    const shop = db
      .prepare(`SELECT raw_name, source_shop_id FROM shops`)
      .get() as { raw_name: string; source_shop_id: string };
    expect(shop.source_shop_id).toBe('1028635148');
    const fav = db
      .prepare(`SELECT wishlist FROM favorites WHERE user_id = 'u1'`)
      .get() as { wishlist: number };
    expect(Number(fav.wishlist)).toBe(1);
  });

  test('脱敏与路径安全', () => {
    expect(maskPhone('13812345678')).toBe('138****5678');
    expect(() => assertSafeRestoreTarget('/data/miniprogram.db', 'test')).toThrow(
      /\/data/
    );
    expect(() => assertSafeRestoreTarget('/tmp/x.db', 'production')).toThrow(
      /production/
    );
    expect(() =>
      assertNoDevOpenids([{ id: '1', openid: 'dev_abc' }])
    ).toThrow(/dev_/);
    const redacted = redactBackupPayload({
      schemaVersion: 1,
      exportedAt: 't',
      tables: {
        sessions: [{ token: 'secret' }],
        agent_tokens: [{ token_hash: 'abc', token_prefix: 'fm_' }],
        shops: [{ phone: '13900001111' }],
      },
    });
    expect(redacted.tables.sessions).toBeUndefined();
    expect(redacted.tables.agent_tokens?.[0]?.token_hash).toBe('[redacted]');
    expect(String(redacted.tables.shops?.[0]?.phone)).toContain('****');
  });

  test('备份 JSON 可 roundtrip 进 SQLite', () => {
    const db = getDb();
    db.prepare(
      `INSERT INTO users (id, openid, created_at) VALUES ('u1', 'o1', datetime('now'))`
    ).run();
    db.prepare(
      `INSERT INTO shops (id, source_type, raw_name, display_cache_policy)
       VALUES ('s1', 'text', '店', 'minimal')`
    ).run();
    restoreDatabaseFromPayload(db, {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      tables: {
        users: [
          {
            id: 'u9',
            openid: 'real_openid',
            unionid: null,
            nickname: null,
            avatar: null,
            created_at: 't',
          },
        ],
        shops: [
          {
            id: 's9',
            source_type: 'text',
            source_shop_id: 'poi',
            amap_poi_id: null,
            raw_name: '恢复店',
            adcode: null,
            category: null,
            district: null,
            city: null,
            address: null,
            avg_price: null,
            lat: null,
            lng: null,
            source_url: null,
            head_img: null,
            display_cache_policy: 'minimal',
          },
        ],
        sessions: [],
        import_batches: [],
        circles: [],
        favorites: [],
        circle_members: [],
        circle_shares: [],
        agent_tokens: [],
        shop_comments: [],
      },
    });
    const user = db
      .prepare(`SELECT openid FROM users`)
      .get() as { openid: string };
    expect(user.openid).toBe('real_openid');
    expect(
      (db.prepare(`SELECT COUNT(*) AS n FROM shops`).get() as { n: number }).n
    ).toBe(1);
  });
});
