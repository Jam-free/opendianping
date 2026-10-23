import { request } from '../../utils/api';
import { getUserLocation } from '../../utils/location';

Page({
  data: {
    circleId: '',
    memberId: '',
    shops: [] as any[],
    shopsNoCoord: [] as any[],
    noCoordSection: false,
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
    const loc = await getUserLocation();
    const q = new URLSearchParams({
      pageSize: '200',
      memberId: this.data.memberId,
    });
    if (loc) {
      q.set('lat', String(loc.lat));
      q.set('lng', String(loc.lng));
    }
    const res = await request<{ items: any[] }>(
      `/api/circles/${this.data.circleId}/shops?${q.toString()}`
    );
    const items = res.items || [];
    this.setData({
      shops: items.filter((s) => s.hasCoords),
      shopsNoCoord: items.filter((s) => !s.hasCoords),
      noCoordSection:
        items.some((s) => s.hasCoords) && items.some((s) => !s.hasCoords),
    });
  },

  openShop(e: WechatMiniprogram.CustomEvent) {
    const shop = e.detail.shop;
    wx.navigateTo({
      url: `/pages/shop-detail/shop-detail?c=${this.data.circleId}&p=${encodeURIComponent(shop.poiKey)}`,
    });
  },
});
