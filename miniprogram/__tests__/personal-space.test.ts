import { v4 as uuidv4 } from 'uuid';
import { resetDbForTests, closeDb, getDb } from '../server/db.js';
import { createSessionForOpenId } from '../server/auth.js';
import * as circles from '../server/services/circles.js';
import * as network from '../server/services/network.js';

describe('个人空间「我的美食网」安全', () => {
  beforeEach(() => {
    resetDbForTests();
  });

  afterAll(() => {
    closeDb();
  });

  // CM-6: 不能加入他人的个人空间
  test('CM-6: 尝试加入他人的个人空间返回 403', async () => {
    const userA = createSessionForOpenId('user_a_personal');
    const userB = createSessionForOpenId('user_b_try_join');

    const personalSpace = await network.ensurePersonalNetwork(userA.user.id);
    expect(personalSpace).not.toBeNull();

    await expect(
      circles.joinCircle(
        userB.user.id,
        personalSpace!.id,
        personalSpace!.inviteToken
      )
    ).rejects.toThrow('不能加入他人的个人空间');
  });

  // CM-5: 个人空间的 reset-invite 返回 403
  test('CM-5: 个人空间不支持重置邀请链接', async () => {
    const userA = createSessionForOpenId('user_a_reset');

    const personalSpace = await network.ensurePersonalNetwork(userA.user.id);
    expect(personalSpace).not.toBeNull();

    expect(() => {
      circles.resetInviteToken(userA.user.id, personalSpace!.id);
    }).toThrow('个人空间不支持邀请链接');
  });

  // CM-5: listFoodFriends 不返回个人空间的 invite token
  test('CM-5: listFoodFriends 不返回个人空间邀请令牌', async () => {
    const userA = createSessionForOpenId('user_a_list_friends');

    await network.ensurePersonalNetwork(userA.user.id);
    const friendsData = await network.listFoodFriends(userA.user.id);

    expect(friendsData.inviteToken).toBe('');
    expect(friendsData.tokenExpiresAt).toBe('');
  });

  // CM-5: listMyCircles 不返回个人空间的 invite token（即使是圈主）
  test('CM-5: listMyCircles 不返回个人空间邀请令牌', async () => {
    const userA = createSessionForOpenId('user_a_list_circles');

    await network.ensurePersonalNetwork(userA.user.id);
    const myCircles = circles.listMyCircles(userA.user.id);

    const personalSpace = myCircles.find((c: any) => c.name === '我的美食网');
    expect(personalSpace).toBeDefined();
    expect(personalSpace).not.toHaveProperty('invite_token');
    expect(personalSpace).not.toHaveProperty('token_expires_at');
  });

  // 验证个人空间被正确标记
  test('个人空间自动标记 is_personal', async () => {
    const userA = createSessionForOpenId('user_a_marked');

    const personalSpace = await network.ensurePersonalNetwork(userA.user.id);
    expect(personalSpace).not.toBeNull();

    const db = getDb();
    const circle = db
      .prepare('SELECT is_personal FROM circles WHERE id = ?')
      .get(personalSpace!.id) as { is_personal: number | null };

    expect(circle.is_personal).toBe(1);
  });

  // 普通圈子不受影响
  test('普通圈子仍然可以正常加入和重置邀请', async () => {
    const userA = createSessionForOpenId('user_a_normal_circle');
    const userB = createSessionForOpenId('user_b_join_normal');

    const normalCircle = await circles.createCircle(userA.user.id, '正常圈子');

    await circles.joinCircle(
      userB.user.id,
      normalCircle.id,
      normalCircle.inviteToken
    );

    const members = circles.listCircleMembers(userA.user.id, normalCircle.id);
    expect(members.length).toBe(2);

    const newToken = circles.resetInviteToken(userA.user.id, normalCircle.id);
    expect(newToken.inviteToken).toBeDefined();
    expect(newToken.inviteToken).not.toBe(normalCircle.inviteToken);
  });

  // 迁移测试：只有圈主的「我的美食网」才标记为个人空间
  test('迁移回填：只标记仅有圈主的「我的美食网」', async () => {
    const userA = createSessionForOpenId('user_a_solo_network');

    // 模拟旧数据：手动创建「我的美食网」但不标记 is_personal
    const db = getDb();
    const circleId = '12345678-1234-1234-1234-123456789abc';
    db.prepare(
      `INSERT INTO circles (id, name, owner_id, invite_token, token_expires_at, member_limit, created_at)
       VALUES (?, '我的美食网', ?, 'token123', datetime('now', '+30 days'), 200, datetime('now'))`
    ).run(circleId, userA.user.id);

    db.prepare(
      `INSERT INTO circle_members (circle_id, user_id, role, joined_at)
       VALUES (?, ?, 'owner', datetime('now'))`
    ).run(circleId, userA.user.id);

    // 触发迁移逻辑（模拟新的回填规则）
    db.exec(`
      UPDATE circles SET is_personal = 1 
      WHERE name = '我的美食网'
        AND owner_id IS NOT NULL
        AND (SELECT COUNT(*) FROM circle_members cm 
             WHERE cm.circle_id = circles.id 
               AND cm.user_id != circles.owner_id) = 0
        AND (SELECT COUNT(*) FROM circles c2 
             WHERE c2.owner_id = circles.owner_id 
               AND c2.created_at < circles.created_at) = 0;
    `);

    const circle = db
      .prepare('SELECT is_personal FROM circles WHERE id = ?')
      .get(circleId) as { is_personal: number | null };

    expect(circle.is_personal).toBe(1);
  });

  // 迁移测试：已有其他成员的「我的美食网」不标记为个人空间
  test('迁移回填：有其他成员的「我的美食网」保持为共享圈', async () => {
    const userA = createSessionForOpenId('user_a_shared_network');
    const userB = createSessionForOpenId('user_b_in_a_network');
    const userC = createSessionForOpenId('user_c_in_a_network');

    const db = getDb();
    const circleId = '87654321-4321-4321-4321-cba987654321';

    // 模拟旧数据：A 的「我的美食网」已经被 B、C 加入
    db.prepare(
      `INSERT INTO circles (id, name, owner_id, invite_token, token_expires_at, member_limit, created_at)
       VALUES (?, '我的美食网', ?, 'oldtoken', datetime('now', '+30 days'), 200, datetime('now'))`
    ).run(circleId, userA.user.id);

    db.prepare(
      `INSERT INTO circle_members (circle_id, user_id, role, joined_at)
       VALUES (?, ?, 'owner', datetime('now'))`
    ).run(circleId, userA.user.id);

    db.prepare(
      `INSERT INTO circle_members (circle_id, user_id, role, joined_at)
       VALUES (?, ?, 'member', datetime('now'))`
    ).run(circleId, userB.user.id);

    db.prepare(
      `INSERT INTO circle_members (circle_id, user_id, role, joined_at)
       VALUES (?, ?, 'member', datetime('now'))`
    ).run(circleId, userC.user.id);

    // 触发迁移逻辑（模拟新的回填规则）
    db.exec(`
      UPDATE circles SET is_personal = 1 
      WHERE name = '我的美食网'
        AND owner_id IS NOT NULL
        AND (SELECT COUNT(*) FROM circle_members cm 
             WHERE cm.circle_id = circles.id 
               AND cm.user_id != circles.owner_id) = 0
        AND (SELECT COUNT(*) FROM circles c2 
             WHERE c2.owner_id = circles.owner_id 
               AND c2.created_at < circles.created_at) = 0;
    `);

    const circle = db
      .prepare('SELECT is_personal FROM circles WHERE id = ?')
      .get(circleId) as { is_personal: number | null };

    // 不应该被标记为个人空间（有其他成员）
    expect(circle.is_personal).toBeNull();

    // 验证 B 和 C 仍然可以访问
    const members = circles.listCircleMembers(userA.user.id, circleId);
    expect(members.length).toBe(3);

    // B 应该仍然能重置邀请（因为这不是个人空间）
    // 等等，B 不是圈主，所以不能重置。但至少不应该因为"个人空间"而被拒绝
    // 让我们验证这个圈子可以被正常使用
    const circleData = db
      .prepare('SELECT * FROM circles WHERE id = ?')
      .get(circleId) as any;
    
    expect(circleData.name).toBe('我的美食网');
    expect(circleData.is_personal).toBeNull();
  });
});
