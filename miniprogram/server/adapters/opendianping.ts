import { parseAlbumUrl, fetchAlbumData } from '../../../lib/fetcher.js';
import { config } from '../config.js';
import type { ParsedShop } from '../types.js';
import type { ParseInput, ParseResult, SourceAdapter } from './types.js';

/**
 * 方案 A：复用仓库 lib/fetcher 的公开专辑导入能力。
 * 产品决策：只读用户主动分享的公开专辑；不登录、不绕验证。
 * shopId 仅透传接口返回值，本地不生成点评 shopId。
 */
export class OpenDianpingAdapter implements SourceAdapter {
  readonly name = 'opendianping';

  async parse(input: ParseInput): Promise<ParseResult> {
    const albumId = parseAlbumUrl(input.text);
    if (!albumId) {
      return {
        shops: [],
        sourceType: 'dianping_album',
        truncated: false,
        message:
          '无法从链接中解析 albumid，请粘贴含 albumid 的公开专辑分享链接',
      };
    }

    const { album, shops: rawShops } = await fetchAlbumData(
      albumId,
      Boolean(input.useFixtures)
    );

    const max = config.importMaxShops;
    const truncated = rawShops.length > max;
    const slice = truncated ? rawShops.slice(0, max) : rawShops;

    const shops: ParsedShop[] = slice
      .filter((s) => Boolean(s.shopId) && Boolean(s.title))
      .map((s) => {
        const shop: ParsedShop = {
          name: String(s.title),
          sourceType: 'dianping_album',
          sourceLabel: '点评专辑',
          sourceShopId: String(s.shopId),
        };
        if (s.avgPrice) shop.avgPrice = String(s.avgPrice);
        if (s.category) shop.category = String(s.category);
        if (s.region) shop.district = String(s.region);
        if (s.city) shop.city = String(s.city);
        if (s.webUrl) shop.sourceUrl = String(s.webUrl);
        if (typeof s.lat === 'number' && s.lat !== 0) shop.lat = s.lat;
        if (typeof s.lng === 'number' && s.lng !== 0) shop.lng = s.lng;
        if (s.headImg) shop.headImg = String(s.headImg);
        return shop;
      });

    return {
      shops,
      albumId: String(album.albumId),
      sourceType: 'dianping_album',
      truncated,
      message: truncated
        ? `专辑「${album.title}」超过 ${max} 家，已截断；可分批导入`
        : undefined,
    };
  }
}
