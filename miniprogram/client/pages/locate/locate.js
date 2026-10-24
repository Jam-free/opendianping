"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const api_1 = require("../../utils/api");
const circle_1 = require("../../utils/circle");
const location_1 = require("../../utils/location");
Page({
    data: {
        circleId: '',
        shops: [],
    },
    onShow() {
        this.load();
    },
    async load() {
        const circleId = (0, circle_1.getActiveCircleId)();
        if (!circleId) {
            wx.showToast({ title: '请先创建或加入圈子', icon: 'none' });
            return;
        }
        this.setData({ circleId });
        const loc = await (0, location_1.getUserLocation)();
        if (!loc) {
            wx.showModal({
                title: '需要定位',
                content: '记美食需要获取当前位置，请在设置中开启定位权限。',
                showCancel: false,
            });
            return;
        }
        const qs = (0, api_1.buildQuery)({
            pageSize: '50',
            lat: loc.lat,
            lng: loc.lng,
        });
        const res = await (0, api_1.request)(`/api/circles/${circleId}/shops?${qs}`);
        const shops = (res.items || []).filter((s) => s.hasCoords).slice(0, 20);
        this.setData({ shops });
    },
    pickShop(e) {
        const shop = e.detail.shop;
        wx.navigateTo({
            url: `/pages/locate-note/locate-note?c=${this.data.circleId}&p=${encodeURIComponent(shop.poiKey)}&name=${encodeURIComponent(shop.name)}`,
        });
    },
});
