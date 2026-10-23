import { request } from '../../utils/api';
import { getActiveCircleId } from '../../utils/circle';
import { getUserLocation } from '../../utils/location';

Page({
  data: {
    circleId: '',
    shops: [] as any[],
  },

  onShow() {
    this.load();
  },

  async load() {
    const circleId = getActiveCircleId();
    if (!circleId) {
      wx.showToast({ title: '请先创建或加入圈子', icon: 'none' });
      return;
    }
    this.setData({ circleId });
    const loc = await getUserLocation();
    if (!loc) {
      wx.showModal({
        title: '需要定位',
        content: '记美食需要获取当前位置，请在设置中开启定位权限。',
        showCancel: false,
      });
      return;
    }
    const q = new URLSearchParams({
      pageSize: '50',
      lat: String(loc.lat),
      lng: String(loc.lng),
    });
    const res = await request<{ items: any[] }>(
      `/api/circles/${circleId}/shops?${q.toString()}`
    );
    const shops = (res.items || []).filter((s) => s.hasCoords).slice(0, 20);
    this.setData({ shops });
  },

  pickShop(e: WechatMiniprogram.CustomEvent) {
    const shop = e.detail.shop;
    wx.navigateTo({
      url: `/pages/locate-note/locate-note?c=${this.data.circleId}&p=${encodeURIComponent(shop.poiKey)}&name=${encodeURIComponent(shop.name)}`,
    });
  },
});
