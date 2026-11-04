import { resetDbForTests, closeDb, getDb } from '../server/db.js';
import { createSessionForOpenId } from '../server/auth.js';
import {
  clearPreviewStore,
  importRateLimiter,
  parseImport,
  saveImportSelection,
} from '../server/services/import.js';
import * as circles from '../server/services/circles.js';
import * as network from '../server/services/network.js';
import { v4 as uuidv4 } from 'uuid';

/**
 * 测试三人圈子的互相可见性
 * 场景：A 创建圈子，B 和 C 分别加入，三人应该互相看见
 */
describe('圈子成员互相可见', () => {
  beforeEach(() => {
    resetDbForTests();
    clearPreviewStore();
    importRateLimiter.reset();
  });

  afterAll(() => {
    closeDb();
  });

  test('三人加入同一圈子后互相可见', async () => {
    const userA = createSessionForOpenId('user_a');
    const userB = createSessionForOpenId('user_b');
    const userC = createSessionForOpenId('user_c');

    const circle = await circles.createCircle(userA.user.id, '我的美食网');
    await circles.joinCircle(userB.user.id, circle.id, circle.inviteToken);
    await circles.joinCircle(userC.user.id, circle.id, circle.inviteToken);

    const aFriends = await network.listFoodFriends(userA.user.id);
    const bFriends = await network.listFoodFriends(userB.user.id);
    const cFriends = await network.listFoodFriends(userC.user.id);

    const aFriendIds = aFriends.friends.map((f) => f.id).sort();
    const bFriendIds = bFriends.friends.map((f) => f.id).sort();
    const cFriendIds = cFriends.friends.map((f) => f.id).sort();

    expect(aFriendIds).toEqual([userB.user.id, userC.user.id].sort());
    expect(bFriendIds).toEqual([userA.user.id, userC.user.id].sort());
    expect(cFriendIds).toEqual([userA.user.id, userB.user.id].sort());
  });

  test('三人都能看到彼此共享的店铺', async () => {
    const userA = createSessionForOpenId('user_a_shops');
    const userB = createSessionForOpenId('user_b_shops');
    const userC = createSessionForOpenId('user_c_shops');

    const circle = await circles.createCircle(userA.user.id, '美食圈');
    await circles.joinCircle(userB.user.id, circle.id, circle.inviteToken);
    await circles.joinCircle(userC.user.id, circle.id, circle.inviteToken);

    const shopIdA = uuidv4();
    const shopIdB = uuidv4();
    const shopIdC = uuidv4();
    const db = getDb();

    db.prepare(
      `INSERT INTO shops (id, source_type, source_shop_id, amap_poi_id, raw_name,
       adcode, category, district, city, address, avg_price, lat, lng,
       source_url, head_img, phone, display_cache_policy)
       VALUES (?, 'locate', NULL, NULL, ?, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'minimal')`
    ).run(shopIdA, 'A的店');

    db.prepare(
      `INSERT INTO shops (id, source_type, source_shop_id, amap_poi_id, raw_name,
       adcode, category, district, city, address, avg_price, lat, lng,
       source_url, head_img, phone, display_cache_policy)
       VALUES (?, 'locate', NULL, NULL, ?, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'minimal')`
    ).run(shopIdB, 'B的店');

    db.prepare(
      `INSERT INTO shops (id, source_type, source_shop_id, amap_poi_id, raw_name,
       adcode, category, district, city, address, avg_price, lat, lng,
       source_url, head_img, phone, display_cache_policy)
       VALUES (?, 'locate', NULL, NULL, ?, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'minimal')`
    ).run(shopIdC, 'C的店');

    db.prepare(
      `INSERT INTO favorites (id, user_id, shop_id, note, visibility, created_at)
       VALUES (?, ?, ?, NULL, 'circles', datetime('now'))`
    ).run(uuidv4(), userA.user.id, shopIdA);

    db.prepare(
      `INSERT INTO favorites (id, user_id, shop_id, note, visibility, created_at)
       VALUES (?, ?, ?, NULL, 'circles', datetime('now'))`
    ).run(uuidv4(), userB.user.id, shopIdB);

    db.prepare(
      `INSERT INTO favorites (id, user_id, shop_id, note, visibility, created_at)
       VALUES (?, ?, ?, NULL, 'circles', datetime('now'))`
    ).run(uuidv4(), userC.user.id, shopIdC);

    const aShops = circles.listCircleShops(userA.user.id, circle.id);
    const bShops = circles.listCircleShops(userB.user.id, circle.id);
    const cShops = circles.listCircleShops(userC.user.id, circle.id);

    expect(aShops.items.length).toBe(3);
    expect(bShops.items.length).toBe(3);
    expect(cShops.items.length).toBe(3);

    const aShopNames = aShops.items.map((s) => s.name).sort();
    const bShopNames = bShops.items.map((s) => s.name).sort();
    const cShopNames = cShops.items.map((s) => s.name).sort();

    expect(aShopNames).toEqual(['A的店', 'B的店', 'C的店']);
    expect(bShopNames).toEqual(['A的店', 'B的店', 'C的店']);
    expect(cShopNames).toEqual(['A的店', 'B的店', 'C的店']);
  });

  test('B 转发 A 的邀请链接，C 加入的是 A 的圈子', async () => {
    const userA = createSessionForOpenId('user_a_forward');
    const userB = createSessionForOpenId('user_b_forward');
    const userC = createSessionForOpenId('user_c_forward');

    const circleA = await circles.createCircle(userA.user.id, 'A的美食网');
    await circles.joinCircle(userB.user.id, circleA.id, circleA.inviteToken);

    await circles.joinCircle(userC.user.id, circleA.id, circleA.inviteToken);

    const members = circles.listCircleMembers(userA.user.id, circleA.id) as Array<{
      id: string;
    }>;
    const memberIds = members.map((m) => m.id).sort();

    expect(memberIds).toEqual(
      [userA.user.id, userB.user.id, userC.user.id].sort()
    );

    const aFriends = await network.listFoodFriends(userA.user.id);
    expect(aFriends.friends.map((f) => f.id).sort()).toEqual(
      [userB.user.id, userC.user.id].sort()
    );
  });
});

/**
 * 测试图片显示规则
 */
describe('店铺图片显示规则', () => {
  beforeEach(() => {
    resetDbForTests();
    clearPreviewStore();
    importRateLimiter.reset();
  });

  afterAll(() => {
    closeDb();
  });

  test('列表和详情页只使用店铺自己的 head_img，不使用其他记录的图片', async () => {
    const userA = createSessionForOpenId('user_img_a');
    const userB = createSessionForOpenId('user_img_b');

    const circle = await circles.createCircle(userA.user.id, '图片测试圈');
    await circles.joinCircle(userB.user.id, circle.id, circle.inviteToken);

    const shopId = uuidv4();
    const db = getDb();

    db.prepare(
      `INSERT INTO shops (id, source_type, source_shop_id, amap_poi_id, raw_name,
       adcode, category, district, city, address, avg_price, lat, lng,
       source_url, head_img, phone, display_cache_policy)
       VALUES (?, 'dianping_album', '12345', 'amap_123', '测试餐厅',
       NULL, '火锅', '朝阳区', '北京', '测试地址', '100', 39.9, 116.4,
       NULL, '/images/shop_correct.jpg', NULL, 'minimal')`
    ).run(shopId);

    db.prepare(
      `INSERT INTO favorites (id, user_id, shop_id, note, visibility, created_at, photo_url)
       VALUES (?, ?, ?, '很好吃', 'circles', datetime('now'), '/images/user_wrong.jpg')`
    ).run(uuidv4(), userA.user.id, shopId);

    db.prepare(
      `INSERT INTO favorites (id, user_id, shop_id, note, visibility, created_at, photo_url)
       VALUES (?, ?, ?, '推荐', 'circles', datetime('now'), '/images/another_wrong.jpg')`
    ).run(uuidv4(), userB.user.id, shopId);

    const myShops = await network.listMyShops(userA.user.id);
    const shopItem = myShops.items.find((s) => s.shopId === shopId);

    expect(shopItem).toBeDefined();
    expect(shopItem!.headImg).toBe('/images/shop_correct.jpg');
    expect(shopItem!.headImg).not.toContain('user_wrong');
    expect(shopItem!.headImg).not.toContain('another_wrong');
  });

  test('没有店铺图片时使用品类占位图', async () => {
    const user = createSessionForOpenId('user_placeholder');
    const shopId = uuidv4();
    const db = getDb();

    db.prepare(
      `INSERT INTO shops (id, source_type, source_shop_id, amap_poi_id, raw_name,
       adcode, category, district, city, address, avg_price, lat, lng,
       source_url, head_img, phone, display_cache_policy)
       VALUES (?, 'locate', NULL, NULL, '无图餐厅',
       NULL, '日料', '海淀区', '北京', '测试地址', NULL, NULL, NULL,
       NULL, NULL, NULL, 'minimal')`
    ).run(shopId);

    db.prepare(
      `INSERT INTO favorites (id, user_id, shop_id, note, visibility, created_at)
       VALUES (?, ?, ?, NULL, 'circles', datetime('now'))`
    ).run(uuidv4(), user.user.id, shopId);

    const myShops = await network.listMyShops(user.user.id);
    const shopItem = myShops.items.find((s) => s.shopId === shopId);

    expect(shopItem).toBeDefined();
    expect(shopItem!.headImg).toBeNull();
  });
});

/**
 * 测试 Agent 来源标签
 */
describe('Agent 来源标签', () => {
  beforeEach(() => {
    resetDbForTests();
    clearPreviewStore();
    importRateLimiter.reset();
  });

  afterAll(() => {
    closeDb();
  });

  test('Agent 记下的店显示「AI 帮你记下」', async () => {
    const user = createSessionForOpenId('user_agent');
    const shopId = uuidv4();
    const db = getDb();

    db.prepare(
      `INSERT INTO shops (id, source_type, source_shop_id, amap_poi_id, raw_name,
       adcode, category, district, city, address, avg_price, lat, lng,
       source_url, head_img, phone, display_cache_policy)
       VALUES (?, 'agent', NULL, NULL, 'Agent推荐餐厅',
       NULL, '川菜', '朝阳区', '北京', '测试地址', '80', NULL, NULL,
       NULL, NULL, NULL, 'minimal')`
    ).run(shopId);

    db.prepare(
      `INSERT INTO favorites (id, user_id, shop_id, note, visibility, created_at)
       VALUES (?, ?, ?, 'Agent记下的', 'circles', datetime('now'))`
    ).run(uuidv4(), user.user.id, shopId);

    const myShops = await network.listMyShops(user.user.id);
    const shopItem = myShops.items.find((s) => s.shopId === shopId);

    expect(shopItem).toBeDefined();
    expect(shopItem!.origin).toBe('agent');
    expect(shopItem!.sourceTag).toBe('AI 帮你记下');
  });

  test('有推荐人时显示「来自<昵称>」而不是原始来源', async () => {
    const userA = createSessionForOpenId('user_recommender_a');
    const userB = createSessionForOpenId('user_recommender_b');

    getDb()
      .prepare(`UPDATE users SET nickname = ? WHERE id = ?`)
      .run('小王', userA.user.id);

    const circle = await circles.createCircle(userA.user.id, '推荐测试圈');
    await circles.joinCircle(userB.user.id, circle.id, circle.inviteToken);

    const shopId = uuidv4();
    const db = getDb();

    db.prepare(
      `INSERT INTO shops (id, source_type, source_shop_id, amap_poi_id, raw_name,
       adcode, category, district, city, address, avg_price, lat, lng,
       source_url, head_img, phone, display_cache_policy)
       VALUES (?, 'agent', NULL, NULL, '朋友推荐的店',
       NULL, '西餐', '海淀区', '北京', '测试地址', '120', NULL, NULL,
       NULL, NULL, NULL, 'minimal')`
    ).run(shopId);

    db.prepare(
      `INSERT INTO favorites (id, user_id, shop_id, note, visibility, created_at)
       VALUES (?, ?, ?, 'A推荐', 'circles', datetime('now'))`
    ).run(uuidv4(), userA.user.id, shopId);

    db.prepare(
      `INSERT INTO favorites (id, user_id, shop_id, note, visibility, created_at, from_user_id)
       VALUES (?, ?, ?, 'B收藏', 'circles', datetime('now'), ?)`
    ).run(uuidv4(), userB.user.id, shopId, userA.user.id);

    const myShops = await network.listMyShops(userB.user.id);
    const shopItem = myShops.items.find((s) => s.shopId === shopId);

    expect(shopItem).toBeDefined();
    expect(shopItem!.sourceTag).toContain('小王');
    expect(shopItem!.sourceTag).not.toBe('AI 帮你记下');
  });
});

/**
 * 测试备注显示
 */
describe('备注显示', () => {
  beforeEach(() => {
    resetDbForTests();
    clearPreviewStore();
    importRateLimiter.reset();
  });

  afterAll(() => {
    closeDb();
  });

  test('列表中显示用户自己的备注', async () => {
    const user = createSessionForOpenId('user_note');
    const shopId = uuidv4();
    const db = getDb();

    db.prepare(
      `INSERT INTO shops (id, source_type, source_shop_id, amap_poi_id, raw_name,
       adcode, category, district, city, address, avg_price, lat, lng,
       source_url, head_img, phone, display_cache_policy)
       VALUES (?, 'locate', NULL, NULL, '有备注的店',
       NULL, '咖啡', '朝阳区', '北京', '测试地址', NULL, NULL, NULL,
       NULL, NULL, NULL, 'minimal')`
    ).run(shopId);

    db.prepare(
      `INSERT INTO favorites (id, user_id, shop_id, note, visibility, created_at)
       VALUES (?, ?, ?, '这家店很安静，适合工作', 'circles', datetime('now'))`
    ).run(uuidv4(), user.user.id, shopId);

    const myShops = await network.listMyShops(user.user.id);
    const shopItem = myShops.items.find((s) => s.shopId === shopId);

    expect(shopItem).toBeDefined();
    expect(shopItem!.note).toBe('这家店很安静，适合工作');
  });
});
