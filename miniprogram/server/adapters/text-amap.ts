import { config } from '../config.js';
import type { ParsedShop } from '../types.js';
import type { ParseInput, ParseResult, SourceAdapter } from './types.js';

/**
 * 方案 B（默认兜底）：从用户粘贴文本里识别店名 → 可选高德 POI 匹配。
 * 产品决策：合规优先；没有高德 Key 时只返回店名，绝不编造 poi_id / shopId。
 */
export class TextAmapAdapter implements SourceAdapter {
  readonly name = 'text_amap';

  async parse(input: ParseInput): Promise<ParseResult> {
    const names = extractShopNames(input.text);
    if (names.length === 0) {
      return {
        shops: [],
        sourceType: 'text',
        truncated: false,
        message: '未识别到店名。可粘贴多行店名，或换用公开专辑链接（方案 A）',
      };
    }

    const max = config.importMaxShops;
    const truncated = names.length > max;
    const slice = truncated ? names.slice(0, max) : names;

    const shops: ParsedShop[] = [];
    for (const name of slice) {
      const matched = config.amapKey
        ? await matchAmapPoi(name, config.amapKey)
        : null;

      const shop: ParsedShop = {
        name: matched?.name || name,
        sourceType: matched ? 'amap' : 'text',
        sourceLabel: matched ? '高德匹配' : '文本识别',
      };
      // 只有高德真正返回的字段才写入；禁止占位假数据
      if (matched?.address) shop.address = matched.address;
      if (matched?.avgPrice) shop.avgPrice = matched.avgPrice;
      if (matched?.category) shop.category = matched.category;
      if (matched?.district) shop.district = matched.district;
      if (matched?.city) shop.city = matched.city;
      if (matched?.lat != null) shop.lat = matched.lat;
      if (matched?.lng != null) shop.lng = matched.lng;
      if (matched?.amapPoiId) shop.amapPoiId = matched.amapPoiId;
      // 故意不设 sourceShopId：文本路径没有点评 shopId
      shops.push(shop);
    }

    return {
      shops,
      sourceType: shops.some((s) => s.sourceType === 'amap') ? 'amap' : 'text',
      truncated,
      message: truncated
        ? `识别到超过 ${max} 家，已截断`
        : !config.amapKey
          ? '未配置 AMAP_KEY：仅返回店名，未匹配 POI'
          : undefined,
    };
  }
}

/** 启发式抽店名：按行 / 顿号 / 逗号拆，过滤链接与过短噪声 */
export function extractShopNames(text: string): string[] {
  const cleaned = text
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/albumid[=:]\d+/gi, ' ');
  const parts = cleaned
    .split(/[\n\r,，、;；|｜]+/)
    .map((s) => s.replace(/^\d+[\.、\)]\s*/, '').trim())
    .filter((s) => s.length >= 2 && s.length <= 40)
    .filter((s) => s.length >= 3 || /[店铺馆厅面屋吧行]/u.test(s))
    .filter((s) => !/^(店名|名称|地址|人均)/.test(s));

  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of parts) {
    const key = p.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}

interface AmapMatch {
  name: string;
  amapPoiId: string;
  address?: string;
  category?: string;
  district?: string;
  city?: string;
  lat?: number;
  lng?: number;
  avgPrice?: string;
}

async function matchAmapPoi(
  name: string,
  key: string
): Promise<AmapMatch | null> {
  const url = new URL('https://restapi.amap.com/v3/place/text');
  url.searchParams.set('key', key);
  url.searchParams.set('keywords', name);
  url.searchParams.set('offset', '1');
  url.searchParams.set('page', '1');
  url.searchParams.set('extensions', 'base');

  try {
    const res = await fetch(url.toString(), {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      status?: string;
      pois?: Array<{
        id?: string;
        name?: string;
        address?: string | string[];
        type?: string;
        adname?: string;
        cityname?: string;
        location?: string;
      }>;
    };
    if (data.status !== '1' || !data.pois?.[0]?.id) return null;
    const poi = data.pois[0];
    const [lngStr, latStr] = (poi.location || '').split(',');
    const lat = latStr ? Number(latStr) : undefined;
    const lng = lngStr ? Number(lngStr) : undefined;
    const address = Array.isArray(poi.address)
      ? poi.address[0]
      : poi.address;

    return {
      name: poi.name || name,
      amapPoiId: poi.id,
      address: address || undefined,
      category: poi.type || undefined,
      district: poi.adname || undefined,
      city: poi.cityname || undefined,
      lat: Number.isFinite(lat) ? lat : undefined,
      lng: Number.isFinite(lng) ? lng : undefined,
    };
  } catch {
    return null;
  }
}
