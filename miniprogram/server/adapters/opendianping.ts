import { config } from '../config.js';
import type { ParsedShop } from '../types.js';
import type { ParseInput, ParseResult, SourceAdapter } from './types.js';
import { fetchAlbumShops, parseAlbumId } from './album-fetch.js';

/**
 * 方案 A：解析大众点评公开专辑链接。
 * 云托管版内置 album-fetch，不依赖仓库根 lib/fetcher。
 */
export class OpenDianpingAdapter implements SourceAdapter {
  readonly name = 'opendianping';

  async parse(input: ParseInput): Promise<ParseResult> {
    const albumId = parseAlbumId(input.text);
    if (!albumId) {
      return {
        shops: [],
        sourceType: 'dianping_album',
        truncated: false,
        message:
          '无法从链接中解析 albumid，请粘贴含 albumid 的公开专辑分享链接',
      };
    }

    let title = `专辑${albumId}`;
    let rawShops: Awaited<ReturnType<typeof fetchAlbumShops>>['shops'] = [];
    try {
      const data = await fetchAlbumShops(albumId);
      title = data.title;
      rawShops = data.shops;
    } catch (err) {
      console.error('[opendianping] fetch album failed', err);
      return {
        shops: [],
        sourceType: 'dianping_album',
        truncated: false,
        message: `专辑拉取失败：${(err as Error).message || '网络错误'}。请确认链接公开可访问后重试。`,
      };
    }

    const max = config.importMaxShops;
    const truncated = rawShops.length > max;
    const slice = truncated ? rawShops.slice(0, max) : rawShops;

    const shops: ParsedShop[] = slice.map((s) => {
      const shop: ParsedShop = {
        name: s.title,
        sourceType: 'dianping_album',
        sourceLabel: '点评专辑',
        sourceShopId: s.shopId,
      };
      if (s.avgPrice) shop.avgPrice = s.avgPrice;
      if (s.category) shop.category = s.category;
      if (s.region) shop.district = s.region;
      if (s.city) shop.city = s.city;
      if (s.webUrl) shop.sourceUrl = s.webUrl;
      if (s.lat) shop.lat = s.lat;
      if (s.lng) shop.lng = s.lng;
      if (s.headImg) shop.headImg = s.headImg;
      return shop;
    });

    return {
      shops,
      albumId: String(albumId),
      sourceType: 'dianping_album',
      truncated,
      message: truncated
        ? `专辑「${title}」超过 ${max} 家，已截断；可分批导入`
        : shops.length
          ? undefined
          : `专辑「${title}」里没有可导入的店铺（可能非公开或已失效）`,
    };
  }
}
