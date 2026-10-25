import {
  ensureLogin,
  hasSession,
  peekCachedUser,
  saveCachedUser,
  enterAppAfterLogin,
  request,
} from '../../utils/api';

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
      const boot = await request<{ bypass: boolean }>('/api/auth/bootstrap', {
        auth: false,
      });
      this.setData({ bypass: Boolean(boot.bypass) });
    } catch {
      this.setData({ bypass: false });
    }

    if (!hasSession()) return;

    // 已有本地票：验一次 /api/me，通过则直接进主界面
    this.setData({ busy: true, error: '' });
    try {
      const me = await request<{
        user: { id: string; nickname?: string | null; avatar?: string | null };
      }>('/api/me');
      saveCachedUser(me.user);
      enterAppAfterLogin();
    } catch {
      // 票失效：停在本页等用户点登录
      this.setData({ busy: false });
    }
  },

  async onLogin() {
    if (this.data.busy) return;
    this.setData({ busy: true, error: '' });
    try {
      // force：即使用户清过权，也重新换票；bypass 下同样走这条路径
      await ensureLogin({ force: true, interactive: true });
      try {
        const me = await request<{
          user: { id: string; nickname?: string | null; avatar?: string | null };
        }>('/api/me');
        saveCachedUser(me.user);
      } catch {
        saveCachedUser(
          peekCachedUser() || { id: '', nickname: null, avatar: null }
        );
      }
      enterAppAfterLogin();
    } catch (err) {
      this.setData({
        busy: false,
        error: (err as Error).message || '登录失败，请重试',
      });
    }
  },
});