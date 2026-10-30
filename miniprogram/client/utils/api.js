"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.hasSession = hasSession;
exports.peekCachedUser = peekCachedUser;
exports.saveCachedUser = saveCachedUser;
exports.clearSession = clearSession;
exports.goLoginGate = goLoginGate;
exports.enterAppAfterLogin = enterAppAfterLogin;
exports.ensureLogin = ensureLogin;
exports.logoutAndLeave = logoutAndLeave;
exports.request = request;
exports.openNavigation = openNavigation;
exports.buildQuery = buildQuery;
const config_1 = require("./config");
const cloud_1 = require("./cloud");
function getAppSafe() {
    return getApp();
}
const USER_KEY = 'session_user';
/** 是否已有本地登录票（未验服务端） */
function hasSession() {
    const app = getAppSafe();
    if (app.globalData.token)
        return true;
    try {
        return Boolean(wx.getStorageSync('session_token'));
    }
    catch (_a) {
        return false;
    }
}
function peekCachedUser() {
    const app = getAppSafe();
    if (app.globalData.user)
        return app.globalData.user;
    try {
        const raw = wx.getStorageSync(USER_KEY);
        if (raw && typeof raw === 'object') {
            app.globalData.user = raw;
            return raw;
        }
    }
    catch (_a) {
        /* ignore */
    }
    return null;
}
function saveCachedUser(user) {
    const app = getAppSafe();
    app.globalData.user = user;
    app.globalData.userId = user.id || '';
    try {
        wx.setStorageSync(USER_KEY, user);
    }
    catch (_a) {
        /* ignore */
    }
}
/** 清掉本地会话，下次需重新走登录引导页 */
function clearSession() {
    const app = getAppSafe();
    app.globalData.token = '';
    app.globalData.userId = '';
    app.globalData.user = null;
    try {
        wx.removeStorageSync('session_token');
        wx.removeStorageSync(USER_KEY);
    }
    catch (_a) {
        /* ignore */
    }
}
/**
 * 跳回登录门禁（退出 / 票失效）。
 * 若当前在邀请页，先记下参数，登录成功后回到加入流程。
 */
function goLoginGate() {
    try {
        const pages = getCurrentPages();
        const cur = pages[pages.length - 1];
        if ((cur === null || cur === void 0 ? void 0 : cur.route) === 'pages/join/join' && cur.options) {
            wx.setStorageSync('pending_join', {
                c: cur.options.c || '',
                t: cur.options.t || '',
            });
        }
    }
    catch (_a) {
        /* ignore */
    }
    clearSession();
    wx.reLaunch({ url: '/pages/login/login' });
}
/** 登录成功后的去向：有未完成的邀请则回加入页，否则进「我的店」 */
function enterAppAfterLogin() {
    try {
        const pending = wx.getStorageSync('pending_join');
        if (pending && pending.c) {
            wx.removeStorageSync('pending_join');
            wx.redirectTo({
                url: `/pages/join/join?c=${pending.c}&t=${pending.t || ''}`,
            });
            return;
        }
    }
    catch (_a) {
        /* ignore */
    }
    wx.switchTab({ url: '/pages/my-shops/my-shops' });
}
/**
 * 保证已登录。
 * - 有本地票：直接返回（由业务接口 401 再踢回登录页）
 * - 无票且非 interactive：不静默登录，抛错（强制门禁）
 * - interactive（登录页按钮）：走 wx.login 换票
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
    if (!(opts === null || opts === void 0 ? void 0 : opts.interactive) && !(opts === null || opts === void 0 ? void 0 : opts.force)) {
        throw new Error('请先登录');
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
        saveCachedUser(data.user);
        wx.setStorageSync('session_token', data.token);
        return data.token;
    }
    catch (err) {
        // 登录页自己展示错误；其它场景弹窗可重试
        if (opts === null || opts === void 0 ? void 0 : opts.interactive)
            throw err;
        const msg = err.message || '登录失败';
        const retry = await new Promise((resolve) => {
            wx.showModal({
                title: '还不能进入',
                content: msg.includes('503') || msg.includes('不可用')
                    ? '云服务刚醒来或在重启，请稍等几秒再试。'
                    : msg === '请先登录'
                        ? '登录凭证失效了，点下方重新登录即可。'
                        : `${msg}\n\n若多次失败，请检查网络，或稍后重试。`,
                confirmText: '去登录',
                cancelText: '取消',
                success: (r) => resolve(Boolean(r.confirm)),
            });
        });
        if (retry) {
            goLoginGate();
            throw err;
        }
        throw err;
    }
}
/**
 * 退出登录 / 撤销授权：通知服务端废票 + 清本地，回到登录引导。
 */
async function logoutAndLeave() {
    try {
        await request('/api/auth/logout', { method: 'POST' });
    }
    catch (_a) {
        /* 即使服务端失败，本地也必须清干净 */
    }
    goLoginGate();
}
async function request(path, options = {}) {
    const auth = options.auth !== false;
    let token = '';
    if (auth) {
        if (!hasSession()) {
            goLoginGate();
            throw new Error('请先登录');
        }
        token = await ensureLogin();
    }
    // 资源复用：必须用带 resourceAppid 的 Cloud 实例，不能直接 wx.cloud.callContainer
    const cloud = await (0, cloud_1.getSharedCloud)();
    return new Promise((resolve, reject) => {
        cloud.callContainer({
            config: { env: config_1.CLOUD_ENV },
            path,
            method: options.method || 'GET',
            header: Object.assign({ 'X-WX-SERVICE': config_1.CLOUD_SERVICE, 'content-type': 'application/json' }, (token ? { Authorization: `Bearer ${token}` } : {})),
            data: options.data,
            timeout: 15000,
            success(res) {
                const status = res.statusCode || res.status || 0;
                const body = res.data;
                if (status >= 200 && status < 300) {
                    resolve(body);
                    return;
                }
                if (status === 401 && auth) {
                    goLoginGate();
                }
                const errMsg = (body && body.error) ||
                    (status === 503 ? '服务暂时不可用(503)' : `请求失败(${status})`);
                reject(new Error(errMsg));
            },
            fail(err) {
                const raw = (err === null || err === void 0 ? void 0 : err.errMsg) || '';
                const code = err === null || err === void 0 ? void 0 : err.errCode;
                if (/resourceAppid|Authorization mismatch|Invalid AppId/i.test(raw)) {
                    reject(new Error('还没连上美食探索的云，请确认资源复用已关联'));
                    return;
                }
                if (code === -606001 ||
                    /-606001/.test(raw) ||
                    /request entity too large|payload too large|100\s*K/i.test(raw)) {
                    reject(new Error('这次带的内容太大（照片常见），请换小一点的图再试'));
                    return;
                }
                if (/102002|timeout/i.test(raw)) {
                    reject(new Error('云服务醒来有点慢，再点一次试试'));
                    return;
                }
                if (/invalid_host|service|not exist/i.test(raw)) {
                    reject(new Error('云服务名对不上，请确认是 feimaocat-api'));
                    return;
                }
                reject(new Error(raw || '网络错误'));
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
