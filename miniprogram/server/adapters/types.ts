import type { ParsedShop } from '../types.js';

export interface ParseInput {
  /** 用户粘贴的专辑链接或自由文本 */
  text: string;
  /** 测试/离线：强制走 fixtures，不打外网 */
  useFixtures?: boolean;
}

export interface ParseResult {
  shops: ParsedShop[];
  /** 专辑 id（仅方案 A 成功解析链接时） */
  albumId?: string;
  sourceType: ParsedShop['sourceType'];
  truncated: boolean;
  message?: string;
}

/**
 * 数据来源适配器：可替换实现，前端不感知具体来源。
 * 约束：不得编造 shopId / amap_poi_id；没有就留空。
 */
export interface SourceAdapter {
  readonly name: string;
  parse(input: ParseInput): Promise<ParseResult>;
}
