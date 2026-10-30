import { config } from '../config.js';

/** 附近兴趣点：记美食时点选店名/地址 */
export type NearbyPoi = {
  id: string;
  title: string;
  address: string;
  /** 腾讯 category / 高德 type，如「美食:火锅」「餐饮服务;中餐厅」 */
  category?: string;
  /** 距定位点米数 */
  distance?: number;
  lat?: number;
  lng?: number;
};

/**
 * 是否像「能去吃饭的店」。
 * 腾讯用 category（美食:…），高德用 type（餐饮服务;…）；
 * 没类目的多为道路/小区门牌，记美食列表里直接丢掉。
 */
export function isFoodVenueCategory(category?: string): boolean {
  if (!category || !category.trim()) return false;
  const c = category.trim();
  // 明确排除非店
  if (
    /道路|路口|公交|地铁|停车场|厕所|门牌|地名|行政区|桥梁|收费站|高速/.test(
      c
    )
  ) {
    return false;
  }
  return /美食|餐饮|小吃|火锅|烧烤|咖啡|甜品|面包|茶座|冷饮|食品|酒吧|烘焙|奶茶|饮品|餐厅|饭店/.test(
    c
  );
}

export type ReverseGeoResult = {
  address: string;
  province?: string;
  city?: string;
  district?: string;
  township?: string;
  street?: string;
  /** 附近 POI，前端可点选；没有 Key 时为空数组 */
  pois: NearbyPoi[];
};

/**
 * 逆地理：坐标 → 可读地址 + 附近店铺。
 * 腾讯 get_poi=1 才能列出周边店；高德用 extensions=all。
 */
export async function reverseGeocode(
  lat: number,
  lng: number
): Promise<ReverseGeoResult> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw Object.assign(new Error('坐标无效'), { status: 400 });
  }

  const fallback: ReverseGeoResult = {
    address: `当前位置（${lat.toFixed(4)}, ${lng.toFixed(4)}）`,
    pois: [],
  };

  if (config.tencentMapKey) {
    const hit = await reverseByTencent(lat, lng);
    if (hit) return hit;
  }

  if (config.amapKey) {
    const hit = await reverseByAmap(lat, lng);
    if (hit) return hit;
  }

  return fallback;
}

async function reverseByTencent(
  lat: number,
  lng: number
): Promise<ReverseGeoResult | null> {
  const url = new URL('https://apis.map.qq.com/ws/geocoder/v1/');
  url.searchParams.set('location', `${lat},${lng}`);
  url.searchParams.set('key', config.tencentMapKey);
  // 打开附近 POI；category=美食 让接口侧先筛餐饮，少混进道路/小区
  url.searchParams.set('get_poi', '1');
  url.searchParams.set(
    'poi_options',
    'policy=2;radius=500;page_size=20;category=美食'
  );

  try {
    const res = await fetch(url.toString(), {
      signal: AbortSignal.timeout(8000),
    });
    const data = (await res.json()) as {
      status?: number;
      message?: string;
      result?: {
        address?: string;
        address_component?: {
          province?: string;
          city?: string;
          district?: string;
          street?: string;
          street_number?: string;
        };
        address_reference?: { town?: { title?: string } };
        pois?: Array<{
          id?: string;
          title?: string;
          address?: string;
          category?: string;
          _distance?: number;
          location?: { lat?: number; lng?: number };
        }>;
      };
    };

    if (data.status !== 0 || !data.result) {
      console.warn('[geo] tencent reverse failed', data.status, data.message);
      return null;
    }

    const ac = data.result.address_component || {};
    const street = [ac.street, ac.street_number].filter(Boolean).join('');
    const pois: NearbyPoi[] = (data.result.pois || [])
      .filter((p) => p.title && isFoodVenueCategory(p.category))
      .slice(0, 12)
      .map((p, i) => ({
        id: p.id || `t_${i}`,
        title: String(p.title),
        address: p.address || data.result?.address || '',
        category: p.category,
        distance:
          typeof p._distance === 'number' ? Math.round(p._distance) : undefined,
        lat: p.location?.lat,
        lng: p.location?.lng,
      }));

    return {
      address:
        data.result.address ||
        [ac.city, ac.district, street].filter(Boolean).join('') ||
        `当前位置（${lat.toFixed(4)}, ${lng.toFixed(4)}）`,
      province: ac.province,
      city: ac.city,
      district: ac.district,
      township: data.result.address_reference?.town?.title,
      street: street || undefined,
      pois,
    };
  } catch (err) {
    console.warn('[geo] tencent reverse error', err);
    return null;
  }
}

async function reverseByAmap(
  lat: number,
  lng: number
): Promise<ReverseGeoResult | null> {
  const url = new URL('https://restapi.amap.com/v3/geocode/regeo');
  url.searchParams.set('key', config.amapKey);
  url.searchParams.set('location', `${lng},${lat}`);
  url.searchParams.set('extensions', 'all');
  url.searchParams.set('radius', '500');
  url.searchParams.set('roadlevel', '0');

  try {
    const res = await fetch(url.toString(), {
      signal: AbortSignal.timeout(8000),
    });
    const data = (await res.json()) as {
      status?: string;
      regeocode?: {
        formatted_address?: string;
        addressComponent?: {
          province?: string;
          city?: string | string[];
          district?: string;
          township?: string;
          streetNumber?: { street?: string; number?: string };
        };
        pois?: Array<{
          id?: string;
          name?: string;
          address?: string | string[];
          type?: string;
          distance?: string;
          location?: string;
        }>;
      };
    };

    if (data.status !== '1' || !data.regeocode) return null;

    const ac = data.regeocode.addressComponent || {};
    const city = Array.isArray(ac.city) ? ac.city[0] : ac.city;
    const street = [ac.streetNumber?.street, ac.streetNumber?.number]
      .filter(Boolean)
      .join('');

    const pois: NearbyPoi[] = (data.regeocode.pois || [])
      .filter((p) => p.name && isFoodVenueCategory(p.type))
      .slice(0, 12)
      .map((p, i) => {
        const loc = (p.location || '').split(',');
        const poiLng = loc[0] ? Number(loc[0]) : undefined;
        const poiLat = loc[1] ? Number(loc[1]) : undefined;
        const addr = Array.isArray(p.address) ? p.address[0] : p.address;
        const dist = p.distance ? Number(p.distance) : undefined;
        return {
          id: p.id || `a_${i}`,
          title: String(p.name),
          address: addr || data.regeocode?.formatted_address || '',
          category: p.type,
          distance: Number.isFinite(dist) ? Math.round(dist!) : undefined,
          lat: Number.isFinite(poiLat) ? poiLat : undefined,
          lng: Number.isFinite(poiLng) ? poiLng : undefined,
        };
      });

    return {
      address:
        data.regeocode.formatted_address ||
        [city, ac.district, ac.township, street].filter(Boolean).join('') ||
        `当前位置（${lat.toFixed(4)}, ${lng.toFixed(4)}）`,
      province: ac.province,
      city: city || undefined,
      district: ac.district,
      township: ac.township,
      street: street || undefined,
      pois,
    };
  } catch (err) {
    console.warn('[geo] amap reverse error', err);
    return null;
  }
}
