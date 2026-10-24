import { request } from '../../utils/api';
import { API_BASE } from '../../utils/config';

Page({
  data: {
    capabilities: [
      { title: '查看我的店', desc: '读取你导入与记下的店铺' },
      { title: '附近推荐', desc: '按距离挑选适合的店' },
      { title: '好友口味', desc: '参考美食好友共享的店' },
      { title: '导出清单', desc: '整理成可分享的列表' },
      { title: '路线建议', desc: '串店路线与顺序' },
      { title: '搜索店铺', desc: '按店名或品类查找' },
    ],
    installCmd: '',
    hasToken: false,
    plainToken: '',
    maskedToken: '',
    showToken: false,
    createdAt: '',
    lastUsedAt: '',
    busy: false,
  },

  onLoad() {
    this.setData({
      installCmd: `npx skills add feimaocat/food-network -g\n# API: ${API_BASE}\n# Header: Authorization: Bearer <你的 Token>`,
    });
    this.loadMeta();
  },

  async loadMeta() {
    try {
      const res = await request<{
        token: {
          prefix: string;
          createdAt: string;
          lastUsedAt: string | null;
        } | null;
      }>('/api/agent-tokens');
      if (res.token) {
        this.setData({
          hasToken: true,
          maskedToken: `${res.token.prefix}${'•'.repeat(18)}`,
          createdAt: formatDate(res.token.createdAt),
          lastUsedAt: res.token.lastUsedAt
            ? formatDate(res.token.lastUsedAt)
            : '',
        });
      }
    } catch {
      /* 首次可无 token */
    }
  },

  copyInstall() {
    wx.setClipboardData({
      data: this.data.installCmd,
      success: () => wx.showToast({ title: '已复制指令' }),
    });
  },

  toggleToken() {
    if (!this.data.plainToken) {
      wx.showToast({ title: '请先生成或重置以查看完整 Token', icon: 'none' });
      return;
    }
    this.setData({ showToken: !this.data.showToken });
  },

  copyToken() {
    if (!this.data.plainToken) {
      wx.showToast({ title: '请先生成 Token', icon: 'none' });
      return;
    }
    wx.setClipboardData({
      data: this.data.plainToken,
      success: () => wx.showToast({ title: '已复制 Token' }),
    });
  },

  async resetToken() {
    this.setData({ busy: true });
    try {
      const res = await request<{
        token: string;
        prefix: string;
        createdAt: string;
        lastUsedAt: string | null;
      }>('/api/agent-tokens/reset', { method: 'POST' });
      this.setData({
        busy: false,
        hasToken: true,
        plainToken: res.token,
        maskedToken: `${res.prefix}${'•'.repeat(18)}`,
        showToken: true,
        createdAt: formatDate(res.createdAt),
        lastUsedAt: '',
      });
      wx.showToast({ title: 'Token 已生成' });
    } catch (err) {
      this.setData({ busy: false });
      wx.showToast({ title: (err as Error).message, icon: 'none' });
    }
  },
});

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    const p = (n: number) => (n < 10 ? `0${n}` : `${n}`);
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  } catch {
    return iso.slice(0, 10);
  }
}
