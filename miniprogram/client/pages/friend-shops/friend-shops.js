"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const api_1 = require("../../utils/api");
const location_1 = require("../../utils/location");
Page({
    data: {
        circleId: '',
        memberId: '',
        shops: [],
        loading: true,
    },
    onLoad(query) {
        const circleId = query.c || '';
        const memberId = query.m || '';
        const name = query.n ? decodeURIComponent(query.n) : '朋友';
        this.setData({ circleId, memberId });
        wx.setNavigationBarTitle({ title: `${name} 的收藏` });
        this.load();
    },
    async load() {
        this.setData({ loading: true });
        try {
            const loc = await (0, location_1.getUserLocation)();
            const qs = (0, api_1.buildQuery)({
                pageSize: '200',
                memberId: this.data.memberId,
                lat: loc ? loc.lat : undefined,
                lng: loc ? loc.lng : undefined,
            });
            const res = await (0, api_1.request)(`/api/circles/${this.data.circleId}/shops?${qs}`);
            this.setData({
                shops: res.items || [],
                loading: false,
            });
        }
        catch (err) {
            this.setData({ loading: false });
            wx.showToast({ title: err.message, icon: 'none' });
        }
    },
    openShop(e) {
        var _a;
        const shop = (_a = e === null || e === void 0 ? void 0 : e.detail) === null || _a === void 0 ? void 0 : _a.shop;
        if (!(shop === null || shop === void 0 ? void 0 : shop.poiKey) || !this.data.circleId) {
            wx.showToast({ title: '店铺信息还没准备好', icon: 'none' });
            return;
        }
        wx.navigateTo({
            url: `/pages/shop-detail/shop-detail?c=${this.data.circleId}&p=${encodeURIComponent(shop.poiKey)}`,
        });
    },
});
