import { config } from '../config.js';
import type { SourceAdapterName } from '../config.js';
import type { ParseInput, ParseResult, SourceAdapter } from './types.js';
import { OpenDianpingAdapter } from './opendianping.js';
import { TextAmapAdapter, extractShopNames } from './text-amap.js';

const adapters: Record<SourceAdapterName, SourceAdapter> = {
  opendianping: new OpenDianpingAdapter(),
  text_amap: new TextAmapAdapter(),
};

export function getAdapter(name: SourceAdapterName = config.sourceAdapter): SourceAdapter {
  return adapters[name] || adapters.text_amap;
}

/**
 * 解析入口：主适配器失败且输入像「纯文本」时，自动降级到方案 B。
 * 产品意图：专辑页结构变化时不阻断用户，仍能记住店名。
 */
export async function parseUserInput(
  input: ParseInput,
  preferred?: SourceAdapterName
): Promise<ParseResult & { adapter: string }> {
  const primaryName = preferred || config.sourceAdapter;
  const primary = getAdapter(primaryName);
  const result = await primary.parse(input);

  if (
    result.shops.length === 0 &&
    primaryName === 'opendianping' &&
    !/albumid[=:]\d+/i.test(input.text)
  ) {
    const names = extractShopNames(input.text);
    const looksLikeList = names.length >= 2 || /\n/.test(input.text);
    if (looksLikeList) {
      const fallback = await getAdapter('text_amap').parse(input);
      return { ...fallback, adapter: 'text_amap' };
    }
  }

  // 有 albumid 但解析失败：不静默换成 B，让用户看到明确错误
  return { ...result, adapter: primary.name };
}

export { extractShopNames } from './text-amap.js';
export type { ParseInput, ParseResult, SourceAdapter };
