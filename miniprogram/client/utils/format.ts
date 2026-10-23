/** 把后端 distanceLabel 拆成瑞士风大字 + 单位 */
export function splitDistance(label?: string): {
  main: string;
  unit: string;
  na: boolean;
} {
  if (!label) {
    return { main: '—', unit: '', na: true };
  }
  const m = label.match(/^([\d.]+)\s*(m|km)$/i);
  if (m) {
    return { main: m[1], unit: m[2].toLowerCase(), na: false };
  }
  return { main: label, unit: '', na: true };
}

export function avatarInitial(nickname?: string | null): string {
  const n = (nickname || '').trim();
  return n ? n.slice(0, 1) : '?';
}
