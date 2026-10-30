import { request } from '../../utils/api';
import { API_BASE } from '../../utils/config';

/** Skill 说明：放在默认分支 main，外部 Agent 克隆 / 打开默认仓库就能看到 */
const SKILL_DIR =
  'https://github.com/Jam-free/opendianping/tree/main/skills/feimaocat-cloud';
const SKILL_RAW =
  'https://raw.githubusercontent.com/Jam-free/opendianping/main/skills/feimaocat-cloud/SKILL.md';

function buildInstallCmd(token: string): string {
  return [
    '# 美食肥猫 · 发给你的 AI（Cursor / Claude / Grok 等）',
    '# 下面已含个人 Token，粘贴后按说明只读调用即可',
    '',
    `export FEIMAOCAT_API_BASE="${API_BASE}"`,
    `export FEIMAOCAT_TOKEN="${token}"`,
    '',
    '# 只读接口（Header: Authorization: Bearer $FEIMAOCAT_TOKEN）',
    'GET $FEIMAOCAT_API_BASE/api/agent/shops',
    'GET $FEIMAOCAT_API_BASE/api/agent/friends',
    '',
    '# wishlist=true =「心心念念」（很想去），筛店/规划优先用这些',
    '',
    '# Skill 说明（仓库公开；请读 main 分支）',
    SKILL_DIR,
    SKILL_RAW,
    '',
    '# 不要用 npx skills add feimaocat/food-network（包不存在）',
    '# 若 Agent 装不了 GitHub Skill：直接按上面两个 GET 调接口即可',
  ].join('\n');
}

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
      installCmd: buildInstallCmd('<点下方「一键复制」后这里会变成真实 Token>'),
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

  /**
   * 服务端只存哈希，明文只在签发那一刻返回。
   * 本页没有 plainToken 时，必须重新签发才能拼进完整指令。
   */
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

  /** 一键：没有明文就签发，写入完整指令并复制（含 Token） */
  async copyInstall() {
    this.setData({ busy: true });
    try {
      const token = await this.ensurePlainToken();
      const cmd = buildInstallCmd(token);
      this.setData({ installCmd: cmd, busy: false });
      wx.setClipboardData({
        data: cmd,
        success: () =>
          wx.showToast({ title: '已复制完整指令', icon: 'success' }),
      });
    } catch (err) {
      this.setData({ busy: false });
      wx.showToast({ title: (err as Error).message, icon: 'none' });
    }
  },

  toggleToken() {
    if (!this.data.plainToken) {
      wx.showToast({
        title: '点「一键复制」会生成并可查看 Token',
        icon: 'none',
      });
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
