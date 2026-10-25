import { config } from '../config.js';

export type ReverseGeoResult = {
  address: string;
  province?: string;
  city?: string;
  district?: string;
  township?: string;
  street?: string;
};

/**
 * 逆地理：坐标 → 可读地址。
 * 优先腾讯位置服务（TENCENT_MAP_KEY），其次高德（AMAP_KEY）；
 * 都没有则返回简短占位，避免只甩经纬度给用户。
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
  url.searchParams.set('get_poi', '0');

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
      };
    };

    if (data.status !== 0 || !data.result) {
      console.warn('[geo] tencent reverse failed', data.status, data.message);
      return null;
    }

    const ac = data.result.address_component || {};
    const street = [ac.street, ac.street_number].filter(Boolean).join('');
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
  url.searchParams.set('extensions', 'base');

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
      };
    };

    if (data.status !== '1' || !data.regeocode) return null;

    const ac = data.regeocode.addressComponent || {};
    const city = Array.isArray(ac.city) ? ac.city[0] : ac.city;
    const street = [ac.streetNumber?.street, ac.streetNumber?.number]
      .filter(Boolean)
      .join('');

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
    };
  } catch (err) {
    console.warn('[geo] amap reverse error', err);
    return null;
  }
}
