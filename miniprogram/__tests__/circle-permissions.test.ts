import { resetDbForTests, closeDb, getDb } from '../server/db.js';
import { createSessionForOpenId } from '../server/auth.js';
import {
  clearPreviewStore,
  importRateLimiter,
  parseImport,
  saveImportSelection,
} from '../server/services/import.js';
import * as circles from '../server/services/circles.js';
import { createApp } from '../server/app.js';
import request from 'supertest';

async function seedSharedFavorite(userId: string, visibility: 'private' | 'circles') {
  const preview = await parseImport(userId, {
    text: 'albumid=12498807',
    useFixtures: true,
  });
  return saveImportSelection({
    userId,
    previewId: preview.previewId,
    selectedIndexes: [0],
    visibility,
  });
}

describe('圈内权限', () => {
  beforeEach(() => {
    resetDbForTests();
    clearPreviewStore();
    importRateLimiter.reset();
  });

  afterAll(() => {
    closeDb();
  });

  test('未加入者访问圈店铺返回 403', async () => {
    const owner = createSessionForOpenId('owner_a');
    const stranger = createSessionForOpenId('stranger_b');
    const circle = await circles.createCircle(owner.user.id, '坂田探店');

    expect(() =>
      circles.listCircleShops(stranger.user.id, circle.id)
    ).toThrow(expect.objectContaining({ status: 403 }));

    const app = createApp();
    const res = await request(app)
      .get(`/api/circles/${circle.id}/shops`)
      .set('Authorization', `Bearer ${stranger.token}`);
    expect(res.status).toBe(403);
  });

  test('token 过期或重置后旧链接不能加入', async () => {
    const owner = createSessionForOpenId('owner_c');
    const guest = createSessionForOpenId('guest_d');
    const circle = await circles.createCircle(owner.user.id, '过期测试圈');

    circles.setCircleInviteForTest(
      circle.id,
      'old-token',
      new Date(Date.now() - 1000).toISOString()
    );
    expect(() =>
      circles.joinCircle(guest.user.id, circle.id, 'old-token')
    ).toThrow(expect.objectContaining({ status: 403, message: expect.stringMatching(/过期/) }));

    const reset = circles.resetInviteToken(owner.user.id, circle.id);
    expect(() =>
      circles.joinCircle(guest.user.id, circle.id, 'old-token')
    ).toThrow(expect.objectContaining({ status: 403 }));

    const joined = circles.joinCircle(
      guest.user.id,
      circle.id,
      reset.inviteToken
    );
    expect(joined.alreadyMember).toBe(false);
  });

  test('私密收藏绝不出现在圈视图（含聚合计数）', async () => {
    const owner = createSessionForOpenId('owner_e');
    const member = createSessionForOpenId('member_f');
    const circle = await circles.createCircle(owner.user.id, '隐私圈');
    circles.joinCircle(member.user.id, circle.id, circle.inviteToken);

    await seedSharedFavorite(owner.user.id, 'circles');
    await seedSharedFavorite(member.user.id, 'private');

    const shops = circles.listCircleShops(owner.user.id, circle.id);
    expect(shops.items.length).toBe(1);
    expect(shops.items[0].collectorCount).toBe(1);
    expect(shops.items[0].collectors.map((c) => c.userId)).toEqual([
      owner.user.id,
    ]);

    // 成员把同一店改为共享后，计数变为 2
    const fav = getDb()
      .prepare(`SELECT id FROM favorites WHERE user_id = ?`)
      .get(member.user.id) as { id: string };
    getDb()
      .prepare(`UPDATE favorites SET visibility = 'circles' WHERE id = ?`)
      .run(fav.id);

    const shops2 = circles.listCircleShops(owner.user.id, circle.id);
    expect(shops2.items[0].collectorCount).toBe(2);
  });

  test('成员退出后其共享收藏立即从圈视图消失，本人收藏仍在', async () => {
    const owner = createSessionForOpenId('owner_g');
    const member = createSessionForOpenId('member_h');
    const circle = await circles.createCircle(owner.user.id, '退出测试');
    circles.joinCircle(member.user.id, circle.id, circle.inviteToken);

    await seedSharedFavorite(member.user.id, 'circles');
    expect(circles.listCircleShops(owner.user.id, circle.id).items.length).toBe(
      1
    );

    circles.leaveCircle(member.user.id, circle.id);
    expect(circles.listCircleShops(owner.user.id, circle.id).items.length).toBe(
      0
    );

    const ownFavs = getDb()
      .prepare(`SELECT COUNT(*) AS c FROM favorites WHERE user_id = ?`)
      .get(member.user.id) as { c: number };
    expect(ownFavs.c).toBe(1);
  });

  test('圈主可移除成员；非成员加入需主动带正确 token', async () => {
    const owner = createSessionForOpenId('owner_i');
    const m1 = createSessionForOpenId('member_j');
    const circle = await circles.createCircle(owner.user.id, '管理圈');
    circles.joinCircle(m1.user.id, circle.id, circle.inviteToken);

    circles.removeMember(owner.user.id, circle.id, m1.user.id);
    expect(() =>
      circles.listCircleShops(m1.user.id, circle.id)
    ).toThrow(expect.objectContaining({ status: 403 }));

    expect(() =>
      circles.joinCircle(m1.user.id, circle.id, 'wrong')
    ).toThrow(expect.objectContaining({ status: 403 }));
  });
});
