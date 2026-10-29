"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const api_1 = require("../../utils/api");
const config_1 = require("../../utils/config");
const format_1 = require("../../utils/format");
const location_1 = require("../../utils/location");
const media_1 = require("../../utils/media");
/** 拼点评店铺页；优先接口里的真实链接，否则用店铺 ID 兜底 */
function buildDianpingUrl(shop) {
    if (shop.sourceUrl && /^https?:\/\//i.test(shop.sourceUrl)) {
        return shop.sourceUrl;
    }
    const id = shop.sourceShopId || shop.poiKey || '';
    if (id &&
        (shop.sourceType === 'dianping_album' || /^\d+$/.test(id) || /^[A-Za-z0-9_-]+$/.test(id))) {
        return `https://m.dianping.com/shop/${encodeURIComponent(id)}`;
    }
    return '';
}
Page({
    data: {
        circleId: '',
        poiKey: '',
        shop: null,
        dist: { main: '—', unit: '', na: true },
        metaLine: '',
        displaySrc: media_1.SHOP_PLACEHOLDER,
        sourceLabel: '',
        dianpingUrl: '',
        friendNotes: [],
        draftNote: '',
        savingNote: false,
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
        const friendNotes = (shop.collectors || []).map((c) => (Object.assign(Object.assign({}, c), { initial: (0, format_1.avatarInitial)(c.nickname) })));
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
            shop,
            dist: (0, format_1.splitDistance)(shop.distanceLabel),
            metaLine: parts.join(' · '),
            displaySrc: (0, media_1.shopImageSrc)(config_1.API_BASE, shop.headImgProxy),
            sourceLabel: labels[shop.sourceType] || shop.sourceType,
            dianpingUrl: buildDianpingUrl(shop),
            friendNotes,
            draftNote: shop.myNote || '',
        });
    },
    onImgError() {
        if (this.data.displaySrc === media_1.SHOP_PLACEHOLDER)
            return;
        this.setData({ displaySrc: media_1.SHOP_PLACEHOLDER });
    },
    onNoteInput(e) {
        this.setData({ draftNote: e.detail.value });
    },
    async saveNote() {
        if (!this.data.circleId || !this.data.poiKey)
            return;
        this.setData({ savingNote: true });
        try {
            await (0, api_1.request)(`/api/circles/${this.data.circleId}/favorites`, {
                method: 'POST',
                data: {
                    poiKey: this.data.poiKey,
                    note: this.data.draftNote || '',
                },
            });
            this.setData({ savingNote: false });
            wx.showToast({ title: '备注已保存' });
        }
        catch (err) {
            this.setData({ savingNote: false });
            wx.showToast({ title: err.message, icon: 'none' });
        }
    },
    openDianping() {
        const url = this.data.dianpingUrl;
        if (!url) {
            wx.showToast({ title: '暂无点评链接', icon: 'none' });
            return;
        }
        // 小程序不能直接打开外链：复制后可粘贴到浏览器 / 点评 App
        wx.setClipboardData({
            data: url,
            success() {
                wx.showModal({
                    title: '点评链接已复制',
                    content: '打开浏览器或大众点评 App，粘贴即可查看这家店。',
                    showCancel: false,
                    confirmText: '知道了',
                });
            },
        });
    },
    onNav() {
        (0, api_1.openNavigation)(this.data.shop);
    },
});
