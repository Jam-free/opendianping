"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const api_1 = require("../../utils/api");
const config_1 = require("../../utils/config");
const format_1 = require("../../utils/format");
const circle_1 = require("../../utils/circle");
function avatarSrc(avatar) {
    if (!avatar)
        return '';
    if (avatar.startsWith('/api/'))
        return `${config_1.API_BASE}${avatar}`;
    return avatar;
}
Page({
    data: {
        loading: true,
        friends: [],
        networkId: '',
        inviteToken: '',
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
        this.setData({ loading: true, loginError: '' });
        try {
            const net = await (0, api_1.request)('/api/me/network');
            (0, circle_1.setActiveCircleId)(net.networkId);
            const friends = (net.friends || []).map((f) => (Object.assign(Object.assign({}, f), { avatarSrc: avatarSrc(f.avatar), initial: (0, format_1.avatarInitial)(f.nickname) })));
            this.setData({
                friends,
                networkId: net.networkId,
                inviteToken: net.inviteToken,
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
            return {
                title: '我和我爱吃的朋友们 · 一起收藏好店',
                path: '/pages/friends/friends',
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
        wx.navigateTo({
            url: `/pages/friend-shops/friend-shops?c=${this.data.networkId}&m=${id}&n=${name}`,
        });
    },
});
