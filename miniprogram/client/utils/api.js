"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureLogin = ensureLogin;
exports.request = request;
exports.openNavigation = openNavigation;
exports.buildQuery = buildQuery;
const config_1 = require("./config");
function getAppSafe() {
    return getApp();
}
async function ensureLogin() {
    const app = getAppSafe();
    if (app.globalData.token)
        return app.globalData.token;
    const cached = wx.getStorageSync('session_token');
    if (cached) {
        app.globalData.token = cached;
        return cached;
    }
    const loginRes = await new Promise((resolve, reject) => {
        wx.login({ success: resolve, fail: reject });
    });
    const data = await request('/api/auth/login', {
        method: 'POST',
        data: { code: loginRes.code || 'dev' },
        auth: false,
    });
    app.globalData.token = data.token;
    app.globalData.userId = data.user.id;
    wx.setStorageSync('session_token', data.token);
    return data.token;
}
async function request(path, options = {}) {
    const auth = options.auth !== false;
    let token = '';
    if (auth)
        token = await ensureLogin();
    return new Promise((resolve, reject) => {
        wx.request({
            url: `${config_1.API_BASE}${path}`,
            method: options.method || 'GET',
            data: options.data,
            header: Object.assign({ 'content-type': 'application/json' }, (token ? { Authorization: `Bearer ${token}` } : {})),
            success(res) {
                const status = res.statusCode || 0;
                const body = res.data;
                if (status >= 200 && status < 300) {
                    resolve(body);
                    return;
                }
                reject(new Error((body === null || body === void 0 ? void 0 : body.error) || `请求失败(${status})`));
            },
            fail(err) {
                reject(new Error(err.errMsg || '网络错误'));
            },
        });
    });
}
/** 打开外部地图导航（高德 / 腾讯 scheme，缺失坐标则提示） */
function openNavigation(shop) {
    if (shop.lat == null || shop.lng == null) {
        wx.showToast({ title: '暂无坐标', icon: 'none' });
        return;
    }
    const name = encodeURIComponent(shop.name);
    const amap = `https://uri.amap.com/navigation?to=${shop.lng},${shop.lat},${name}&mode=walk&src=opendianping`;
    wx.setClipboardData({
        data: amap,
        success() {
            wx.showModal({
                title: '导航链接已复制',
                content: '可粘贴到浏览器或高德 App 打开；小程序内也可使用下方地图选点。',
                confirmText: '打开地图',
                success(r) {
                    if (r.confirm) {
                        wx.openLocation({
                            latitude: shop.lat,
                            longitude: shop.lng,
                            name: shop.name,
                            address: shop.address || '',
                            scale: 16,
                        });
                    }
                },
            });
        },
    });
}
/**
 * 拼请求地址里 ? 后面的参数。
 * 小程序里没有浏览器的 URLSearchParams，直接 new 会在页面上报 ReferenceError。
 * 空值不写进地址，避免出现 lat=undefined。
 */
function buildQuery(params) {
    const parts = [];
    Object.keys(params).forEach((key) => {
        const value = params[key];
        if (value === undefined || value === null || value === '')
            return;
        parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
    });
    return parts.join('&');
}
