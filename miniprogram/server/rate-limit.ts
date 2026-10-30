import { config } from './config.js';

/**
 * 简单内存限流：导入 5 次/分钟/用户（规格第 4 节）。
 * 产品意图：防止误触刷接口、降低对公开数据源的压力。
 *
 * windowMs 可换成一天，给 Agent 写店用「每分钟 + 每天」两道闸。
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

/** Agent 写店：每用户每分钟 ≤30 */
export const agentShopWriteMinuteLimiter = new SlidingWindowRateLimiter(
  config.agentShopWritePerMin,
  60_000
);

/** Agent 写店：每用户每天 ≤200（滑动 24h，不是自然日） */
export const agentShopWriteDayLimiter = new SlidingWindowRateLimiter(
  config.agentShopWritePerDay,
  24 * 60 * 60 * 1000
);

/**
 * 两道闸都还有余量才记一次命中。
 * 产品意图：Token 泄露时也写不了太脏；超限给 429，用户可在「连接 AI」重置 Token。
 */
export function tryConsumeAgentShopWrite(
  userId: string,
  now = Date.now()
): boolean {
  if (
    agentShopWriteMinuteLimiter.remaining(userId, now) <= 0 ||
    agentShopWriteDayLimiter.remaining(userId, now) <= 0
  ) {
    return false;
  }
  agentShopWriteMinuteLimiter.tryConsume(userId, now);
  agentShopWriteDayLimiter.tryConsume(userId, now);
  return true;
}

export function resetAgentShopWriteLimiters(): void {
  agentShopWriteMinuteLimiter.reset();
  agentShopWriteDayLimiter.reset();
}
