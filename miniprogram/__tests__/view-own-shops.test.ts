import { describe, it, expect, beforeEach, afterAll } from '@jest/globals';
import { createApp } from '../server/app.js';
import { resetDbForTests, closeDb } from '../server/db.js';
import type { Express } from 'express';
import request from 'supertest';

describe('View Own Shops from Private List', () => {
  let app: Express;
  let aliceToken: string;
  let aliceId: string;
  let bobToken: string;
  let bobId: string;

  beforeEach(async () => {
    resetDbForTests();
    app = createApp();

    // Create Alice
    const aliceRes = await request(app)
      .post('/api/auth/login')
      .send({ code: 'test-code-alice' });
    aliceToken = aliceRes.body.token;
    aliceId = aliceRes.body.user.id;

    // Create Bob
    const bobRes = await request(app)
      .post('/api/auth/login')
      .send({ code: 'test-code-bob' });
    bobToken = bobRes.body.token;
    bobId = bobRes.body.user.id;
  });

  afterAll(() => {
    closeDb();
  });

  it('should allow viewing own shop from private list', async () => {
    // Alice creates a private favorite
    const checkinRes = await request(app)
      .post('/api/me/checkins')
      .set('Authorization', `Bearer ${aliceToken}`)
      .send({
        name: 'Alice Private Restaurant',
        lat: 31.23,
        lng: 121.47,
        address: 'Shanghai Private St',
        wishlist: true,
      });

    expect(checkinRes.status).toBe(200);
    const poiKey = checkinRes.body.poiKey;

    // Alice views her own shop using memberId mode
    const detailRes = await request(app)
      .get(`/api/members/${aliceId}/shops/${encodeURIComponent(poiKey)}`)
      .set('Authorization', `Bearer ${aliceToken}`);

    expect(detailRes.status).toBe(200);
    expect(detailRes.body.shop).toBeDefined();
    expect(detailRes.body.shop.name).toBe('Alice Private Restaurant');
    expect(detailRes.body.shop.myFavoriteId).toBeTruthy();
    expect(detailRes.body.shop.wishlist).toBe(true);
  });

  it('should include all favorites regardless of visibility when viewing own shops', async () => {
    // Alice creates a circles-visible favorite
    const checkin1Res = await request(app)
      .post('/api/me/checkins')
      .set('Authorization', `Bearer ${aliceToken}`)
      .send({
        name: 'Alice Circles Restaurant',
        lat: 31.23,
        lng: 121.47,
        address: 'Shanghai Circles St',
        wishlist: false,
      });

    expect(checkin1Res.status).toBe(200);
    const poiKey1 = checkin1Res.body.poiKey;
    const favId1 = checkin1Res.body.favoriteId;

    // Set visibility to circles
    await request(app)
      .patch(`/api/favorites/${favId1}`)
      .set('Authorization', `Bearer ${aliceToken}`)
      .send({ visibility: 'circles' });

    // Alice creates a private favorite
    const checkin2Res = await request(app)
      .post('/api/me/checkins')
      .set('Authorization', `Bearer ${aliceToken}`)
      .send({
        name: 'Alice Private Restaurant',
        lat: 31.24,
        lng: 121.48,
        address: 'Shanghai Private St',
        wishlist: true,
      });

    expect(checkin2Res.status).toBe(200);
    const poiKey2 = checkin2Res.body.poiKey;
    const favId2 = checkin2Res.body.favoriteId;

    // Set visibility to private
    await request(app)
      .patch(`/api/favorites/${favId2}`)
      .set('Authorization', `Bearer ${aliceToken}`)
      .send({ visibility: 'private' });

    // Alice should be able to view both shops using memberId mode
    const detail1Res = await request(app)
      .get(`/api/members/${aliceId}/shops/${encodeURIComponent(poiKey1)}`)
      .set('Authorization', `Bearer ${aliceToken}`);

    expect(detail1Res.status).toBe(200);
    expect(detail1Res.body.shop.name).toBe('Alice Circles Restaurant');

    const detail2Res = await request(app)
      .get(`/api/members/${aliceId}/shops/${encodeURIComponent(poiKey2)}`)
      .set('Authorization', `Bearer ${aliceToken}`);

    expect(detail2Res.status).toBe(200);
    expect(detail2Res.body.shop.name).toBe('Alice Private Restaurant');
  });

  it('should return 404 when Bob tries to view Alice private shop', async () => {
    // Alice creates a private favorite
    const checkinRes = await request(app)
      .post('/api/me/checkins')
      .set('Authorization', `Bearer ${aliceToken}`)
      .send({
        name: 'Alice Private Restaurant',
        lat: 31.23,
        lng: 121.47,
        address: 'Shanghai Private St',
        wishlist: true,
      });

    expect(checkinRes.status).toBe(200);
    const poiKey = checkinRes.body.poiKey;
    const favId = checkinRes.body.favoriteId;

    // Set visibility to private
    await request(app)
      .patch(`/api/favorites/${favId}`)
      .set('Authorization', `Bearer ${aliceToken}`)
      .send({ visibility: 'private' });

    // Bob tries to view Alice's private shop (should fail - no shared circles)
    const detailRes = await request(app)
      .get(`/api/members/${aliceId}/shops/${encodeURIComponent(poiKey)}`)
      .set('Authorization', `Bearer ${bobToken}`);

    expect(detailRes.status).toBe(404);
  });

  it('should return shop with distance when location provided', async () => {
    // Alice creates a favorite with coordinates
    const checkinRes = await request(app)
      .post('/api/me/checkins')
      .set('Authorization', `Bearer ${aliceToken}`)
      .send({
        name: 'Alice Restaurant',
        lat: 31.23,
        lng: 121.47,
        address: 'Shanghai St',
        wishlist: false,
      });

    expect(checkinRes.status).toBe(200);
    const poiKey = checkinRes.body.poiKey;

    // Alice views her shop with location
    const detailRes = await request(app)
      .get(
        `/api/members/${aliceId}/shops/${encodeURIComponent(poiKey)}?lat=31.24&lng=121.48`
      )
      .set('Authorization', `Bearer ${aliceToken}`);

    expect(detailRes.status).toBe(200);
    expect(detailRes.body.shop.distanceMeters).toBeDefined();
    expect(detailRes.body.shop.distanceLabel).toBeDefined();
  });
});
