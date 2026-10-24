"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.clearSession = clearSession;
exports.ensureLogin = ensureLogin;
exports.request = request;
exports.openNavigation = openNavigation;
exports.buildQuery = buildQuery;
const config_1 = require("./config");
function getAppSafe() {
    return getApp();
}
/** 清掉本地会话，下次 ensureLogin 会重新向云端换票 */
function clearSession() {
    const app = getAppSafe();
    app.globalData.token = '';
    app.globalData.userId = '';
    try {
        wx.removeStorageSync('session_token');
    }
    catch (_a) {
        /* ignore */
    }
}
/**
 * 保证已登录。失败时弹窗说明原因，可点「重新登录」再试，而不是只闪一句「请先登录」。
 */
async function ensureLogin(opts) {
    const app = getAppSafe();
    if (!(opts === null || opts === void 0 ? void 0 : opts.force) && app.globalData.token)
        return app.globalData.token;
    if (!(opts === null || opts === void 0 ? void 0 : opts.force)) {
        const cached = wx.getStorageSync('session_token');
        if (cached) {
            app.globalData.token = cached;
            return cached;
        }
    }
    else {
        clearSession();
    }
    try {
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
    catch (err) {
        const msg = err.message || '登录失败';
        const retry = await new Promise((resolve) => {
            wx.showModal({
                title: '还不能进入',
                content: msg.includes('503') || msg.includes('不可用')
                    ? '云服务刚醒来或在重启，请稍等几秒再试。'
                    : msg === '请先登录'
                        ? '登录凭证失效了，点下方重新登录即可。'
                        : `${msg}\n\n若多次失败，请检查网络，或稍后重试。`,
                confirmText: '重新登录',
                cancelText: '取消',
                success: (r) => resolve(Boolean(r.confirm)),
            });
        });
        if (retry)
            return ensureLogin({ force: true });
        throw err;
    }
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
                // 会话失效：清票后让上层走重新登录
                if (status === 401 && auth) {
                    clearSession();
                }
                const errMsg = (body === null || body === void 0 ? void 0 : body.error) ||
                    (status === 503 ? '服务暂时不可用(503)' : `请求失败(${status})`);
                reject(new Error(errMsg));
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
                content: '可粘贴到浏览器或高德 App 打开；也可直接打开系统地图。',
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
