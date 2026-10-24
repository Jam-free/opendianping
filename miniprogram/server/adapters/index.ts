import { config } from '../config.js';
import type { SourceAdapterName } from '../config.js';
import type { ParseInput, ParseResult, SourceAdapter } from './types.js';
import { TextAmapAdapter, extractShopNames } from './text-amap.js';

/**
 * 懒加载适配器：云托管镜像不含仓库根 lib/fetcher，
 * 若启动时静态 import OpenDianpingAdapter 会直接崩溃。
 * 仅在真正选用 opendianping 时再动态加载。
 */
const cache: Partial<Record<SourceAdapterName, SourceAdapter>> = {
  text_amap: new TextAmapAdapter(),
};

async function loadAdapter(name: SourceAdapterName): Promise<SourceAdapter> {
  const hit = cache[name];
  if (hit) return hit;

  if (name === 'opendianping') {
    try {
      const mod = await import('./opendianping.js');
      cache.opendianping = new mod.OpenDianpingAdapter();
      return cache.opendianping;
    } catch (err) {
      console.warn(
        '[adapter] opendianping 不可用（缺少 lib/fetcher），回退 text_amap',
        err
      );
      return cache.text_amap!;
    }
  }

  return cache.text_amap!;
}

export async function getAdapter(
  name: SourceAdapterName = config.sourceAdapter
): Promise<SourceAdapter> {
  return loadAdapter(name);
}

/**
 * 解析入口：主适配器失败且输入像「纯文本」时，自动降级到方案 B。
 */
export async function parseUserInput(
  input: ParseInput,
  preferred?: SourceAdapterName
): Promise<ParseResult & { adapter: string }> {
  const primaryName = preferred || config.sourceAdapter;
  const primary = await getAdapter(primaryName);
  const result = await primary.parse(input);

  if (
    result.shops.length === 0 &&
    primaryName === 'opendianping' &&
    !/albumid[=:]\d+/i.test(input.text)
  ) {
    const names = extractShopNames(input.text);
    const looksLikeList = names.length >= 2 || /\n/.test(input.text);
    if (looksLikeList) {
      const fallback = await (await getAdapter('text_amap')).parse(input);
      return { ...fallback, adapter: 'text_amap' };
    }
  }

  return { ...result, adapter: primary.name };
}

export { extractShopNames } from './text-amap.js';
export type { ParseInput, ParseResult, SourceAdapter };
