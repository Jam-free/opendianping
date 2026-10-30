"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const api_1 = require("../../utils/api");
const config_1 = require("../../utils/config");
const avatar_upload_1 = require("../../utils/avatar-upload");
/**
 * 登录：点进入 → 选头像 → 选昵称后自动进入。
 * 头像只走云托管内网；上传失败也不挡进入（昵称仍会保存）。
 */
Page({
    data: {
        busy: false,
        bypass: false,
        error: '',
        step: 'avatar',
        draftNickname: '',
        draftAvatar: '',
        nickFocus: false,
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
            const nick = (me.user.nickname || '').trim();
            const av = me.user.avatar || '';
            if (nick && av) {
                (0, api_1.enterAppAfterLogin)();
                return;
            }
            if (av && !nick) {
                this.setData({
                    busy: false,
                    step: 'nickname',
                    draftAvatar: resolveAvatarDisplay(av),
                    draftNickname: '',
                    nickFocus: true,
                });
                return;
            }
            // 有昵称没头像，或都没有：从头像步走（本地已选的临时头像优先）
            if (nick && !av) {
                this.setData({
                    busy: false,
                    step: 'avatar',
                    draftNickname: nick,
                });
                return;
            }
            this.setData({ busy: false, step: 'avatar' });
        }
        catch (_b) {
            this.setData({ busy: false });
        }
    },
    onChooseAvatar(e) {
        var _a;
        const url = ((_a = e === null || e === void 0 ? void 0 : e.detail) === null || _a === void 0 ? void 0 : _a.avatarUrl) || '';
        if (!url) {
            this.setData({ error: '未拿到头像，请再试一次' });
            return;
        }
        this.setData({
            draftAvatar: url,
            step: 'nickname',
            error: '',
            nickFocus: true,
        });
    },
    backToAvatar() {
        this.setData({
            step: 'avatar',
            nickFocus: false,
            error: '',
            draftNickname: '',
        });
    },
    onNickInput(e) {
        const nickname = (e.detail.value || '').trim();
        this.setData({ draftNickname: nickname, error: '' });
        if (nickname)
            this.tryEnterWithNickname(nickname);
    },
    onNickBlur(e) {
        const nickname = (e.detail.value || '').trim();
        this.setData({ draftNickname: nickname, nickFocus: false });
        if (nickname)
            this.tryEnterWithNickname(nickname);
    },
    onNickConfirm(e) {
        const nickname = (e.detail.value || this.data.draftNickname || '').trim();
        if (nickname)
            this.tryEnterWithNickname(nickname);
    },
    tryEnterWithNickname(nickname) {
        if (this.data.busy)
            return;
        if (!this.data.draftAvatar) {
            this.setData({ step: 'avatar', error: '请先选择头像' });
            return;
        }
        if (!nickname.trim())
            return;
        this.enterApp(nickname.trim());
    },
    async enterApp(nickname) {
        if (this.data.busy)
            return;
        this.setData({ busy: true, error: '', draftNickname: nickname });
        try {
            await (0, api_1.ensureLogin)({ force: true, interactive: true });
            // 头像失败不拦路：昵称先存上，进得去再说
            const avatarUrl = await (0, avatar_upload_1.uploadAvatarOrEmpty)(this.data.draftAvatar);
            await (0, api_1.request)('/api/me/profile', {
                method: 'PATCH',
                data: Object.assign({ nickname }, (avatarUrl ? { avatar: avatarUrl } : {})),
            });
            const me = await (0, api_1.request)('/api/me');
            (0, api_1.saveCachedUser)(me.user);
            (0, api_1.enterAppAfterLogin)();
        }
        catch (err) {
            this.setData({
                busy: false,
                error: friendlyError(err),
            });
        }
    },
});
function friendlyError(err) {
    const raw = ((err === null || err === void 0 ? void 0 : err.message) || String(err || '')).trim();
    if (!raw)
        return '登录失败，请重试';
    if (/fetch failed|request:fail|ERR_CONNECTION|超时|timeout/i.test(raw)) {
        return '登录请求失败，请检查网络后重试';
    }
    return raw.length > 60 ? `${raw.slice(0, 60)}…` : raw;
}
function resolveAvatarDisplay(avatar) {
    if (!avatar)
        return '';
    if (avatar.startsWith('/api/'))
        return `${config_1.API_BASE}${avatar}`;
    return avatar;
}
