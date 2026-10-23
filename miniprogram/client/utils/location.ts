const LAST_KEY = 'last_location';

export type UserLocation = {
  lat: number;
  lng: number;
  userCity?: string;
};

/** 获取 GCJ-02 坐标；用户坐标仅内存/本地缓存，不上传落库 */
export async function getUserLocation(): Promise<UserLocation | null> {
  try {
    const res = await new Promise<WechatMiniprogram.GetLocationSuccessCallbackResult>(
      (resolve, reject) => {
        wx.getLocation({ type: 'gcj02', success: resolve, fail: reject });
      }
    );
    const loc: UserLocation = { lat: res.latitude, lng: res.longitude };
    wx.setStorageSync(LAST_KEY, loc);
    return loc;
  } catch {
    const cached = wx.getStorageSync(LAST_KEY) as UserLocation | undefined;
    return cached?.lat != null ? cached : null;
  }
}

export function shouldRefreshLocation(
  prev: UserLocation | null,
  next: UserLocation
): boolean {
  if (!prev) return true;
  const dLat = (next.lat - prev.lat) * 111320;
  const dLng =
    (next.lng - prev.lng) *
    111320 *
    Math.cos((next.lat * Math.PI) / 180);
  return Math.hypot(dLat, dLng) > 500;
}
