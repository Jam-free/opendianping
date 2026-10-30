/**
 * 店铺图展示约定。
 * 设计决策：缺图 / 加载失败时统一切本地兜底，不露出粗糙灰块；
 * 代理地址由服务端 headImgProxy 拼出，客户端不二次 encode。
 */
export const SHOP_PLACEHOLDER = '/assets/shop-placeholder.png';

export function shopImageSrc(
  apiBase: string,
  headImgProxy?: string | null
): string {
  if (headImgProxy) return `${apiBase}${headImgProxy}`;
  return SHOP_PLACEHOLDER;
}

/** 用户头像：本地上传路径需拼 API_BASE；http(s)/wxfile 原样用 */
export function userAvatarSrc(
  apiBase: string,
  avatar?: string | null
): string {
  if (!avatar) return '';
  if (avatar.startsWith('/api/')) return `${apiBase}${avatar}`;
  return avatar;
}
