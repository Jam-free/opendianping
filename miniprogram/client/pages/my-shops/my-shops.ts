import {
  request,
  buildQuery,
  peekCachedUser,
  saveCachedUser,
  hasSession,
  goLoginGate,
} from '../../utils/api';
import { getUserLocation } from '../../utils/location';
import { getActiveCircleId, setActiveCircleId } from '../../utils/circle';
import { avatarInitial } from '../../utils/format';

/**
 * 「我的店」：默认主页。核心路径是导入/看收藏；顶栏头像进账号可撤权。
 */
Page({
  data: {
    loading: true,
    shops: [] as any[],
    avatar: '',
    initial: '?',
  },

  onShow() {
    if (!hasSession()) {
      goLoginGate();
      return;
    }
    this.hydrateMe();
    this.load();
  },

  onPullDownRefresh() {
    this.load().finally(() => wx.stopPullDownRefresh());
  },

  hydrateMe() {
    const cached = peekCachedUser();
    if (cached) {
      this.setData({
        avatar: cached.avatar || '',
        initial: avatarInitial(cached.nickname),
      });
    }
    request<{
      user: { id: string; nickname?: string | null; avatar?: string | null };
    }>('/api/me')
      .then((me) => {
        saveCachedUser(me.user);
        this.setData({
          avatar: me.user.avatar || '',
          initial: avatarInitial(me.user.nickname),
        });
      })
      .catch(() => {
        /* 401 会踢回登录 */
      });
  },

  /** 详情页要带圈子 id；没缓存时从美食网接口补一份 */
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

  async load() {
    this.setData({ loading: true });
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
      this.setData({ shops: res.items || [], loading: false });
    } catch (err) {
      this.setData({ loading: false });
      wx.showToast({ title: (err as Error).message, icon: 'none' });
    }
  },

  goAccount() {
    wx.navigateTo({ url: '/pages/account/account' });
  },

  goImport() {
    wx.navigateTo({ url: '/pages/import/import' });
  },

  goConnectAi() {
    wx.navigateTo({ url: '/pages/connect-ai/connect-ai' });
  },

  goLocate() {
    wx.navigateTo({ url: '/pages/locate-note/locate-note' });
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
