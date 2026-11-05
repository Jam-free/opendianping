import { request } from '../../utils/api';
import { API_BASE } from '../../utils/config';

/** 尽量短：粘贴给 AI 就能看店、记店 */
function buildInstallCmd(token: string): string {
  return [
    '你是我的美食助手。可以看我记过的店，也可以帮我记下新店。记下之前先跟我确认店名。',
    '',
    `地址：${API_BASE}`,
    `口令：${token}`,
    '',
    '每次请求加上：Authorization: Bearer 口令',
    '查看我的店：GET 地址/api/agent/shops',
    '查看朋友：GET 地址/api/agent/friends',
    '记下一家店：POST 地址/api/agent/shops',
    '例如：{"name":"店名","city":"城市","note":"一句话"}',
  ].join('\n');
}

Page({
  data: {
    capabilities: [
      { title: '查看我的店', desc: '看你记过的店，和朋友分享的店' },
      { title: '记下店铺', desc: '你确认店名之后，帮你记下来' },
      { title: '附近与路线', desc: '按远近挑店，排一个吃饭顺序' },
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
      installCmd: buildInstallCmd('<点下方复制后，这里会变成你的口令>'),
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

  async ensurePlainToken(): Promise<string> {
    if (this.data.plainToken) return this.data.plainToken;
    const res = await request<{
      token: string;
      prefix: string;
      createdAt: string;
      lastUsedAt: string | null;
    }>('/api/agent-tokens/reset', { method: 'POST' });
    this.setData({
      hasToken: true,
      plainToken: res.token,
      maskedToken: `${res.prefix}${'•'.repeat(18)}`,
      showToken: true,
      createdAt: formatDate(res.createdAt),
      lastUsedAt: '',
    });
    return res.token;
  },

  async copyInstall() {
    this.setData({ busy: true });
    try {
      const token = await this.ensurePlainToken();
      const cmd = buildInstallCmd(token);
      this.setData({ installCmd: cmd, busy: false });
      wx.setClipboardData({
        data: cmd,
        success: () => wx.showToast({ title: '已复制', icon: 'success' }),
      });
    } catch (err) {
      this.setData({ busy: false });
      wx.showToast({ title: (err as Error).message, icon: 'none' });
    }
  },

  toggleToken() {
    if (!this.data.plainToken) {
      wx.showToast({ title: '先点「一键复制」生成', icon: 'none' });
      return;
    }
    this.setData({ showToken: !this.data.showToken });
  },

  copyToken() {
    if (!this.data.plainToken) {
      wx.showToast({ title: '请先点一键复制生成', icon: 'none' });
      return;
    }
    wx.setClipboardData({
      data: this.data.plainToken,
      success: () => wx.showToast({ title: '已复制口令' }),
    });
  },

  async resetToken() {
    this.setData({ busy: true, plainToken: '' });
    try {
      const token = await this.ensurePlainToken();
      this.setData({
        busy: false,
        installCmd: buildInstallCmd(token),
      });
      wx.showToast({ title: '口令已重置' });
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
