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
});
