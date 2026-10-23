import { parse } from 'node-html-parser';
import { Album, Shop, DianpingAPIResponse } from './types';
import { getFixtureAlbumData, getFixtureShopHTML } from './fixtures';

const USER_AGENT = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const REFERER = 'https://h5.dianping.com/';

export function parseAlbumUrl(url: string): number | null {
  const match = url.match(/albumid[=:](\d+)/i);
  return match ? parseInt(match[1]) : null;
}

async function fetchWithRetry(url: string, options: RequestInit, maxRetries = 2): Promise<Response> {
  for (let i = 0; i <= maxRetries; i++) {
    try {
      const response = await fetch(url, {
        ...options,
        signal: AbortSignal.timeout(10000)
      });
      return response;
    } catch (error) {
      if (i === maxRetries) throw error;
      await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
    }
  }
  throw new Error('Max retries exceeded');
}

async function fetchDianpingAPI(
  albumId: number,
  withVersion: boolean,
  type: number = 0,
  nextstart: number = 0
): Promise<DianpingAPIResponse> {
  const params = new URLSearchParams({
    albumid: albumId.toString(),
    type: type.toString(),
    nextstart: nextstart.toString(),
    albumencryptid: ''
  });
  
  if (withVersion) {
    params.append('favorVersion', '3.0');
  }
  
  const url = `https://mapi.dianping.com/mapi/collect/getfavoralbumdetail.bin?${params}`;
  
  const response = await fetchWithRetry(url, {
    headers: {
      'User-Agent': USER_AGENT,
      'Referer': REFERER
    }
  });
  
  if (!response.ok) {
    throw new Error(`API request failed: ${response.status}`);
  }
  
  return await response.json();
}

async function fetchShopRecommendedDishes(shopId: number): Promise<string[]> {
  try {
    const url = `https://m.dianping.com/shop/${shopId}`;
    const response = await fetchWithRetry(url, {
      headers: {
        'User-Agent': USER_AGENT,
        'Referer': REFERER
      }
    });
    
    if (!response.ok) {
      return [];
    }
    
    const html = await response.text();
    return parseShopHTML(html);
  } catch (error) {
    console.error(`Failed to fetch dishes for shop ${shopId}:`, error);
    return [];
  }
}

function parseShopHTML(html: string): string[] {
  try {
    const root = parse(html);
    const dishes: string[] = [];
    
    const dishElements = root.querySelectorAll('.recommend-name, .dishName, [class*="dish"]');
    for (const el of dishElements) {
      const text = el.text.trim();
      if (text && text.length > 0 && text.length < 50) {
        dishes.push(text);
      }
    }
    
    const scriptTags = root.querySelectorAll('script');
    for (const script of scriptTags) {
      const content = script.text;
      const dishMatch = content.match(/"dishName"\s*:\s*"([^"]+)"/g);
      if (dishMatch) {
        for (const match of dishMatch) {
          const nameMatch = match.match(/"dishName"\s*:\s*"([^"]+)"/);
          if (nameMatch && nameMatch[1]) {
            dishes.push(nameMatch[1]);
          }
        }
      }
    }
    
    return [...new Set(dishes)].slice(0, 10);
  } catch (error) {
    console.error('Failed to parse shop HTML:', error);
    return [];
  }
}

function extractTextFromRichText(richTextArray: any[]): string {
  if (!richTextArray || !Array.isArray(richTextArray)) return '';
  
  return richTextArray
    .map(item => {
      if (item.content) {
        try {
          const parsed = JSON.parse(item.content);
          if (parsed.richtextlist) {
            return parsed.richtextlist.map((rt: any) => rt.text || '').join('');
          }
        } catch (e) {
          return item.content;
        }
      }
      return '';
    })
    .join(' ')
    .trim();
}

function parsePrice(priceStr: string): number {
  const match = priceStr.match(/(\d+)/);
  return match ? parseInt(match[1]) : 0;
}

function parseReviewCount(reviewStr: string): number {
  const match = reviewStr.match(/(\d+)/);
  return match ? parseInt(match[1]) : 0;
}

function mergeShopData(withVersionItem: any, noVersionItem: any): Partial<Shop> {
  const favorInfo = withVersionItem.favorInfo || {};
  const tracingInfo = withVersionItem.tracingInfo || {};
  const albumRecReason = withVersionItem.albumRecReason || {};
  
  const secondSubTitle = extractTextFromRichText(withVersionItem.secondSubTitle || []);
  const parts = secondSubTitle.split(/[\/\s]+/);
  const city = parts[0] || '';
  const category = parts.slice(1, -1).join(' ');
  const region = parts[parts.length - 1] || '';
  
  const tags: string[] = [];
  if (withVersionItem.thirdSubTitle) {
    for (const item of withVersionItem.thirdSubTitle) {
      if (item.type === 10 && item.content) {
        tags.push(item.content);
      }
    }
  }
  
  return {
    shopId: parseInt(favorInfo.bizId || tracingInfo.poi_id || '0'),
    uuid: favorInfo.bizUuid || tracingInfo.shopUuid || '',
    title: withVersionItem.title || '',
    cityId: tracingInfo.cityId || 0,
    city,
    category,
    region,
    avgPrice: withVersionItem.shareInfo?.content?.match(/¥\d+\/人/)?.[0] || '',
    priceNumber: parsePrice(withVersionItem.shareInfo?.content || ''),
    fiveScore: withVersionItem.fiveScore || 0,
    star: withVersionItem.star || 0,
    reviewCount: extractTextFromRichText(withVersionItem.firstSubTitle || []),
    reviewNumber: parseReviewCount(extractTextFromRichText(withVersionItem.firstSubTitle || [])),
    recReason: albumRecReason.reason || '',
    tags,
    headImg: withVersionItem.headImg || '',
    webUrl: withVersionItem.shareInfo?.webUrl || '',
    lat: noVersionItem?.lat || 0,
    lng: noVersionItem?.lng || 0,
    recDishes: []
  };
}

async function fetchAllPages(albumId: number, withVersion: boolean): Promise<DianpingAPIResponse> {
  const first: any = await fetchDianpingAPI(albumId, withVersion, 0, 0);
  const key = withVersion ? 'favorList' : 'collectItemList';
  const rec: any = first.records?.[0];
  if (!rec) return first;
  const all: any[] = [...(rec[key] || [])];
  let next = rec.nextStart, end = rec.isEnd, guard = 0;
  while (!end && next != null && guard++ < 50) {
    await new Promise(r => setTimeout(r, 500));
    const page: any = await fetchDianpingAPI(albumId, withVersion, 1, parseInt(String(next)));
    const pr = page.records?.[0];
    if (!pr || !(pr[key] || []).length) break;
    all.push(...pr[key]);
    next = pr.nextStart; end = pr.isEnd;
  }
  rec[key] = all;
  return first;
}

export async function fetchAlbumData(albumId: number, useFixtures: boolean = false): Promise<{
  album: Album;
  shops: Shop[];
}> {
  let withVersionData: DianpingAPIResponse;
  let noVersionData: DianpingAPIResponse;
  
  if (useFixtures) {
    const fixtures = getFixtureAlbumData(albumId);
    if (!fixtures.withVersion || !fixtures.noVersion) {
      throw new Error('Fixtures not available for this album');
    }
    withVersionData = fixtures.withVersion;
    noVersionData = fixtures.noVersion;
  } else {
    try {
      [withVersionData, noVersionData] = await Promise.all([
        fetchAllPages(albumId, true),
        fetchAllPages(albumId, false)
      ]);
    } catch (error) {
      console.error('API fetch failed, falling back to fixtures:', error);
      const fixtures = getFixtureAlbumData(albumId);
      if (!fixtures.withVersion || !fixtures.noVersion) {
        throw new Error('API failed and no fixtures available');
      }
      withVersionData = fixtures.withVersion;
      noVersionData = fixtures.noVersion;
    }
  }
  
  const albumItem = withVersionData.favorAlbumItem;
  const album: Album = {
    albumId,
    title: albumItem.title || `专辑${albumId}`,
    shopCount: parseInt(albumItem.shopCount || '0'),
    contentCount: parseInt(albumItem.contentCount || '0'),
    createTime: albumItem.createTime,
    latestModifyTime: albumItem.latestModifyTime,
    authorName: albumItem.authorInfo?.userName || '',
    authorId: albumItem.authorInfo?.userId || 0
  };
  
  const withVersionList = withVersionData.records[0]?.favorList || [];
  const noVersionList = noVersionData.records[0]?.collectItemList || [];
  
  const shopMap = new Map<number, Partial<Shop>>();
  
  for (const item of withVersionList) {
    const shopData = mergeShopData(item, null);
    if (shopData.shopId) {
      shopMap.set(shopData.shopId, shopData);
    }
  }
  
  for (const item of noVersionList) {
    const shopId = item.shopId;
    if (shopId && shopMap.has(shopId)) {
      const existing = shopMap.get(shopId)!;
      existing.lat = item.lat;
      existing.lng = item.lng;
    }
  }
  
  const shops: Shop[] = [];
  for (const [shopId, shopData] of shopMap) {
    let dishes: string[] = [];
    
    if (useFixtures) {
      const fixtureHTML = getFixtureShopHTML(shopId);
      if (fixtureHTML) {
        dishes = parseShopHTML(fixtureHTML);
      }
    } else {
      await new Promise(resolve => setTimeout(resolve, 1000));
      try {
        dishes = await fetchShopRecommendedDishes(shopId);
      } catch (error) {
        console.error(`Failed to fetch dishes for ${shopId}:`, error);
      }
    }
    
    shops.push({
      ...shopData,
      albumId,
      recDishes: dishes
    } as Shop);
  }
  
  return { album, shops };
}
