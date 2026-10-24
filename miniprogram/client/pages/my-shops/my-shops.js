"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const api_1 = require("../../utils/api");
const location_1 = require("../../utils/location");
const circle_1 = require("../../utils/circle");
Page({
    data: {
        loading: true,
        shops: [],
    },
    onShow() {
        this.load();
    },
    onPullDownRefresh() {
        this.load().finally(() => wx.stopPullDownRefresh());
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
