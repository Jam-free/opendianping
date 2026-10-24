import { request, buildQuery } from '../../utils/api';
import { getUserLocation } from '../../utils/location';
import { getActiveCircleId } from '../../utils/circle';

Page({
  data: {
    loading: true,
    shops: [] as any[],
  },

  onShow() {
    this.load();
  },

  onPullDownRefresh() {
    this.load().finally(() => wx.stopPullDownRefresh());
  },

  async load() {
    this.setData({ loading: true });
    try {
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

  goImport() {
    wx.navigateTo({ url: '/pages/import/import' });
  },

  goConnectAi() {
    wx.navigateTo({ url: '/pages/connect-ai/connect-ai' });
  },

  goLocate() {
    wx.navigateTo({ url: '/pages/locate-note/locate-note' });
  },

  openShop(e: WechatMiniprogram.CustomEvent) {
    const shop = e.detail.shop;
    const circleId = getActiveCircleId();
    if (circleId && shop.poiKey) {
      wx.navigateTo({
        url: `/pages/shop-detail/shop-detail?c=${circleId}&p=${encodeURIComponent(shop.poiKey)}`,
      });
      return;
    }
    wx.showToast({ title: shop.name || '店铺', icon: 'none' });
  },
});
