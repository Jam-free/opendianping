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
 * 有 AMAP_KEY 走高德；没有则返回简短占位，避免只甩经纬度给用户。
 */
export async function reverseGeocode(
  lat: number,
  lng: number
): Promise<ReverseGeoResult> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw Object.assign(new Error('坐标无效'), { status: 400 });
  }

  if (!config.amapKey) {
    return {
      address: `当前位置（${lat.toFixed(4)}, ${lng.toFixed(4)}）`,
    };
  }

  const url = new URL('https://restapi.amap.com/v3/geocode/regeo');
  url.searchParams.set('key', config.amapKey);
  url.searchParams.set('location', `${lng},${lat}`);
  url.searchParams.set('extensions', 'base');

  const res = await fetch(url.toString());
  const data = (await res.json()) as {
    status?: string;
    info?: string;
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

  if (data.status !== '1' || !data.regeocode) {
    return {
      address: `当前位置（${lat.toFixed(4)}, ${lng.toFixed(4)}）`,
    };
  }

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
}
