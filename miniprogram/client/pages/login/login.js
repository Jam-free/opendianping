"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const api_1 = require("../../utils/api");
const config_1 = require("../../utils/config");
const avatar_upload_1 = require("../../utils/avatar-upload");
/**
 * 登录：点进入 → 选头像 → 选昵称后进入。
 *
 * 微信 type=nickname 的坑：点选昵称时 input 可能连发空值/半截值，
 * 若一有 input 就进，经常第一次进不去，要连点好几次。
 * 所以：input 只记昵称；真正进入交给 blur / 确认 /「进入」按钮。
 */
Page({
    data: {
        busy: false,
        bypass: false,
        error: '',
        step: 'avatar',
        draftNickname: '',
        draftAvatar: '',
    },
    /** 同步锁：setData 的 busy 有延迟，防双触发 */
    _entering: false,
    _enterTimer: 0,
    onShow() {
        this.bootstrap();
    },
    onUnload() {
        this.clearEnterTimer();
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
                });
                return;
            }
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
            // 有服务端旧昵称时预填到草稿，方便直接点「进入」
            draftNickname: this.data.draftNickname || '',
        });
    },
    backToAvatar() {
        this.clearEnterTimer();
        this.setData({
            step: 'avatar',
            error: '',
            draftNickname: '',
        });
    },
    /** 只记草稿，不立刻进入——避免点选昵称过程中的空/半截事件把流程打乱 */
    onNickInput(e) {
        const nickname = (e.detail.value || '').trim();
        this.setData({ draftNickname: nickname, error: '' });
        // 选完微信昵称后，部分机型不发 blur；短延迟兜一次进入
        if (nickname)
            this.scheduleEnter(nickname);
    },
    onNickBlur(e) {
        const nickname = (e.detail.value || this.data.draftNickname || '').trim();
        if (nickname)
            this.setData({ draftNickname: nickname });
        if (nickname)
            this.scheduleEnter(nickname, 80);
    },
    onNickConfirm(e) {
        const nickname = (e.detail.value || this.data.draftNickname || '').trim();
        if (nickname)
            this.enterApp(nickname);
    },
    onTapEnter() {
        const nickname = (this.data.draftNickname || '').trim();
        if (!nickname) {
            this.setData({ error: '请先点上方选好昵称' });
            return;
        }
        this.enterApp(nickname);
    },
    clearEnterTimer() {
        if (this._enterTimer) {
            clearTimeout(this._enterTimer);
            this._enterTimer = 0;
        }
    },
    scheduleEnter(nickname, delayMs = 360) {
        this.clearEnterTimer();
        this._enterTimer = setTimeout(() => {
            this._enterTimer = 0;
            this.enterApp(nickname);
        }, delayMs);
    },
    async enterApp(nickname) {
        const nick = nickname.trim();
        if (!nick)
            return;
        if (this._entering || this.data.busy)
            return;
        if (!this.data.draftAvatar) {
            this.setData({ step: 'avatar', error: '请先选择头像' });
            return;
        }
        this.clearEnterTimer();
        this._entering = true;
        this.setData({ busy: true, error: '', draftNickname: nick });
        try {
            // 已有会话就别强制重登，少一次请求、少一次失败机会
            await (0, api_1.ensureLogin)({ interactive: true });
            const avatarUrl = await (0, avatar_upload_1.uploadAvatarOrEmpty)(this.data.draftAvatar);
            await (0, api_1.request)('/api/me/profile', {
                method: 'PATCH',
                data: Object.assign({ nickname: nick }, (avatarUrl ? { avatar: avatarUrl } : {})),
            });
            const me = await (0, api_1.request)('/api/me');
            (0, api_1.saveCachedUser)(me.user);
            (0, api_1.enterAppAfterLogin)();
        }
        catch (err) {
            this._entering = false;
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
