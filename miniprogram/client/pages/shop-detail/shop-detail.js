"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const api_1 = require("../../utils/api");
const config_1 = require("../../utils/config");
const format_1 = require("../../utils/format");
const location_1 = require("../../utils/location");
const media_1 = require("../../utils/media");
/**
 * 有真实点评链接才返回；自己记下的店（locate/photo）没有链接，不要硬拼。
 * 避免用内部 UUID 冒充点评 shopId，否则会误显示点评图标。
 */
function buildDianpingUrl(shop) {
    if (shop.sourceType === 'locate' || shop.sourceType === 'photo') {
        return '';
    }
    if (shop.sourceUrl && /^https?:\/\//i.test(shop.sourceUrl)) {
        return shop.sourceUrl;
    }
    // 仅点评导入且带有来源店铺 ID 时才拼移动站链接
    const id = (shop.sourceShopId || '').trim();
    if (shop.sourceType === 'dianping_album' && id) {
        return `https://m.dianping.com/shop/${encodeURIComponent(id)}`;
    }
    return '';
}
function timeLabel(iso) {
    if (!iso)
        return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime()))
        return '';
    const m = `${d.getMonth() + 1}`.padStart(2, '0');
    const day = `${d.getDate()}`.padStart(2, '0');
    const h = `${d.getHours()}`.padStart(2, '0');
    const min = `${d.getMinutes()}`.padStart(2, '0');
    return `${m}-${day} ${h}:${min}`;
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
        comments: [],
        draftComment: '',
        sending: false,
        wishlist: false,
        canEditCheckin: false,
        canDelete: false,
        canNav: false,
    },
    onLoad(query) {
        this.setData({
            circleId: query.c || '',
            poiKey: decodeURIComponent(query.p || ''),
        });
        this.load();
    },
    onShow() {
        // 从「改记美食」回来时刷新
        if (this.data.poiKey)
            this.loadComments();
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
        const parts = [shop.category, shop.district].filter(Boolean);
        const labels = {
            dianping_album: '大众点评',
            amap: '高德匹配',
            text: '文本识别',
            locate: '记美食',
            photo: '拍照记下',
        };
        wx.setNavigationBarTitle({ title: shop.name || '店铺详情' });
        this.setData({
            shop,
            dist: (0, format_1.splitDistance)(shop.distanceLabel),
            metaLine: parts.join(' · '),
            displaySrc: (0, media_1.shopImageSrc)(config_1.API_BASE, shop.headImgProxy),
            sourceLabel: labels[shop.sourceType] || shop.sourceType || '未知',
            dianpingUrl: buildDianpingUrl(shop),
            wishlist: Boolean(shop.wishlist),
            canEditCheckin: (shop.sourceType === 'locate' || shop.sourceType === 'photo') &&
                Boolean(shop.myFavoriteId),
            // 只要是自己收藏/记下的，就可以从私藏里删掉
            canDelete: Boolean(shop.myFavoriteId),
            canNav: shop.lat != null && shop.lng != null,
        });
        await this.loadComments();
    },
    async loadComments() {
        if (!this.data.poiKey)
            return;
        try {
            const res = await (0, api_1.request)(`/api/shops/${encodeURIComponent(this.data.poiKey)}/comments`);
            const comments = (res.items || []).map((c) => (Object.assign(Object.assign({}, c), { initial: (0, format_1.avatarInitial)(c.nickname), timeLabel: timeLabel(c.createdAt) })));
            this.setData({ comments });
        }
        catch (_a) {
            /* 评论失败不挡详情 */
        }
    },
    onImgError() {
        if (this.data.displaySrc === media_1.SHOP_PLACEHOLDER)
            return;
        this.setData({ displaySrc: media_1.SHOP_PLACEHOLDER });
    },
    onCommentInput(e) {
        this.setData({ draftComment: e.detail.value });
    },
    async sendComment() {
        const body = (this.data.draftComment || '').trim();
        if (!body) {
            wx.showToast({ title: '先写一句', icon: 'none' });
            return;
        }
        this.setData({ sending: true });
        try {
            await (0, api_1.request)(`/api/shops/${encodeURIComponent(this.data.poiKey)}/comments`, { method: 'POST', data: { body } });
            this.setData({ draftComment: '', sending: false });
            await this.loadComments();
        }
        catch (err) {
            this.setData({ sending: false });
            wx.showToast({ title: err.message, icon: 'none' });
        }
    },
    async toggleWishlist() {
        const next = !this.data.wishlist;
        this.setData({ wishlist: next });
        try {
            await (0, api_1.request)('/api/me/wishlist', {
                method: 'POST',
                data: { poiKey: this.data.poiKey, wishlist: next },
            });
            wx.showToast({
                title: next ? '已标心心念念' : '已取消心心念念',
                icon: 'none',
            });
        }
        catch (err) {
            this.setData({ wishlist: !next });
            wx.showToast({ title: err.message, icon: 'none' });
        }
    },
    goEditCheckin() {
        var _a;
        const fav = (_a = this.data.shop) === null || _a === void 0 ? void 0 : _a.myFavoriteId;
        if (!fav)
            return;
        wx.navigateTo({
            url: `/pages/locate-note/locate-note?fav=${encodeURIComponent(fav)}`,
        });
    },
    onDelete() {
        var _a, _b;
        const fav = (_a = this.data.shop) === null || _a === void 0 ? void 0 : _a.myFavoriteId;
        const name = (((_b = this.data.shop) === null || _b === void 0 ? void 0 : _b.name) || '这家店').slice(0, 20);
        if (!fav)
            return;
        wx.showModal({
            title: '删除这家店？',
            content: `「${name}」会从你的私藏里移除。`,
            confirmText: '删除',
            confirmColor: '#e05a5a',
            success: async (r) => {
                if (!r.confirm)
                    return;
                try {
                    await (0, api_1.request)(`/api/favorites/${encodeURIComponent(fav)}`, {
                        method: 'DELETE',
                    });
                    wx.showToast({ title: '已删除', icon: 'success' });
                    setTimeout(() => wx.navigateBack({ fail: () => {
                            wx.reLaunch({ url: '/pages/my-shops/my-shops' });
                        } }), 400);
                }
                catch (err) {
                    wx.showToast({ title: err.message, icon: 'none' });
                }
            },
        });
    },
    openDianping() {
        const url = this.data.dianpingUrl;
        if (!url) {
            wx.showToast({ title: '暂无点评链接', icon: 'none' });
            return;
        }
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
    onCall() {
        var _a;
        const phone = (_a = this.data.shop) === null || _a === void 0 ? void 0 : _a.phone;
        if (!phone)
            return;
        wx.makePhoneCall({ phoneNumber: String(phone).replace(/\s/g, '') });
    },
    onNav() {
        (0, api_1.openNavigation)(this.data.shop);
    },
});
