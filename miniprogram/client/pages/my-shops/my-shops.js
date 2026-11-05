"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const api_1 = require("../../utils/api");
const location_1 = require("../../utils/location");
const circle_1 = require("../../utils/circle");
const format_1 = require("../../utils/format");
const config_1 = require("../../utils/config");
const media_1 = require("../../utils/media");
const locate_draft_1 = require("../../utils/locate-draft");
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
        /** 与右上角胶囊同高，保证头像不被裁切 */
        navRowHeight: 32,
        shopsLoading: true,
        friendsLoading: true,
        shops: [],
        friends: [],
        networkId: '',
        inviteToken: '',
        loginError: '',
        avatar: '',
        initial: '?',
        loggedIn: false,
        /** 右边留给微信胶囊，避免头像钻进胶囊被挡住 */
        capsulePad: 108,
    },
    /** 登录完成后要接着做的事：import / locate / ai */
    _nextAction: '',
    onLoad(query) {
        var _a, _b;
        const panel = query.panel === '1' || query.panel === 'rank' ? 1 : 0;
        this._nextAction = query.next || '';
        // 自定义顶栏：标题行与胶囊同一高度，头像停在胶囊左边
        try {
            const wxAny = wx;
            const sys = ((_a = wxAny.getSystemInfoSync) === null || _a === void 0 ? void 0 : _a.call(wxAny)) || {};
            const menu = ((_b = wxAny.getMenuButtonBoundingClientRect) === null || _b === void 0 ? void 0 : _b.call(wxAny)) || {};
            const statusBar = Number(sys.statusBarHeight) || 20;
            const menuTop = Number(menu.top) || 0;
            const menuHeight = Number(menu.height) || 32;
            const menuLeft = Number(menu.left) || 0;
            const winW = Number(sys.windowWidth) || 375;
            // 顶到胶囊上沿即可；再往上会被系统栏裁掉
            const statusPad = menuTop > 0 ? menuTop : statusBar + 6;
            const navRowHeight = menuHeight > 0 ? menuHeight : 32;
            // 胶囊左缘到屏幕右边的距离，再留 8px，头像不会被盖住
            const capsulePad = menuLeft > 0 && winW > menuLeft ? Math.ceil(winW - menuLeft + 8) : 108;
            this.setData(Object.assign({ statusPad,
                navRowHeight,
                capsulePad }, (panel ? { panel } : {})));
        }
        catch (_c) {
            if (panel)
                this.setData({ panel });
        }
    },
    onShow() {
        const loggedIn = (0, api_1.hasSession)();
        this.setData({ loggedIn });
        if (!loggedIn) {
            // 审核要求：先浏览首页，不要一进来就要求头像、昵称授权
            this.setData({
                shops: [],
                friends: [],
                shopsLoading: false,
                friendsLoading: false,
                loginError: '',
                avatar: '',
                initial: '',
            });
            return;
        }
        wx.showShareMenu({ withShareTicket: true, menus: ['shareAppMessage'] });
        this.hydrateMe();
        this.loadShops();
        this.loadFriends();
        const next = this._nextAction;
        if (next) {
            this._nextAction = '';
            if (next === 'import')
                wx.navigateTo({ url: '/pages/import/import' });
            else if (next === 'ai')
                wx.navigateTo({ url: '/pages/connect-ai/connect-ai' });
            else if (next === 'locate')
                (0, locate_draft_1.startLocateFlow)();
        }
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
        // 只有手指滑才跟着走。从邀请链接打开排行时，swiper 会先报一次第 0 页，
        // 若跟着改，人会被弹回「私藏好店」，看起来像吃货排行打不开。
        if (e.detail.source !== 'touch')
            return;
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
            if (net.networkId && net.inviteToken) {
                wx.setStorageSync('share_invite', {
                    networkId: net.networkId,
                    inviteToken: net.inviteToken,
                });
            }
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
    /** 点头像先进账号页，在那一页里再选头像和昵称 */
    goAccount() {
        wx.navigateTo({ url: '/pages/account/account' });
    },
    goImport() {
        if (!(0, api_1.hasSession)()) {
            (0, api_1.askToLogin)('/pages/my-shops/my-shops?next=import');
            return;
        }
        wx.navigateTo({ url: '/pages/import/import' });
    },
    goConnectAi() {
        if (!(0, api_1.hasSession)()) {
            (0, api_1.askToLogin)('/pages/my-shops/my-shops?next=ai');
            return;
        }
        wx.navigateTo({ url: '/pages/connect-ai/connect-ai' });
    },
    goLocate() {
        if (!(0, api_1.hasSession)()) {
            (0, api_1.askToLogin)('/pages/my-shops/my-shops?next=locate');
            return;
        }
        (0, locate_draft_1.startLocateFlow)();
    },
    /** 分享要先登录，否则发出去的链接加不上好友 */
    askLoginForShare() {
        (0, api_1.askToLogin)('/pages/my-shops/my-shops?panel=1');
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
    /**
     * 分享必须带上邀请。没带上时，朋友点开只是进了自己的首页，吃货排行仍是空的。
     * 页面还没加载完就点分享时，先用上次记下的邀请，没有再现拉一次。
     */
    async onShareAppMessage() {
        if (!(0, api_1.hasSession)()) {
            return {
                title: '我和我爱吃的朋友们 · 一起收藏好店',
                path: '/pages/my-shops/my-shops',
            };
        }
        let networkId = this.data.networkId;
        let inviteToken = this.data.inviteToken;
        if (!networkId || !inviteToken) {
            try {
                const saved = wx.getStorageSync('share_invite');
                networkId = (saved === null || saved === void 0 ? void 0 : saved.networkId) || '';
                inviteToken = (saved === null || saved === void 0 ? void 0 : saved.inviteToken) || '';
            }
            catch (_a) {
                /* ignore */
            }
        }
        if (!networkId || !inviteToken) {
            try {
                const net = await (0, api_1.request)('/api/me/network');
                networkId = net.networkId;
                inviteToken = net.inviteToken;
                if (networkId && inviteToken) {
                    this.setData({ networkId, inviteToken });
                    wx.setStorageSync('share_invite', { networkId, inviteToken });
                }
            }
            catch (_b) {
                /* 拉不到就只能分享首页 */
            }
        }
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
        const avatar = encodeURIComponent(String(e.currentTarget.dataset.avatar || ''));
        wx.navigateTo({
            url: `/pages/friend-shops/friend-shops?c=${this.data.networkId}&m=${id}&n=${name}&a=${avatar}`,
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
