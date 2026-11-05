/** 地球半径（米），Haversine 直线距离 */
const R = 6371000;

export function haversineMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** 规格 0.1：<1km 显示 m，否则 km；跨城可带城市名 */
export function formatDistanceLabel(
  meters: number,
  opts?: { userCity?: string; shopCity?: string; coarse?: boolean }
): string {
  if (opts?.userCity && opts.shopCity && opts.userCity !== opts.shopCity) {
    return opts.shopCity;
  }
  // 模糊坐标误差常有一个街区。写成「1公里内」而不是「268m」，避免假精度。
  if (opts?.coarse) {
    const km = Math.max(1, Math.ceil(meters / 1000));
    return `${km}公里内`;
  }
  if (meters < 1000) {
    return `${Math.round(meters)} m`;
  }
  return `${(meters / 1000).toFixed(1)} km`;
}

export function formatRecommendersLine(
  collectors: Array<{ nickname: string | null }>,
  total: number
): string {
  const names = collectors
    .map((c) => c.nickname?.trim())
    .filter(Boolean) as string[];
  const shown = names.slice(0, 2);
  if (total <= 0) return '';
  if (total === 1 && shown[0]) return `来自${shown[0]}`;
  if (shown.length >= 2 && total > 2) {
    return `来自${shown[0]}、${shown[1]}等 ${total} 人`;
  }
  if (shown.length === 1 && total > 1) {
    return `来自${shown[0]}等 ${total} 人`;
  }
  if (shown.length >= 2) {
    return `来自${shown[0]}、${shown[1]}`;
  }
  return `来自 ${total} 人`;
}
