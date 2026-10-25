import { config } from '../config.js';
import type { SourceAdapterName } from '../config.js';
import type { ParseInput, ParseResult, SourceAdapter } from './types.js';
import { TextAmapAdapter, extractShopNames } from './text-amap.js';
import { parseAlbumId } from './album-fetch.js';

/**
 * 懒加载：有专辑链接时强制走 opendianping（内置 album-fetch，不依赖根目录 lib）。
 */
const cache: Partial<Record<SourceAdapterName, SourceAdapter>> = {
  text_amap: new TextAmapAdapter(),
};

async function loadAdapter(name: SourceAdapterName): Promise<SourceAdapter> {
  const hit = cache[name];
  if (hit) return hit;

  if (name === 'opendianping') {
    const mod = await import('./opendianping.js');
    cache.opendianping = new mod.OpenDianpingAdapter();
    return cache.opendianping;
  }

  return cache.text_amap!;
}

export async function getAdapter(
  name: SourceAdapterName = config.sourceAdapter
): Promise<SourceAdapter> {
  return loadAdapter(name);
}

export async function parseUserInput(
  input: ParseInput,
  preferred?: SourceAdapterName
): Promise<ParseResult & { adapter: string }> {
  // 用户贴了专辑链接：必须走方案 A，不能被 text_amap 剥掉链接
  const hasAlbum = Boolean(parseAlbumId(input.text));
  const primaryName: SourceAdapterName = hasAlbum
    ? 'opendianping'
    : preferred || config.sourceAdapter;

  const primary = await getAdapter(primaryName);
  const result = await primary.parse(input);

  if (
    result.shops.length === 0 &&
    primaryName === 'opendianping' &&
    !hasAlbum
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
