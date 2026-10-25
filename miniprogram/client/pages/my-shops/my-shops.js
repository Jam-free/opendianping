"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const api_1 = require("../../utils/api");
const location_1 = require("../../utils/location");
const circle_1 = require("../../utils/circle");
const format_1 = require("../../utils/format");
/**
 * 「我的店」：默认主页。核心路径是导入/看收藏；顶栏头像进账号可撤权。
 */
Page({
    data: {
        loading: true,
        shops: [],
        avatar: '',
        initial: '?',
    },
    onShow() {
        if (!(0, api_1.hasSession)()) {
            (0, api_1.goLoginGate)();
            return;
        }
        this.hydrateMe();
        this.load();
    },
    onPullDownRefresh() {
        this.load().finally(() => wx.stopPullDownRefresh());
    },
    hydrateMe() {
        const cached = (0, api_1.peekCachedUser)();
        if (cached) {
            this.setData({
                avatar: cached.avatar || '',
                initial: (0, format_1.avatarInitial)(cached.nickname),
            });
        }
        (0, api_1.request)('/api/me')
            .then((me) => {
            (0, api_1.saveCachedUser)(me.user);
            this.setData({
                avatar: me.user.avatar || '',
                initial: (0, format_1.avatarInitial)(me.user.nickname),
            });
        })
            .catch(() => {
            /* 401 会踢回登录 */
        });
    },
    async load() {
        this.setData({ loading: true });
        try {
            const loc = await (0, location_1.getUserLocation)();
            const qs = (0, api_1.buildQuery)({
                lat: loc ? loc.lat : undefined,
                lng: loc ? loc.lng : undefined,
            });
            const res = await (0, api_1.request)(`/api/me/shops${qs ? `?${qs}` : ''}`);
            this.setData({ shops: res.items || [], loading: false });
        }
        catch (err) {
            this.setData({ loading: false });
            wx.showToast({ title: err.message, icon: 'none' });
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
    openShop(e) {
        const shop = e.detail.shop;
        const circleId = (0, circle_1.getActiveCircleId)();
        if (circleId && shop.poiKey) {
            wx.navigateTo({
                url: `/pages/shop-detail/shop-detail?c=${circleId}&p=${encodeURIComponent(shop.poiKey)}`,
            });
            return;
        }
        wx.showToast({ title: shop.name || '店铺', icon: 'none' });
    },
});
