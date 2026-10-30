"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const api_1 = require("../../utils/api");
const format_1 = require("../../utils/format");
const config_1 = require("../../utils/config");
const media_1 = require("../../utils/media");
/**
 * 账号页：展示身份 + 退出/撤权。
 * 产品意图：头像入口可随时收回授权，回到登录引导，而不是埋在设置深处。
 */
Page({
    data: {
        nickname: '',
        avatar: '',
        initial: '?',
        busy: false,
    },
    onShow() {
        this.hydrate();
    },
    async hydrate() {
        const cached = (0, api_1.peekCachedUser)();
        if (cached) {
            this.setData({
                nickname: cached.nickname || '',
                avatar: (0, media_1.userAvatarSrc)(config_1.API_BASE, cached.avatar),
                initial: (0, format_1.avatarInitial)(cached.nickname),
            });
        }
        try {
            const me = await (0, api_1.request)('/api/me');
            (0, api_1.saveCachedUser)(me.user);
            this.setData({
                nickname: me.user.nickname || '',
                avatar: (0, media_1.userAvatarSrc)(config_1.API_BASE, me.user.avatar),
                initial: (0, format_1.avatarInitial)(me.user.nickname),
            });
        }
        catch (_a) {
            /* 缓存已展示；401 会踢回登录 */
        }
    },
    onLogout() {
        wx.showModal({
            title: '退出登录？',
            content: '将撤销本机授权，回到登录页。已导入的店仍保留在你的账号里。',
            confirmText: '退出',
            confirmColor: '#e05a5a',
            success: async (r) => {
                if (!r.confirm)
                    return;
                this.setData({ busy: true });
                await (0, api_1.logoutAndLeave)();
            },
        });
    },
});
