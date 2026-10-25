import {
  logoutAndLeave,
  peekCachedUser,
  saveCachedUser,
  request,
} from '../../utils/api';
import { avatarInitial } from '../../utils/format';

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
    const cached = peekCachedUser();
    if (cached) {
      this.setData({
        nickname: cached.nickname || '',
        avatar: cached.avatar || '',
        initial: avatarInitial(cached.nickname),
      });
    }
    try {
      const me = await request<{
        user: { id: string; nickname?: string | null; avatar?: string | null };
      }>('/api/me');
      saveCachedUser(me.user);
      this.setData({
        nickname: me.user.nickname || '',
        avatar: me.user.avatar || '',
        initial: avatarInitial(me.user.nickname),
      });
    } catch {
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
        if (!r.confirm) return;
        this.setData({ busy: true });
        await logoutAndLeave();
      },
    });
  },
});
