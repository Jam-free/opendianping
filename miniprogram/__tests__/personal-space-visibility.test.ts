import { v4 as uuidv4 } from 'uuid';
import { resetDbForTests, closeDb, getDb } from '../server/db.js';
import { createSessionForOpenId } from '../server/auth.js';
import * as circles from '../server/services/circles.js';
import * as network from '../server/services/network.js';

/**
 * 测试个人空间可见性规则：
 * 只有圈主能看到个人空间的店铺
 * 其他成员（即使在 circle_members 中）也不能看到
 */
describe('个人空间可见性过滤', () => {
  beforeEach(() => {
    resetDbForTests();
  });

  afterAll(() => {
    closeDb();
  });

  test('A 不能通过 D 的个人空间看到 D 的店铺', async () => {
    const userA = createSessionForOpenId('user_a_viewer');
    const userD = createSessionForOpenId('user_d_owner');

    // D 创建个人空间
    const dPersonalSpace = await network.ensurePersonalNetwork(userD.user.id);
    expect(dPersonalSpace).not.toBeNull();

    // 模拟旧的 heal 机制：A 被添加到 D 的个人空间（数据库残留）
    const db = getDb();
    db.prepare(
      `INSERT INTO circle_members (circle_id, user_id, role, joined_at)
       VALUES (?, ?, 'member', datetime('now'))`
    ).run(dPersonalSpace!.id, userA.user.id);

    // D 添加一家店
    const shop = await network.createCheckin(userD.user.id, {
      name: 'D 的私人餐厅',
      note: 'D 的笔记',
      lat: 39.9,
      lng: 116.4,
    });

    // A 查看好友列表：不应该看到 D
    const aFriends = await network.listFoodFriends(userA.user.id);
    const dInList = aFriends.friends.find((f) => f.id === userD.user.id);
    expect(dInList).toBeUndefined();

    // A 查看共享店铺列表：不应该包含 D 的店
    const aSharedShops = circles.listMemberShopsInSharedCircles(
      userA.user.id,
      userD.user.id
    );
    expect(aSharedShops.items.length).toBe(0);
    expect(aSharedShops.sharedCircleCount).toBe(0);

    // Agent 查询：A 不应该看到 D 的店
    const agentShops = await network.listAgentShops(userA.user.id);
    const dShopInAgent = agentShops.friendsShared.find(
      (s: any) => s.name === 'D 的私人餐厅'
    );
    expect(dShopInAgent).toBeUndefined();
  });

  test('好友数量和店铺数量不包含个人空间', async () => {
    const userA = createSessionForOpenId('user_a_count');
    const userB = createSessionForOpenId('user_b_count');
    const userC = createSessionForOpenId('user_c_count');

    // A、B、C 都创建个人空间
    await network.ensurePersonalNetwork(userA.user.id);
    const bPersonalSpace = await network.ensurePersonalNetwork(userB.user.id);
    const cPersonalSpace = await network.ensurePersonalNetwork(userC.user.id);

    // 模拟旧的 heal 机制：互相添加到个人空间
    const db = getDb();
    db.prepare(
      `INSERT INTO circle_members (circle_id, user_id, role, joined_at)
       VALUES (?, ?, 'member', datetime('now'))`
    ).run(bPersonalSpace!.id, userA.user.id);
    db.prepare(
      `INSERT INTO circle_members (circle_id, user_id, role, joined_at)
       VALUES (?, ?, 'member', datetime('now'))`
    ).run(cPersonalSpace!.id, userA.user.id);

    // B 添加 2 家店
    await network.createCheckin(userB.user.id, {
      name: 'B 的店 1',
      lat: 39.9,
      lng: 116.4,
    });
    await network.createCheckin(userB.user.id, {
      name: 'B 的店 2',
      lat: 39.9,
      lng: 116.4,
    });

    // C 添加 1 家店
    await network.createCheckin(userC.user.id, {
      name: 'C 的店',
      lat: 39.9,
      lng: 116.4,
    });

    // A 查看好友列表
    const aFriends = await network.listFoodFriends(userA.user.id);

    // B 和 C 不应该出现在好友列表中（因为只在个人空间中相连）
    const bInList = aFriends.friends.find((f) => f.id === userB.user.id);
    const cInList = aFriends.friends.find((f) => f.id === userC.user.id);
    expect(bInList).toBeUndefined();
    expect(cInList).toBeUndefined();

    // 总成员数应该只包含 A 自己
    expect(aFriends.memberCount).toBe(1);
  });

  test('创建共享圈后，成员可以互相看到店铺', async () => {
    const userA = createSessionForOpenId('user_a_shared');
    const userB = createSessionForOpenId('user_b_shared');

    // A 创建共享圈
    const sharedCircle = await circles.createCircle(userA.user.id, '美食圈');
    
    // B 加入共享圈
    await circles.joinCircle(userB.user.id, sharedCircle.id, sharedCircle.inviteToken);

    // A 添加一家店
    const shopA = await network.createCheckin(userA.user.id, {
      name: 'A 的餐厅',
      lat: 39.9,
      lng: 116.4,
    });

    // B 添加一家店
    const shopB = await network.createCheckin(userB.user.id, {
      name: 'B 的餐厅',
      lat: 39.9,
      lng: 116.4,
    });

    // A 查看好友列表：应该看到 B
    const aFriends = await network.listFoodFriends(userA.user.id);
    const bInList = aFriends.friends.find((f) => f.id === userB.user.id);
    expect(bInList).toBeDefined();
    expect(bInList?.sharedShopCount).toBe(1); // B 的 1 家店

    // B 查看好友列表：应该看到 A
    const bFriends = await network.listFoodFriends(userB.user.id);
    const aInList = bFriends.friends.find((f) => f.id === userA.user.id);
    expect(aInList).toBeDefined();
    expect(aInList?.sharedShopCount).toBe(1); // A 的 1 家店

    // A 查看 B 的店铺
    const bShopsForA = circles.listMemberShopsInSharedCircles(
      userA.user.id,
      userB.user.id
    );
    expect(bShopsForA.items.length).toBe(1);
    expect(bShopsForA.items[0].name).toBe('B 的餐厅');

    // B 查看 A 的店铺
    const aShopsForB = circles.listMemberShopsInSharedCircles(
      userB.user.id,
      userA.user.id
    );
    expect(aShopsForB.items.length).toBe(1);
    expect(aShopsForB.items[0].name).toBe('A 的餐厅');
  });

  test('个人空间 + 共享圈混合场景：只显示共享圈的内容', async () => {
    const userA = createSessionForOpenId('user_a_mixed');
    const userD = createSessionForOpenId('user_d_mixed');

    // A 和 D 都创建个人空间
    await network.ensurePersonalNetwork(userA.user.id);
    const dPersonalSpace = await network.ensurePersonalNetwork(userD.user.id);

    // 模拟旧的 heal：A 在 D 的个人空间中
    const db = getDb();
    db.prepare(
      `INSERT INTO circle_members (circle_id, user_id, role, joined_at)
       VALUES (?, ?, 'member', datetime('now'))`
    ).run(dPersonalSpace!.id, userA.user.id);

    // D 在个人空间中添加 2 家店
    await network.createCheckin(userD.user.id, {
      name: 'D 的私人店 1',
      lat: 39.9,
      lng: 116.4,
    });
    await network.createCheckin(userD.user.id, {
      name: 'D 的私人店 2',
      lat: 39.9,
      lng: 116.4,
    });

    // A 创建共享圈
    const sharedCircle = await circles.createCircle(userA.user.id, '周末吃啥');
    
    // D 加入共享圈
    await circles.joinCircle(userD.user.id, sharedCircle.id, sharedCircle.inviteToken);

    // D 在共享圈中添加 1 家店
    await network.createCheckin(userD.user.id, {
      name: 'D 的共享店',
      lat: 39.9,
      lng: 116.4,
    });

    // A 查看好友列表
    const aFriends = await network.listFoodFriends(userA.user.id);
    const dInList = aFriends.friends.find((f) => f.id === userD.user.id);
    
    // D 应该出现（因为在共享圈中）
    expect(dInList).toBeDefined();
    // 所有 3 家店都通过共享圈可见（visibility='circles' 默认共享所有圈子）
    // 关键是：A 不能通过 D 的个人空间看到这些店（已被过滤）
    expect(dInList?.sharedShopCount).toBe(3);

    // A 查看 D 的店铺列表（通过共享圈）
    const dShops = circles.listMemberShopsInSharedCircles(
      userA.user.id,
      userD.user.id
    );
    // 3 家店都通过共享圈可见（不是通过个人空间）
    expect(dShops.items.length).toBe(3);
    expect(dShops.sharedCircleCount).toBe(1); // 只有 1 个共享圈（个人空间已过滤）
    
    // 验证：所有店铺都可见（通过共享圈，不是个人空间）
    const allShopNames = dShops.items.map(s => s.name).sort();
    expect(allShopNames).toEqual([
      'D 的共享店',
      'D 的私人店 1',
      'D 的私人店 2'
    ].sort());
  });

  test('圈主可以看到自己个人空间的店铺', async () => {
    const userD = createSessionForOpenId('user_d_own_space');

    // D 创建个人空间
    const dPersonalSpace = await network.ensurePersonalNetwork(userD.user.id);
    
    // D 添加店铺
    await network.createCheckin(userD.user.id, {
      name: 'D 的店铺',
      lat: 39.9,
      lng: 116.4,
    });

    // D 查看自己的店铺列表
    const dShops = await network.listMyShops(userD.user.id);
    
    // 应该能看到自己的店
    expect(dShops.items.length).toBe(1);
    expect(dShops.items[0].name).toBe('D 的店铺');
  });
});
