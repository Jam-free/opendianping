"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const api_1 = require("../../utils/api");
const format_1 = require("../../utils/format");
const config_1 = require("../../utils/config");
const media_1 = require("../../utils/media");
const avatar_upload_1 = require("../../utils/avatar-upload");
/**
 * 账号页：可点头像/昵称修改并保存；也可退出。
 */
Page({
    data: {
        nickname: '',
        draftNickname: '',
        avatar: '',
        /** 原始存库路径或临时路径 */
        avatarRaw: '',
        initial: '?',
        busy: false,
        saving: false,
    },
    onShow() {
        this.hydrate();
    },
    async hydrate() {
        const cached = (0, api_1.peekCachedUser)();
        if (cached) {
            this.setData({
                nickname: cached.nickname || '',
                draftNickname: cached.nickname || '',
                avatar: (0, media_1.userAvatarSrc)(config_1.API_BASE, cached.avatar),
                avatarRaw: cached.avatar || '',
                initial: (0, format_1.avatarInitial)(cached.nickname),
            });
        }
        try {
            const me = await (0, api_1.request)('/api/me');
            (0, api_1.saveCachedUser)(me.user);
            this.setData({
                nickname: me.user.nickname || '',
                draftNickname: me.user.nickname || '',
                avatar: (0, media_1.userAvatarSrc)(config_1.API_BASE, me.user.avatar),
                avatarRaw: me.user.avatar || '',
                initial: (0, format_1.avatarInitial)(me.user.nickname),
            });
        }
        catch (_a) {
            /* 缓存已展示 */
        }
    },
    onChooseAvatar(e) {
        var _a;
        const url = ((_a = e === null || e === void 0 ? void 0 : e.detail) === null || _a === void 0 ? void 0 : _a.avatarUrl) || '';
        if (!url)
            return;
        this.setData({ avatar: url, avatarRaw: url });
    },
    onNickInput(e) {
        this.setData({ draftNickname: e.detail.value });
    },
    onNickBlur(e) {
        this.setData({ draftNickname: e.detail.value });
    },
    async saveProfile() {
        const nickname = this.data.draftNickname.trim();
        if (!nickname) {
            wx.showToast({ title: '请填写昵称', icon: 'none' });
            return;
        }
        this.setData({ saving: true });
        try {
            const avatarUrl = await persistAvatarIfNeeded(this.data.avatarRaw);
            const res = await (0, api_1.request)('/api/me/profile', {
                method: 'PATCH',
                data: { nickname, avatar: avatarUrl || undefined },
            });
            (0, api_1.saveCachedUser)(res.user);
            this.setData({
                saving: false,
                nickname: res.user.nickname || nickname,
                draftNickname: res.user.nickname || nickname,
                avatar: (0, media_1.userAvatarSrc)(config_1.API_BASE, res.user.avatar),
                avatarRaw: res.user.avatar || '',
                initial: (0, format_1.avatarInitial)(res.user.nickname || nickname),
            });
            wx.showToast({ title: '已保存' });
        }
        catch (err) {
            this.setData({ saving: false });
            wx.showToast({ title: err.message, icon: 'none' });
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
async function persistAvatarIfNeeded(path) {
    if (!path)
        return '';
    if (path.startsWith('/api/media/local/'))
        return path;
    if (/^https?:\/\//i.test(path) && path.indexOf(config_1.API_BASE) === 0) {
        return path.slice(config_1.API_BASE.length) || path;
    }
    if (/^https?:\/\//i.test(path) && !/tmp|wxfile/i.test(path)) {
        return path.slice(0, 800);
    }
    if (!(path.startsWith('wxfile://') ||
        path.startsWith('http://tmp') ||
        !path.startsWith('http'))) {
        return path.slice(0, 800);
    }
    // 只走 callContainer；失败返回空，昵称仍可保存
    return (0, avatar_upload_1.uploadAvatarOrEmpty)(path);
}
