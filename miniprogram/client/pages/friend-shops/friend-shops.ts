import { request, buildQuery } from '../../utils/api';
import { getUserLocation } from '../../utils/location';

Page({
  data: {
    circleId: '',
    memberId: '',
    shops: [] as any[],
    loading: true,
  },

  onLoad(query: Record<string, string | undefined>) {
    const circleId = query.c || '';
    const memberId = query.m || '';
    const name = query.n ? decodeURIComponent(query.n) : '朋友';
    this.setData({ circleId, memberId });
    wx.setNavigationBarTitle({ title: `${name} 的收藏` });
    this.load();
  },

  async load() {
    this.setData({ loading: true });
    try {
      const loc = await getUserLocation();
      const qs = buildQuery({
        pageSize: '200',
        memberId: this.data.memberId,
        lat: loc ? loc.lat : undefined,
        lng: loc ? loc.lng : undefined,
      });
      const res = await request<{ items: any[] }>(
        `/api/circles/${this.data.circleId}/shops?${qs}`
      );
      this.setData({
        shops: res.items || [],
        loading: false,
      });
    } catch (err) {
      this.setData({ loading: false });
      wx.showToast({ title: (err as Error).message, icon: 'none' });
    }
  },

  openShop(e: WechatMiniprogram.CustomEvent) {
    const shop = e?.detail?.shop;
    if (!shop?.poiKey || !this.data.circleId) {
      wx.showToast({ title: '店铺信息还没准备好', icon: 'none' });
      return;
    }
    wx.navigateTo({
      url: `/pages/shop-detail/shop-detail?c=${this.data.circleId}&p=${encodeURIComponent(shop.poiKey)}`,
    });
  },
});
