"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const api_1 = require("../../utils/api");
const config_1 = require("../../utils/config");
const photo_upload_1 = require("../../utils/photo-upload");
/**
 * 强制登录门禁页。
 * 头像/昵称在登录前就展示：微信不允许静默读资料，必须用户点选 chooseAvatar / type=nickname。
 */
Page({
    data: {
        busy: false,
        bypass: false,
        error: '',
        draftNickname: '',
        draftAvatar: '',
    },
    onShow() {
        this.bootstrap();
    },
    async bootstrap() {
        try {
            const boot = await (0, api_1.request)('/api/auth/bootstrap', {
                auth: false,
            });
            this.setData({ bypass: Boolean(boot.bypass) });
        }
        catch (_a) {
            this.setData({ bypass: false });
        }
        if (!(0, api_1.hasSession)())
            return;
        this.setData({ busy: true, error: '' });
        try {
            const me = await (0, api_1.request)('/api/me');
            (0, api_1.saveCachedUser)(me.user);
            // 已有票但还没名片：留在本页补齐，避免进了朋友圈才发现
            if (!this.data.bypass && (!me.user.nickname || !me.user.avatar)) {
                this.setData({
                    busy: false,
                    draftNickname: me.user.nickname || '',
                    draftAvatar: resolveAvatarDisplay(me.user.avatar),
                });
                return;
            }
            (0, api_1.enterAppAfterLogin)();
        }
        catch (_b) {
            this.setData({ busy: false });
        }
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
    async onLogin() {
        if (this.data.busy)
            return;
        const nickname = this.data.draftNickname.trim();
        if (!this.data.bypass) {
            if (!this.data.draftAvatar) {
                this.setData({ error: '请先点上方圆形选择头像' });
                return;
            }
            if (!nickname) {
                this.setData({ error: '请填写微信昵称（点输入框可选微信昵称）' });
                return;
            }
        }
        this.setData({ busy: true, error: '' });
        try {
            await (0, api_1.ensureLogin)({ force: true, interactive: true });
            if (!this.data.bypass) {
                const avatarUrl = await persistAvatarIfNeeded(this.data.draftAvatar);
                await (0, api_1.request)('/api/me/profile', {
                    method: 'PATCH',
                    data: { nickname, avatar: avatarUrl },
                });
                const me = await (0, api_1.request)('/api/me');
                (0, api_1.saveCachedUser)(me.user);
            }
            else {
                try {
                    const me = await (0, api_1.request)('/api/me');
                    (0, api_1.saveCachedUser)(me.user);
                }
                catch (_a) {
                    (0, api_1.saveCachedUser)((0, api_1.peekCachedUser)() || { id: '', nickname: null, avatar: null });
                }
            }
            (0, api_1.enterAppAfterLogin)();
        }
        catch (err) {
            this.setData({
                busy: false,
                error: err.message || '登录失败，请重试',
            });
        }
    },
});
function resolveAvatarDisplay(avatar) {
    if (!avatar)
        return '';
    if (avatar.startsWith('/api/'))
        return `${config_1.API_BASE}${avatar}`;
    return avatar;
}
/** 微信 chooseAvatar 是临时路径，需上传后朋友才能看见 */
async function persistAvatarIfNeeded(path) {
    if (!path)
        return '';
    if (path.startsWith('/api/media/local/'))
        return path;
    if (/^https?:\/\//i.test(path) && path.indexOf(config_1.API_BASE) === 0) {
        return path.slice(config_1.API_BASE.length) || path;
    }
    if (path.startsWith('wxfile://') ||
        path.startsWith('http://tmp') ||
        !path.startsWith('http')) {
        const compressed = await (0, photo_upload_1.compressPhotoForUpload)(path);
        const base64 = await (0, photo_upload_1.readPhotoBase64)(compressed);
        const res = await (0, api_1.request)('/api/me/photos', {
            method: 'POST',
            data: { base64, mime: 'image/jpeg' },
        });
        return res.url;
    }
    return path.slice(0, 500);
}
