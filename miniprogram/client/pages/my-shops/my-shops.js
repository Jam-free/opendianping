"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const api_1 = require("../../utils/api");
const location_1 = require("../../utils/location");
const circle_1 = require("../../utils/circle");
const format_1 = require("../../utils/format");
const config_1 = require("../../utils/config");
const media_1 = require("../../utils/media");
function friendAvatarSrc(avatar) {
    if (!avatar)
        return '';
    if (avatar.startsWith('/api/'))
        return `${config_1.API_BASE}${avatar}`;
    return avatar;
}
/**
 * 双主页壳：私藏好店 ↔ 吃货排行。
 * 顶部大/小标题对调 + 内容区左右滑；底栏悬浮条两页共用。
 */
Page({
    data: {
        panel: 0,
        statusPad: 48,
        shopsLoading: true,
        friendsLoading: true,
        shops: [],
        friends: [],
        networkId: '',
        inviteToken: '',
        loginError: '',
        avatar: '',
        initial: '?',
    },
    onLoad(query) {
        var _a, _b;
        const panel = query.panel === '1' || query.panel === 'rank' ? 1 : 0;
        // 自定义顶栏：避开状态栏；头像尽量对齐右上角胶囊
        try {
            const wxAny = wx;
            const sys = ((_a = wxAny.getSystemInfoSync) === null || _a === void 0 ? void 0 : _a.call(wxAny)) || {};
            const menu = ((_b = wxAny.getMenuButtonBoundingClientRect) === null || _b === void 0 ? void 0 : _b.call(wxAny)) || {};
            // 标题行垂直对齐胶囊中线附近，整体更贴系统顶栏
            const statusPad = menu.bottom
                ? Math.max(menu.bottom - 6, (sys.statusBarHeight || 20) + 8)
                : (sys.statusBarHeight || 20) + 12;
            this.setData(Object.assign({ statusPad }, (panel ? { panel } : {})));
        }
        catch (_c) {
            if (panel)
                this.setData({ panel });
        }
    },
    onShow() {
        if (!(0, api_1.hasSession)()) {
            (0, api_1.goLoginGate)();
            return;
        }
        wx.showShareMenu({ withShareTicket: true, menus: ['shareAppMessage'] });
        this.hydrateMe();
        this.loadShops();
        this.loadFriends();
    },
    goPanel(e) {
        const panel = Number(e.currentTarget.dataset.panel);
        if (panel !== 0 && panel !== 1)
            return;
        if (panel === this.data.panel)
            return;
        this.setData({ panel: panel });
    },
    onSwipe(e) {
        const panel = Number(e.detail.current);
        if (panel === this.data.panel)
            return;
        this.setData({ panel });
    },
    hydrateMe() {
        const cached = (0, api_1.peekCachedUser)();
        if (cached) {
            this.setData({
                avatar: (0, media_1.userAvatarSrc)(config_1.API_BASE, cached.avatar),
                initial: (0, format_1.avatarInitial)(cached.nickname),
            });
        }
        (0, api_1.request)('/api/me')
            .then((me) => {
            (0, api_1.saveCachedUser)(me.user);
            this.setData({
                avatar: (0, media_1.userAvatarSrc)(config_1.API_BASE, me.user.avatar),
                initial: (0, format_1.avatarInitial)(me.user.nickname),
            });
        })
            .catch(() => {
            /* 401 会踢回登录 */
        });
    },
    async ensureCircleId() {
        const cached = (0, circle_1.getActiveCircleId)();
        if (cached)
            return cached;
        try {
            const net = await (0, api_1.request)('/api/me/network');
            if (net.networkId) {
                (0, circle_1.setActiveCircleId)(net.networkId);
                return net.networkId;
            }
        }
        catch (_a) {
            /* ignore */
        }
        return '';
    },
    async loadShops() {
        this.setData({ shopsLoading: true });
        try {
            await this.ensureCircleId();
            const loc = await (0, location_1.getUserLocation)();
            const qs = (0, api_1.buildQuery)({
                lat: loc ? loc.lat : undefined,
                lng: loc ? loc.lng : undefined,
            });
            const res = await (0, api_1.request)(`/api/me/shops${qs ? `?${qs}` : ''}`);
            this.setData({ shops: res.items || [], shopsLoading: false });
        }
        catch (err) {
            this.setData({ shopsLoading: false });
            wx.showToast({ title: err.message, icon: 'none' });
        }
    },
    async loadFriends() {
        this.setData({ friendsLoading: true, loginError: '' });
        try {
            const net = await (0, api_1.request)('/api/me/network');
            (0, circle_1.setActiveCircleId)(net.networkId);
            // 吃货排行：共享店数多的靠前
            const friends = (net.friends || [])
                .map((f) => (Object.assign(Object.assign({}, f), { avatarSrc: friendAvatarSrc(f.avatar), initial: (0, format_1.avatarInitial)(f.nickname) })))
                .sort((a, b) => b.sharedShopCount - a.sharedShopCount);
            this.setData({
                friends,
                networkId: net.networkId,
                inviteToken: net.inviteToken,
                friendsLoading: false,
                loginError: '',
            });
        }
        catch (err) {
            const msg = err.message || '加载失败';
            this.setData({
                friendsLoading: false,
                loginError: msg.includes('登录') || msg.includes('401')
                    ? '登录已失效，点此重新登录'
                    : msg.includes('503') || msg.includes('不可用')
                        ? '服务暂时繁忙，点此重试'
                        : `${msg} · 点此重试`,
            });
        }
    },
    async retryLogin() {
        try {
            await (0, api_1.ensureLogin)({ force: true, interactive: true });
            this.setData({ loginError: '' });
            await this.loadFriends();
        }
        catch (_a) {
            /* 登录页会展示错误 */
        }
    },
    goAccount() {
        wx.navigateTo({ url: '/pages/account/account' });
    },
    goImport() {
        wx.navigateTo({ url: '/pages/import/import' });
    },
    goConnectAi() {
        wx.navigateTo({ url: '/pages/connect-ai/connect-ai' });
    },
    goLocate() {
        wx.navigateTo({ url: '/pages/locate-note/locate-note' });
    },
    /** 长按店铺行 → 确认后从「我的店」移除 */
    onDeleteShop(e) {
        var _a;
        const shop = (_a = e === null || e === void 0 ? void 0 : e.detail) === null || _a === void 0 ? void 0 : _a.shop;
        const favoriteId = (shop === null || shop === void 0 ? void 0 : shop.favoriteId) || '';
        if (!favoriteId) {
            wx.showToast({ title: '这条还不能删', icon: 'none' });
            return;
        }
        const name = ((shop === null || shop === void 0 ? void 0 : shop.name) || '这家店').slice(0, 20);
        wx.showModal({
            title: '删除这家店？',
            content: `「${name}」会从你的私藏里移除，好友那边也不再看到你分享的这家。`,
            confirmText: '删除',
            confirmColor: '#e05a5a',
            success: async (r) => {
                if (!r.confirm)
                    return;
                try {
                    await (0, api_1.request)(`/api/favorites/${encodeURIComponent(favoriteId)}`, {
                        method: 'DELETE',
                    });
                    this.setData({
                        shops: (this.data.shops || []).filter((s) => s.favoriteId !== favoriteId),
                    });
                    wx.showToast({ title: '已删除', icon: 'success' });
                }
                catch (err) {
                    wx.showToast({ title: err.message, icon: 'none' });
                }
            },
        });
    },
    onShareAppMessage() {
        const { networkId, inviteToken } = this.data;
        if (!networkId || !inviteToken) {
            return {
                title: '我和我爱吃的朋友们 · 一起收藏好店',
                path: '/pages/my-shops/my-shops',
            };
        }
        return {
            title: '来我和我爱吃的朋友们，一起共享收藏的店',
            path: `/pages/join/join?c=${networkId}&t=${inviteToken}`,
        };
    },
    openFriend(e) {
        const id = String(e.currentTarget.dataset.id || '');
        const name = encodeURIComponent(String(e.currentTarget.dataset.name || '朋友'));
        wx.navigateTo({
            url: `/pages/friend-shops/friend-shops?c=${this.data.networkId}&m=${id}&n=${name}`,
        });
    },
    async openShop(e) {
        var _a;
        const shop = (_a = e === null || e === void 0 ? void 0 : e.detail) === null || _a === void 0 ? void 0 : _a.shop;
        if (!shop || !shop.poiKey) {
            wx.showToast({ title: '店铺信息还没准备好', icon: 'none' });
            return;
        }
        const circleId = await this.ensureCircleId();
        if (!circleId) {
            wx.showToast({ title: '美食网还没就绪，稍后再试', icon: 'none' });
            return;
        }
        wx.navigateTo({
            url: `/pages/shop-detail/shop-detail?c=${circleId}&p=${encodeURIComponent(shop.poiKey)}`,
        });
    },
});
