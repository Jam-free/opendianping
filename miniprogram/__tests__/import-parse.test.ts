import { resetDbForTests, closeDb } from '../server/db.js';
import { createSessionForOpenId } from '../server/auth.js';
import { extractShopNames } from '../server/adapters/text-amap.js';
import { TextAmapAdapter } from '../server/adapters/text-amap.js';
import { OpenDianpingAdapter } from '../server/adapters/opendianping.js';
import {
  clearPreviewStore,
  importRateLimiter,
  parseImport,
  saveImportSelection,
  undoImportBatch,
} from '../server/services/import.js';
import { listFavorites } from '../server/services/favorites.js';
import { parseAlbumUrl } from '../../lib/fetcher.js';

describe('导入解析', () => {
  beforeEach(() => {
    resetDbForTests();
    clearPreviewStore();
    importRateLimiter.reset();
  });

  afterAll(() => {
    closeDb();
  });

  test('parseAlbumUrl 从公开分享链接提取 albumid', () => {
    expect(
      parseAlbumUrl(
        'https://h5.dianping.com/app/commonplatform-collection-static/album.html?albumid=12498807'
      )
    ).toBe(12498807);
    expect(parseAlbumUrl('没有 id')).toBeNull();
  });

  test('文本适配器识别店名且不编造 shopId / amapPoiId', async () => {
    const adapter = new TextAmapAdapter();
    const result = await adapter.parse({
      text: '懂爱小面\n喜茶坂田店\n太短\n',
    });
    expect(result.shops.map((s) => s.name)).toEqual(['懂爱小面', '喜茶坂田店']);
    for (const shop of result.shops) {
      expect(shop.sourceShopId).toBeUndefined();
      expect(shop.amapPoiId).toBeUndefined();
      expect(shop.sourceLabel).toBe('文本识别');
    }
  });

  test('extractShopNames 去重并过滤链接噪声', () => {
    const names = extractShopNames(
      '店A\n店A\nhttps://h5.dianping.com/x?albumid=1\n店B'
    );
    expect(names).toEqual(['店A', '店B']);
  });

  test('方案 A fixtures 解析出真实 shopId，不生成假 id', async () => {
    const adapter = new OpenDianpingAdapter();
    const result = await adapter.parse({
      text: 'https://h5.dianping.com/app/commonplatform-collection-static/album.html?albumid=12498807',
      useFixtures: true,
    });
    expect(result.shops.length).toBe(6);
    expect(result.albumId).toBe('12498807');
    for (const shop of result.shops) {
      expect(shop.sourceShopId).toBeTruthy();
      expect(shop.sourceShopId).toMatch(/^\d+$/);
      expect(shop.name).toBeTruthy();
      expect(shop.sourceLabel).toBe('点评专辑');
    }
    const first = result.shops.find((s) => s.sourceShopId === '1908397290');
    expect(first?.name).toContain('懂爱小面');
  });

  test('无效专辑链接给出明确失败', async () => {
    const { user } = createSessionForOpenId('dev_importer');
    await expect(
      parseImport(user.id, { text: '这不是链接' })
    ).rejects.toMatchObject({ status: 400 });
  });

  test('勾选保存：成功/重复计数，并可整批撤销', async () => {
    const { user } = createSessionForOpenId('dev_importer2');
    const preview = await parseImport(user.id, {
      text: 'https://h5.dianping.com/?albumid=12498807',
      useFixtures: true,
    });
    expect(preview.shops.length).toBe(6);

    const first = saveImportSelection({
      userId: user.id,
      previewId: preview.previewId,
      selectedIndexes: [0, 1],
      visibility: 'private',
    });
    expect(first.success).toBe(2);
    expect(first.duplicate).toBe(0);

    // 同一批预览已消费；重新解析后再存相同店 → 重复
    const preview2 = await parseImport(user.id, {
      text: 'albumid=12498807',
      useFixtures: true,
    });
    const second = saveImportSelection({
      userId: user.id,
      previewId: preview2.previewId,
      selectedIndexes: [0],
      visibility: 'private',
    });
    expect(second.duplicate).toBe(1);

    const before = listFavorites(user.id);
    expect(before.length).toBe(2);

    const removed = undoImportBatch(user.id, first.batchId);
    expect(removed).toBe(2);
    expect(listFavorites(user.id).length).toBe(0);
  });

  test('导入限流：每用户每分钟超过配额返回 429', async () => {
    const { user } = createSessionForOpenId('dev_rate');
    // 默认配额 5；先耗尽
    for (let i = 0; i < 5; i++) {
      await parseImport(user.id, {
        text: 'albumid=12498807',
        useFixtures: true,
      });
    }
    await expect(
      parseImport(user.id, {
        text: 'albumid=12498807',
        useFixtures: true,
      })
    ).rejects.toMatchObject({ status: 429 });
  });
});
