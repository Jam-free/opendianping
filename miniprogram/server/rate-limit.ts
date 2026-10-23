/**
 * 简单内存限流：导入 5 次/分钟/用户（规格第 4 节）。
 * 产品意图：防止误触刷接口、降低对公开数据源的压力。
 */
export class SlidingWindowRateLimiter {
  private hits = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number = 60_000
  ) {}

  /** @returns true 表示允许 */
  tryConsume(key: string, now = Date.now()): boolean {
    const cutoff = now - this.windowMs;
    const prev = (this.hits.get(key) || []).filter((t) => t > cutoff);
    if (prev.length >= this.limit) {
      this.hits.set(key, prev);
      return false;
    }
    prev.push(now);
    this.hits.set(key, prev);
    return true;
  }

  remaining(key: string, now = Date.now()): number {
    const cutoff = now - this.windowMs;
    const prev = (this.hits.get(key) || []).filter((t) => t > cutoff);
    return Math.max(0, this.limit - prev.length);
  }

  reset(): void {
    this.hits.clear();
  }
}
