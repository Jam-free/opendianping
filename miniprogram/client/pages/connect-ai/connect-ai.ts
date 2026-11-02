import { request } from '../../utils/api';
import { API_BASE } from '../../utils/config';

const SKILL_DIR =
  'https://github.com/Jam-free/opendianping/tree/main/skills/feimaocat-cloud';

/** 尽量短：粘贴给 AI 就能用 */
function buildInstallCmd(token: string): string {
  return [
    '你是我的美食助手。用下面接口读写「我的店」；写入前先跟我确认店名，以及要不要标「心心念念」。',
    '',
    `FEIMAOCAT_API_BASE=${API_BASE}`,
    `FEIMAOCAT_TOKEN=${token}`,
    '',
    '所有请求加 Header：Authorization: Bearer $FEIMAOCAT_TOKEN',
    'GET  $FEIMAOCAT_API_BASE/api/agent/shops',
    'GET  $FEIMAOCAT_API_BASE/api/agent/friends',
    'POST $FEIMAOCAT_API_BASE/api/agent/shops',
    'POST 示例：{"name":"店名","city":"城市","note":"备注","wishlist":false}',
    '',
    `说明：${SKILL_DIR}`,
  ].join('\n');
}

Page({
  data: {
    capabilities: [
      { title: '查看我的店', desc: '读你导入、记下和好友共享的店' },
      { title: '记下店铺', desc: '确认后写入你的「我的店」' },
      { title: '附近与路线', desc: '按距离挑店、串店顺序' },
      { title: '心心念念', desc: '优先用你很想去的店来规划' },
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
      installCmd: buildInstallCmd('<点下方复制后这里会变成真实 Token>'),
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
      success: () => wx.showToast({ title: '已复制 Token' }),
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
      wx.showToast({ title: 'Token 已重置' });
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
