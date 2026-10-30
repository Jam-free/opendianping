"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SHOP_PLACEHOLDER = void 0;
exports.shopImageSrc = shopImageSrc;
exports.userAvatarSrc = userAvatarSrc;
/**
 * 店铺图展示约定。
 * 设计决策：缺图 / 加载失败时统一切本地兜底，不露出粗糙灰块；
 * 代理地址由服务端 headImgProxy 拼出，客户端不二次 encode。
 */
exports.SHOP_PLACEHOLDER = '/assets/shop-placeholder.png';
function shopImageSrc(apiBase, headImgProxy) {
    if (headImgProxy)
        return `${apiBase}${headImgProxy}`;
    return exports.SHOP_PLACEHOLDER;
}
/** 用户头像：本地上传路径需拼 API_BASE；http(s)/wxfile 原样用 */
function userAvatarSrc(apiBase, avatar) {
    if (!avatar)
        return '';
    if (avatar.startsWith('/api/'))
        return `${apiBase}${avatar}`;
    return avatar;
}
