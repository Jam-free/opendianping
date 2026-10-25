/**
 * 云托管自带的点评公开专辑拉取（不依赖仓库根 lib/fetcher）。
 * 只读公开接口；不登录、不绕验证；shopId 仅透传接口返回值。
 */

const USER_AGENT =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const REFERER = 'https://h5.dianping.com/';

export function parseAlbumId(text: string): number | null {
  const m = text.match(/albumid[=:](\d+)/i);
  return m ? parseInt(m[1], 10) : null;
}

type RawShop = {
  shopId: string;
  title: string;
  avgPrice?: string;
  category?: string;
  region?: string;
  city?: string;
  webUrl?: string;
  headImg?: string;
  lat?: number;
  lng?: number;
};

async function fetchPage(
  albumId: number,
  withVersion: boolean,
  type: number,
  nextstart: number
): Promise<any> {
  const params = new URLSearchParams({
    albumid: String(albumId),
    type: String(type),
    nextstart: String(nextstart),
    albumencryptid: '',
  });
  if (withVersion) params.append('favorVersion', '3.0');
  const url = `https://mapi.dianping.com/mapi/collect/getfavoralbumdetail.bin?${params}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Referer: REFERER },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`点评接口 ${res.status}`);
  return res.json();
}

async function fetchAll(
  albumId: number,
  withVersion: boolean
): Promise<any> {
  const first = await fetchPage(albumId, withVersion, 0, 0);
  const key = withVersion ? 'favorList' : 'collectItemList';
  const rec = first.records?.[0];
  if (!rec) return first;
  const all = [...(rec[key] || [])];
  let next = rec.nextStart;
  let end = rec.isEnd;
  let guard = 0;
  while (!end && next != null && guard++ < 30) {
    await new Promise((r) => setTimeout(r, 400));
    const page = await fetchPage(albumId, withVersion, 1, parseInt(String(next), 10));
    const pr = page.records?.[0];
    if (!pr || !(pr[key] || []).length) break;
    all.push(...pr[key]);
    next = pr.nextStart;
    end = pr.isEnd;
  }
  rec[key] = all;
  return first;
}

function richText(arr: any[]): string {
  if (!Array.isArray(arr)) return '';
  return arr
    .map((item) => {
      if (!item?.content) return '';
      try {
        const parsed = JSON.parse(item.content);
        if (parsed.richtextlist) {
          return parsed.richtextlist.map((rt: any) => rt.text || '').join('');
        }
      } catch {
        return String(item.content);
      }
      return '';
    })
    .join(' ')
    .trim();
}

/** 拉取专辑店铺列表（不做推荐菜爬取，导入更快） */
export async function fetchAlbumShops(albumId: number): Promise<{
  title: string;
  shops: RawShop[];
}> {
  const [withV, noV] = await Promise.all([
    fetchAll(albumId, true),
    fetchAll(albumId, false),
  ]);

  const title =
    withV.favorAlbumItem?.title || noV.favorAlbumItem?.title || `专辑${albumId}`;
  const favorList = withV.records?.[0]?.favorList || [];
  const collectList = noV.records?.[0]?.collectItemList || [];
  const coords = new Map<number, { lat: number; lng: number }>();
  for (const item of collectList) {
    if (item.shopId && (item.lat || item.lng)) {
      coords.set(Number(item.shopId), {
        lat: Number(item.lat) || 0,
        lng: Number(item.lng) || 0,
      });
    }
  }

  const shops: RawShop[] = [];
  for (const item of favorList) {
    const favorInfo = item.favorInfo || {};
    const tracing = item.tracingInfo || {};
    const shopId = String(favorInfo.bizId || tracing.poi_id || '');
    const name = String(item.title || '').trim();
    if (!shopId || !name) continue;

    const second = richText(item.secondSubTitle || []);
    const parts = second.split(/[\/\s]+/).filter(Boolean);
    const city = parts[0] || '';
    const region = parts.length > 1 ? parts[parts.length - 1] : '';
    const category = parts.length > 2 ? parts.slice(1, -1).join(' ') : '';
    const c = coords.get(Number(shopId));

    const shop: RawShop = {
      shopId,
      title: name,
      city: city || undefined,
      category: category || undefined,
      region: region || undefined,
      avgPrice: item.shareInfo?.content?.match(/¥\d+\/人/)?.[0] || undefined,
      webUrl: item.shareInfo?.webUrl || undefined,
      headImg: item.headImg || undefined,
    };
    if (c?.lat) shop.lat = c.lat;
    if (c?.lng) shop.lng = c.lng;
    shops.push(shop);
  }

  return { title, shops };
}
