"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const api_1 = require("../../utils/api");
/**
 * 强制登录门禁页。
 * 设计决策：未登录不能进 Tab；有本地票则静默验票后进「我的店」。
 * DEV_AUTH_BYPASS 时按钮文案改为「一键进入」，流程仍是同一套。
 */
Page({
    data: {
        busy: false,
        bypass: false,
        error: '',
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
        // 已有本地票：验一次 /api/me，通过则直接进主界面
        this.setData({ busy: true, error: '' });
        try {
            const me = await (0, api_1.request)('/api/me');
            (0, api_1.saveCachedUser)(me.user);
            (0, api_1.enterAppAfterLogin)();
        }
        catch (_b) {
            // 票失效：停在本页等用户点登录
            this.setData({ busy: false });
        }
    },
    async onLogin() {
        if (this.data.busy)
            return;
        this.setData({ busy: true, error: '' });
        try {
            // force：即使用户清过权，也重新换票；bypass 下同样走这条路径
            await (0, api_1.ensureLogin)({ force: true, interactive: true });
            try {
                const me = await (0, api_1.request)('/api/me');
                (0, api_1.saveCachedUser)(me.user);
            }
            catch (_a) {
                (0, api_1.saveCachedUser)((0, api_1.peekCachedUser)() || { id: '', nickname: null, avatar: null });
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
