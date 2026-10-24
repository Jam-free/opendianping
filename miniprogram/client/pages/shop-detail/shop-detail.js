"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const api_1 = require("../../utils/api");
const config_1 = require("../../utils/config");
const format_1 = require("../../utils/format");
const location_1 = require("../../utils/location");
Page({
    data: {
        circleId: '',
        poiKey: '',
        shop: null,
        dist: { main: '—', unit: '', na: true },
        metaLine: '',
        headImgFull: '',
        sourceLabel: '',
    },
    onLoad(query) {
        this.setData({
            circleId: query.c || '',
            poiKey: decodeURIComponent(query.p || ''),
        });
        this.load();
    },
    async load() {
        const loc = await (0, location_1.getUserLocation)();
        const query = (0, api_1.buildQuery)({
            lat: loc ? loc.lat : undefined,
            lng: loc ? loc.lng : undefined,
        });
        const qs = query ? `?${query}` : '';
        const res = await (0, api_1.request)(`/api/circles/${this.data.circleId}/shops/${encodeURIComponent(this.data.poiKey)}${qs}`);
        const shop = res.shop;
        const collectors = (shop.collectors || []).map((c) => (Object.assign(Object.assign({}, c), { initial: (0, format_1.avatarInitial)(c.nickname) })));
        const parts = [shop.category, shop.district].filter(Boolean);
        const labels = {
            dianping_album: '点评专辑',
            amap: '高德匹配',
            text: '文本识别',
            locate: '记美食',
            photo: '拍照记下',
        };
        const title = shop.name || '店铺详情';
        wx.setNavigationBarTitle({ title });
        this.setData({
            shop: Object.assign(Object.assign({}, shop), { collectors }),
            dist: (0, format_1.splitDistance)(shop.distanceLabel),
            metaLine: parts.join(' · '),
            headImgFull: shop.headImgProxy ? `${config_1.API_BASE}${shop.headImgProxy}` : '',
            sourceLabel: labels[shop.sourceType] || shop.sourceType,
        });
    },
    onNav() {
        (0, api_1.openNavigation)(this.data.shop);
    },
});
