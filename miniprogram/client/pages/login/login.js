"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const api_1 = require("../../utils/api");
const config_1 = require("../../utils/config");
const photo_upload_1 = require("../../utils/photo-upload");
/**
 * 登录：点「进入」→ 选头像 → 填昵称 → 进应用。
 * 微信不允许代码主动弹头像/昵称授权窗，只能挂在 button/input 上由用户点。
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
            // 缺一项：有头像就走到昵称步，否则从头像步开始
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
            this.setData({
                busy: false,
                step: 'avatar',
                draftAvatar: resolveAvatarDisplay(av),
                draftNickname: nick,
            });
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
        });
    },
    onNickInput(e) {
        this.setData({ draftNickname: e.detail.value, error: '' });
    },
    onNickBlur(e) {
        this.setData({ draftNickname: e.detail.value, nickFocus: false });
    },
    async onConfirmEnter() {
        if (this.data.busy)
            return;
        const nickname = this.data.draftNickname.trim();
        if (!this.data.draftAvatar) {
            this.setData({ step: 'avatar', error: '请先选择头像' });
            return;
        }
        if (!nickname) {
            this.setData({ error: '请点输入框选择或填写昵称', nickFocus: true });
            return;
        }
        this.setData({ busy: true, error: '' });
        try {
            await (0, api_1.ensureLogin)({ force: true, interactive: true });
            const avatarUrl = await persistAvatarIfNeeded(this.data.draftAvatar);
            await (0, api_1.request)('/api/me/profile', {
                method: 'PATCH',
                data: { nickname, avatar: avatarUrl },
            });
            const me = await (0, api_1.request)('/api/me');
            (0, api_1.saveCachedUser)(me.user);
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
    const compressed = await (0, photo_upload_1.compressPhotoForUpload)(path);
    const base64 = await (0, photo_upload_1.readPhotoBase64)(compressed);
    const { ensureLogin, request } = await Promise.resolve().then(() => __importStar(require('../../utils/api')));
    const token = await ensureLogin();
    try {
        if ((0, photo_upload_1.estimatePayloadBytes)(base64) > 90 * 1024) {
            return await (0, photo_upload_1.uploadPhotoPublic)(base64, token);
        }
        const res = await request('/api/me/photos', {
            method: 'POST',
            data: { base64, mime: 'image/jpeg' },
        });
        if (!res.url)
            throw new Error('头像上传失败');
        return res.url;
    }
    catch (err) {
        const msg = err.message || '';
        if (/太大|606001|上传|网络|失败|404|不存在/i.test(msg)) {
            return await (0, photo_upload_1.uploadPhotoPublic)(base64, token);
        }
        throw err;
    }
}
