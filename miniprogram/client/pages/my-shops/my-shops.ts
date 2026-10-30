import {
  request,
  buildQuery,
  peekCachedUser,
  saveCachedUser,
  hasSession,
  goLoginGate,
  ensureLogin,
} from '../../utils/api';
import { getUserLocation } from '../../utils/location';
import { getActiveCircleId, setActiveCircleId } from '../../utils/circle';
import { avatarInitial } from '../../utils/format';
import { API_BASE } from '../../utils/config';
import { userAvatarSrc } from '../../utils/media';

type Friend = {
  id: string;
  nickname: string | null;
  avatar: string | null;
  avatarSrc: string;
  sharedShopCount: number;
  initial: string;
};

function friendAvatarSrc(avatar?: string | null): string {
  if (!avatar) return '';
  if (avatar.startsWith('/api/')) return `${API_BASE}${avatar}`;
  return avatar;
}

/**
 * 双主页壳：私藏好店 ↔ 吃货排行。
 * 顶部大/小标题对调 + 内容区左右滑；底栏悬浮条两页共用。
 */
Page({
  data: {
    panel: 0 as 0 | 1,
    statusPad: 48,
    shopsLoading: true,
    friendsLoading: true,
    shops: [] as any[],
    friends: [] as Friend[],
    networkId: '',
    inviteToken: '',
    loginError: '',
    avatar: '',
    initial: '?',
  },

  onLoad(query: Record<string, string | undefined>) {
    const panel = query.panel === '1' || query.panel === 'rank' ? 1 : 0;
    // 自定义顶栏：避开状态栏；头像尽量对齐右上角胶囊
    try {
      const wxAny = wx as any;
      const sys = wxAny.getSystemInfoSync?.() || {};
      const menu = wxAny.getMenuButtonBoundingClientRect?.() || {};
      const statusPad = menu.bottom
        ? menu.bottom + 8
        : (sys.statusBarHeight || 20) + 12;
      this.setData({ statusPad, ...(panel ? { panel } : {}) });
    } catch {
      if (panel) this.setData({ panel });
    }
  },

  onShow() {
    if (!hasSession()) {
      goLoginGate();
      return;
    }
    wx.showShareMenu({ withShareTicket: true, menus: ['shareAppMessage'] });
    this.hydrateMe();
    this.loadShops();
    this.loadFriends();
  },

  goPanel(e: WechatMiniprogram.TouchEvent) {
    const panel = Number(e.currentTarget.dataset.panel);
    if (panel !== 0 && panel !== 1) return;
    if (panel === this.data.panel) return;
    this.setData({ panel: panel as 0 | 1 });
  },

  onSwipe(e: { detail: { current: number } }) {
    const panel = Number(e.detail.current) as 0 | 1;
    if (panel === this.data.panel) return;
    this.setData({ panel });
  },

  hydrateMe() {
    const cached = peekCachedUser();
    if (cached) {
      this.setData({
        avatar: userAvatarSrc(API_BASE, cached.avatar),
        initial: avatarInitial(cached.nickname),
      });
    }
    request<{
      user: { id: string; nickname?: string | null; avatar?: string | null };
    }>('/api/me')
      .then((me) => {
        saveCachedUser(me.user);
        this.setData({
          avatar: userAvatarSrc(API_BASE, me.user.avatar),
          initial: avatarInitial(me.user.nickname),
        });
      })
      .catch(() => {
        /* 401 会踢回登录 */
      });
  },

  async ensureCircleId(): Promise<string> {
    const cached = getActiveCircleId();
    if (cached) return cached;
    try {
      const net = await request<{ networkId: string }>('/api/me/network');
      if (net.networkId) {
        setActiveCircleId(net.networkId);
        return net.networkId;
      }
    } catch {
      /* ignore */
    }
    return '';
  },

  async loadShops() {
    this.setData({ shopsLoading: true });
    try {
      await this.ensureCircleId();
      const loc = await getUserLocation();
      const qs = buildQuery({
        lat: loc ? loc.lat : undefined,
        lng: loc ? loc.lng : undefined,
      });
      const res = await request<{ items: any[] }>(
        `/api/me/shops${qs ? `?${qs}` : ''}`
      );
      this.setData({ shops: res.items || [], shopsLoading: false });
    } catch (err) {
      this.setData({ shopsLoading: false });
      wx.showToast({ title: (err as Error).message, icon: 'none' });
    }
  },

  async loadFriends() {
    this.setData({ friendsLoading: true, loginError: '' });
    try {
      const net = await request<{
        networkId: string;
        inviteToken: string;
        friends: Array<{
          id: string;
          nickname: string | null;
          avatar: string | null;
          sharedShopCount: number;
        }>;
      }>('/api/me/network');
      setActiveCircleId(net.networkId);
      // 吃货排行：共享店数多的靠前
      const friends = (net.friends || [])
        .map((f) => ({
          ...f,
          avatarSrc: friendAvatarSrc(f.avatar),
          initial: avatarInitial(f.nickname),
        }))
        .sort((a, b) => b.sharedShopCount - a.sharedShopCount);
      this.setData({
        friends,
        networkId: net.networkId,
        inviteToken: net.inviteToken,
        friendsLoading: false,
        loginError: '',
      });
    } catch (err) {
      const msg = (err as Error).message || '加载失败';
      this.setData({
        friendsLoading: false,
        loginError: msg.includes('登录') || msg.includes('401')
          ? '登录已失效，点此重新登录'
          : msg.includes('503') || msg.includes('不可用')
            ? '服务暂时繁忙，点此重试'
            : `${msg} · 点此重试`,
      });
    }
  },

  async retryLogin() {
    try {
      await ensureLogin({ force: true, interactive: true });
      this.setData({ loginError: '' });
      await this.loadFriends();
    } catch {
      /* 登录页会展示错误 */
    }
  },

  goAccount() {
    wx.navigateTo({ url: '/pages/account/account' });
  },

  goImport() {
    wx.navigateTo({ url: '/pages/import/import' });
  },

  goLocate() {
    wx.navigateTo({ url: '/pages/locate-note/locate-note' });
  },

  onShareAppMessage() {
    const { networkId, inviteToken } = this.data;
    if (!networkId || !inviteToken) {
      return {
        title: '我和我爱吃的朋友们 · 一起收藏好店',
        path: '/pages/my-shops/my-shops',
      };
    }
    return {
      title: '来我和我爱吃的朋友们，一起共享收藏的店',
      path: `/pages/join/join?c=${networkId}&t=${inviteToken}`,
    };
  },

  openFriend(e: WechatMiniprogram.TouchEvent) {
    const id = String(e.currentTarget.dataset.id || '');
    const name = encodeURIComponent(
      String(e.currentTarget.dataset.name || '朋友')
    );
    wx.navigateTo({
      url: `/pages/friend-shops/friend-shops?c=${this.data.networkId}&m=${id}&n=${name}`,
    });
  },

  async openShop(e: WechatMiniprogram.CustomEvent) {
    const shop = e?.detail?.shop;
    if (!shop || !shop.poiKey) {
      wx.showToast({ title: '店铺信息还没准备好', icon: 'none' });
      return;
    }
    const circleId = await this.ensureCircleId();
    if (!circleId) {
      wx.showToast({ title: '美食网还没就绪，稍后再试', icon: 'none' });
      return;
    }
    wx.navigateTo({
      url: `/pages/shop-detail/shop-detail?c=${circleId}&p=${encodeURIComponent(shop.poiKey)}`,
    });
  },
});
