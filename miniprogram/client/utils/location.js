"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getUserLocation = getUserLocation;
exports.shouldRefreshLocation = shouldRefreshLocation;
const LAST_KEY = 'last_location';
/** 获取 GCJ-02 坐标；用户坐标仅内存/本地缓存，不上传落库 */
async function getUserLocation() {
    try {
        const res = await new Promise((resolve, reject) => {
            wx.getLocation({ type: 'gcj02', success: resolve, fail: reject });
        });
        const loc = { lat: res.latitude, lng: res.longitude };
        wx.setStorageSync(LAST_KEY, loc);
        return loc;
    }
    catch (_a) {
        const cached = wx.getStorageSync(LAST_KEY);
        return (cached === null || cached === void 0 ? void 0 : cached.lat) != null ? cached : null;
    }
}
function shouldRefreshLocation(prev, next) {
    if (!prev)
        return true;
    const dLat = (next.lat - prev.lat) * 111320;
    const dLng = (next.lng - prev.lng) *
        111320 *
        Math.cos((next.lat * Math.PI) / 180);
    return Math.hypot(dLat, dLng) > 500;
}
