"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const api_1 = require("../../utils/api");
const circle_1 = require("../../utils/circle");
const location_1 = require("../../utils/location");
const format_1 = require("../../utils/format");
Page({
    data: {
        tab: 0,
        circles: [],
        circleNames: [],
        circleIndex: 0,
        activeCircleId: '',
        activeCircleName: '',
        shops: [],
        shopsNoCoord: [],
        noCoordSection: false,
        members: [],
        loading: false,
        locHint: '',
        loc: null,
    },
    onShow() {
        wx.showShareMenu({ withShareTicket: true, menus: ['shareAppMessage'] });
        this.bootstrap();
    },
    onPullDownRefresh() {
        this.bootstrap().finally(() => wx.stopPullDownRefresh());
    },
    async bootstrap() {
        var _a, _b;
        this.setData({ loading: true });
        try {
            const res = await (0, api_1.request)('/api/circles');
            const circles = res.items || [];
            let activeId = (0, circle_1.getActiveCircleId)();
            if (!circles.find((c) => c.id === activeId)) {
                activeId = ((_a = circles[0]) === null || _a === void 0 ? void 0 : _a.id) || '';
                if (activeId)
                    (0, circle_1.setActiveCircleId)(activeId);
            }
            const idx = Math.max(0, circles.findIndex((c) => c.id === activeId));
            this.setData({
                circles,
                circleNames: circles.map((c) => c.name),
                circleIndex: idx,
                activeCircleId: activeId,
                activeCircleName: ((_b = circles[idx]) === null || _b === void 0 ? void 0 : _b.name) || '',
            });
            if (!activeId) {
                this.setData({ loading: false });
                return;
            }
            const loc = await (0, location_1.getUserLocation)();
            let locHint = '';
            if (!loc) {
                locHint = '未开启定位：店铺按名称排序。可在系统设置中开启位置权限以按距离排序。';
            }
            this.setData({ loc, locHint });
            await Promise.all([this.loadShops(activeId, loc), this.loadMembers(activeId)]);
        }
        catch (err) {
            wx.showToast({ title: err.message, icon: 'none' });
        }
        finally {
            this.setData({ loading: false });
        }
    },
    async loadShops(circleId, loc) {
        const qs = (0, api_1.buildQuery)({
            pageSize: '200',
            lat: loc ? loc.lat : undefined,
            lng: loc ? loc.lng : undefined,
        });
        const res = await (0, api_1.request)(`/api/circles/${circleId}/shops?${qs}`);
        const items = res.items || [];
        const shops = items.filter((s) => s.hasCoords);
        const shopsNoCoord = items.filter((s) => !s.hasCoords);
        this.setData({
            shops,
            shopsNoCoord,
            noCoordSection: shops.length > 0 && shopsNoCoord.length > 0,
        });
    },
    async loadMembers(circleId) {
        const res = await (0, api_1.request)(`/api/circles/${circleId}/members`);
        const members = (res.items || []).map((m) => (Object.assign(Object.assign({}, m), { initial: (0, format_1.avatarInitial)(m.nickname) })));
        this.setData({ members });
    },
    switchTab(e) {
        this.setData({ tab: Number(e.currentTarget.dataset.tab) });
    },
    onCirclePick(e) {
        const idx = Number(e.detail.value);
        const circle = this.data.circles[idx];
        if (!circle)
            return;
        (0, circle_1.setActiveCircleId)(circle.id);
        this.setData({
            circleIndex: idx,
            activeCircleId: circle.id,
            activeCircleName: circle.name,
        });
        this.loadShops(circle.id, this.data.loc);
        this.loadMembers(circle.id);
    },
    openShop(e) {
        var _a;
        const shop = (_a = e === null || e === void 0 ? void 0 : e.detail) === null || _a === void 0 ? void 0 : _a.shop;
        if (!(shop === null || shop === void 0 ? void 0 : shop.poiKey) || !this.data.activeCircleId) {
            wx.showToast({ title: '店铺信息还没准备好', icon: 'none' });
            return;
        }
        const q = encodeURIComponent(shop.poiKey);
        wx.navigateTo({
            url: `/pages/shop-detail/shop-detail?c=${this.data.activeCircleId}&p=${q}`,
        });
    },
    openFriend(e) {
        const id = e.currentTarget.dataset.id;
        const name = e.currentTarget.dataset.name || '圈友';
        wx.navigateTo({
            url: `/pages/friend-shops/friend-shops?c=${this.data.activeCircleId}&m=${id}&n=${encodeURIComponent(name)}`,
        });
    },
    async goCreateCircle() {
        const res = await new Promise((resolve) => {
            wx.showModal({
                title: '创建收藏圈',
                editable: true,
                placeholderText: '给圈子起个名字',
                success: resolve,
                fail: () => resolve({ confirm: false, cancel: true, content: '' }),
            });
        });
        if (!res.confirm || !res.content)
            return;
        try {
            const circle = await (0, api_1.request)('/api/circles', {
                method: 'POST',
                data: { name: res.content },
            });
            (0, circle_1.setActiveCircleId)(circle.id);
            this.bootstrap();
        }
        catch (err) {
            wx.showToast({ title: err.message, icon: 'none' });
        }
    },
});
