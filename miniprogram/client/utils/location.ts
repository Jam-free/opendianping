const LAST_KEY = 'last_location';

export type UserLocation = {
  lat: number;
  lng: number;
  userCity?: string;
};

/**
 * 列表和详情只用模糊位置。
 *
 * 为什么不用精确位置：微信不允许同一个小程序同时声明「精确位置」和「模糊位置」。
 * 精确位置接口的开放范围也不包含「按距离排店、看离我多远」。
 * 模糊坐标够用来分出大概远近；误差常常有一个街区，所以距离文案不写几十米。
 *
 * 记美食的附近列表也走这里，页面交互仍是选附近店或搜店名。
 * 模糊坐标对不齐门口那几米；认准某一家时用搜索店名。
 * 用户坐标只留在手机本地，不上传落库。
 */
export async function getUserLocation(): Promise<UserLocation | null> {
  try {
    const res = await new Promise<WechatMiniprogram.GetLocationSuccessCallbackResult>(
      (resolve, reject) => {
        wx.getFuzzyLocation({
          type: 'gcj02',
          success: resolve,
          fail: reject,
        });
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
