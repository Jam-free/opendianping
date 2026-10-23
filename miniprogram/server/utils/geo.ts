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
  opts?: { userCity?: string; shopCity?: string }
): string {
  if (opts?.userCity && opts.shopCity && opts.userCity !== opts.shopCity) {
    return opts.shopCity;
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
  if (total === 1 && shown[0]) return `${shown[0]} 推荐`;
  if (shown.length >= 2 && total > 2) {
    return `${shown[0]}、${shown[1]}等 ${total} 人推荐`;
  }
  if (shown.length === 1 && total > 1) {
    return `${shown[0]}等 ${total} 人推荐`;
  }
  if (shown.length >= 2) {
    return `${shown[0]}、${shown[1]} 推荐`;
  }
  return `${total} 人推荐`;
}
