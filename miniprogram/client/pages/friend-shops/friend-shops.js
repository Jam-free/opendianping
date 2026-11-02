"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const api_1 = require("../../utils/api");
const config_1 = require("../../utils/config");
const format_1 = require("../../utils/format");
const location_1 = require("../../utils/location");
const media_1 = require("../../utils/media");
Page({
    data: {
        circleId: '',
        memberId: '',
        friendName: '朋友',
        avatarSrc: '',
        initial: '友',
        shops: [],
        loading: true,
    },
    onLoad(query) {
        const circleId = query.c || '';
        const memberId = query.m || '';
        const friendName = query.n ? decodeURIComponent(query.n) : '朋友';
        const avatarRaw = query.a ? decodeURIComponent(query.a) : '';
        this.setData({
            circleId,
            memberId,
            friendName,
            avatarSrc: (0, media_1.userAvatarSrc)(config_1.API_BASE, avatarRaw) || avatarRaw,
            initial: (0, format_1.avatarInitial)(friendName),
        });
        wx.setNavigationBarTitle({ title: `${friendName}的收藏` });
        this.load();
    },
    onAvatarError() {
        this.setData({ avatarSrc: '' });
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
            const shops = (res.items || []).map((s) => (Object.assign(Object.assign({}, s), { 
                // 店铺行里的圈友头像也补全可访问地址
                collectors: (s.collectors || []).map((c) => (Object.assign(Object.assign({}, c), { avatar: (0, media_1.userAvatarSrc)(config_1.API_BASE, c.avatar) || c.avatar || '' }))) })));
            this.setData({
                shops,
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
        const from = this.data.memberId
            ? `&from=${encodeURIComponent(this.data.memberId)}`
            : '';
        wx.navigateTo({
            url: `/pages/shop-detail/shop-detail?c=${this.data.circleId}&p=${encodeURIComponent(shop.poiKey)}${from}`,
        });
    },
});
