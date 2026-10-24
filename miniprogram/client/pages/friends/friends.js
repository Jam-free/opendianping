"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const api_1 = require("../../utils/api");
const format_1 = require("../../utils/format");
const circle_1 = require("../../utils/circle");
Page({
    data: {
        loading: true,
        friends: [],
        networkId: '',
        inviteToken: '',
        needProfile: false,
        showProfile: false,
        draftNickname: '',
        draftAvatar: '',
        savingProfile: false,
        loginError: '',
    },
    onShow() {
        wx.showShareMenu({ withShareTicket: true, menus: ['shareAppMessage'] });
        this.bootstrap();
    },
    onPullDownRefresh() {
        this.bootstrap().finally(() => wx.stopPullDownRefresh());
    },
    async retryLogin() {
        try {
            await (0, api_1.ensureLogin)({ force: true });
            this.setData({ loginError: '' });
            await this.bootstrap();
        }
        catch (_a) {
            /* ensureLogin 已弹窗 */
        }
    },
    async bootstrap() {
        var _a, _b, _c, _d;
        this.setData({ loading: true, loginError: '' });
        try {
            const [me, net] = await Promise.all([
                (0, api_1.request)('/api/me'),
                (0, api_1.request)('/api/me/network'),
            ]);
            (0, circle_1.setActiveCircleId)(net.networkId);
            const friends = (net.friends || []).map((f) => (Object.assign(Object.assign({}, f), { initial: (0, format_1.avatarInitial)(f.nickname) })));
            const needProfile = !((_a = me.user) === null || _a === void 0 ? void 0 : _a.nickname) || !((_b = me.user) === null || _b === void 0 ? void 0 : _b.avatar);
            this.setData({
                friends,
                networkId: net.networkId,
                inviteToken: net.inviteToken,
                needProfile,
                draftNickname: ((_c = me.user) === null || _c === void 0 ? void 0 : _c.nickname) || '',
                draftAvatar: ((_d = me.user) === null || _d === void 0 ? void 0 : _d.avatar) || '',
                loading: false,
                loginError: '',
            });
        }
        catch (err) {
            const msg = err.message || '加载失败';
            this.setData({
                loading: false,
                loginError: msg.includes('登录') || msg.includes('401')
                    ? '登录已失效，点此重新登录'
                    : msg.includes('503') || msg.includes('不可用')
                        ? '服务暂时繁忙，点此重试'
                        : `${msg} · 点此重试`,
            });
        }
    },
    onShareAppMessage() {
        const { networkId, inviteToken } = this.data;
        if (!networkId || !inviteToken) {
            return { title: '美食肥猫 · 一起收藏好店', path: '/pages/friends/friends' };
        }
        return {
            title: '来美食肥猫，一起共享收藏的店',
            path: `/pages/join/join?c=${networkId}&t=${inviteToken}`,
        };
    },
    openFriend(e) {
        const id = String(e.currentTarget.dataset.id || '');
        const name = encodeURIComponent(String(e.currentTarget.dataset.name || '朋友'));
        wx.navigateTo({
            url: `/pages/friend-shops/friend-shops?c=${this.data.networkId}&m=${id}&n=${name}`,
        });
    },
    openProfile() {
        this.setData({ showProfile: true });
    },
    closeProfile() {
        this.setData({ showProfile: false });
    },
    onChooseAvatar(e) {
        var _a;
        const url = ((_a = e === null || e === void 0 ? void 0 : e.detail) === null || _a === void 0 ? void 0 : _a.avatarUrl) || '';
        if (url)
            this.setData({ draftAvatar: url });
    },
    onNickInput(e) {
        this.setData({ draftNickname: e.detail.value });
    },
    onNickBlur(e) {
        this.setData({ draftNickname: e.detail.value });
    },
    async saveProfile() {
        const nickname = this.data.draftNickname.trim();
        const avatar = this.data.draftAvatar.trim();
        if (!nickname) {
            wx.showToast({ title: '请填写昵称', icon: 'none' });
            return;
        }
        this.setData({ savingProfile: true });
        try {
            await (0, api_1.request)('/api/me/profile', {
                method: 'PATCH',
                data: { nickname, avatar: avatar || undefined },
            });
            this.setData({
                savingProfile: false,
                showProfile: false,
                needProfile: !avatar,
            });
            wx.showToast({ title: '已保存' });
        }
        catch (err) {
            this.setData({ savingProfile: false });
            wx.showToast({ title: err.message, icon: 'none' });
        }
    },
});
