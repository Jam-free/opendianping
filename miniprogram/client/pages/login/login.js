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
 * 登录门禁：头像/昵称必须用户点选（微信不支持静默读取）。
 * 不论是否 DEV bypass，都要先选齐再进，避免云上 bypass=true 时整块 UI 被藏掉。
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
            const nick = (me.user.nickname || '').trim();
            const av = me.user.avatar || '';
            // 缺名片就停在登录页补齐（bypass 也一样）
            if (!nick || !av) {
                this.setData({
                    busy: false,
                    draftNickname: nick,
                    draftAvatar: resolveAvatarDisplay(av),
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
        if (url) {
            this.setData({ draftAvatar: url, error: '' });
        }
    },
    onNickInput(e) {
        this.setData({ draftNickname: e.detail.value, error: '' });
    },
    onNickBlur(e) {
        this.setData({ draftNickname: e.detail.value });
    },
    onNickReview() {
        /* 基础库昵称审核回调，有即可，不拦登录 */
    },
    async onLogin() {
        if (this.data.busy)
            return;
        const nickname = this.data.draftNickname.trim();
        if (!this.data.draftAvatar) {
            this.setData({ error: '请先点上方圆形选择微信头像' });
            return;
        }
        if (!nickname) {
            this.setData({ error: '请点昵称框，选择或填写微信昵称' });
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
    // 已是可公网访问的头像链接（少见）
    if (/^https?:\/\//i.test(path) && !/tmp|wxfile/i.test(path)) {
        return path.slice(0, 800);
    }
    const compressed = await (0, photo_upload_1.compressPhotoForUpload)(path);
    const base64 = await (0, photo_upload_1.readPhotoBase64)(compressed);
    const token = await (await Promise.resolve().then(() => __importStar(require('../../utils/api')))).ensureLogin();
    try {
        if ((0, photo_upload_1.estimatePayloadBytes)(base64) > 90 * 1024) {
            return await (0, photo_upload_1.uploadPhotoPublic)(base64, token);
        }
        const res = await (0, api_1.request)('/api/me/photos', {
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
