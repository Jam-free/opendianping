/** 适配器统一输出字段：前端卡片只依赖这些，缺失则隐藏 */
export interface ParsedShop {
  name: string;
  address?: string;
  avgPrice?: string;
  category?: string;
  district?: string;
  city?: string;
  lat?: number;
  lng?: number;
  /** 仅来自真实数据源；禁止编造 */
  sourceShopId?: string;
  amapPoiId?: string;
  sourceUrl?: string;
  /** 点评 headImg；仅透传真实 URL，展示经后端代理 */
  headImg?: string;
  sourceType: 'dianping_album' | 'amap' | 'video' | 'photo' | 'text';
  /** 来源标签展示用 */
  sourceLabel: string;
}

export type FavoriteVisibility = 'private' | 'circles';
export type CircleRole = 'owner' | 'member';
export type SourceType = ParsedShop['sourceType'];

export interface UserRow {
  id: string;
  openid: string;
  unionid: string | null;
  nickname: string | null;
  avatar: string | null;
  created_at: string;
}

export interface ShopRow {
  id: string;
  source_type: SourceType;
  source_shop_id: string | null;
  amap_poi_id: string | null;
  raw_name: string;
  adcode: string | null;
  category: string | null;
  district: string | null;
  city: string | null;
  address: string | null;
  avg_price: string | null;
  lat: number | null;
  lng: number | null;
  source_url: string | null;
  display_cache_policy: string;
}

export interface FavoriteRow {
  id: string;
  user_id: string;
  shop_id: string;
  note: string | null;
  visibility: FavoriteVisibility;
  import_batch_id: string | null;
  created_at: string;
}

export interface CircleRow {
  id: string;
  name: string;
  owner_id: string;
  invite_token: string;
  token_expires_at: string;
  opengid: string | null;
  member_limit: number;
  created_at: string;
}

export interface AuthedRequest {
  userId: string;
  openid: string;
}
