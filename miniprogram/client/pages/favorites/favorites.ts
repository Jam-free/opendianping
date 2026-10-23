import { openNavigation, request } from '../../utils/api';

Page({
  data: {
    items: [] as any[],
  },

  onShow() {
    this.load();
  },

  async load() {
    try {
      const res = await request<{ items: any[] }>('/api/favorites');
      this.setData({ items: res.items || [] });
    } catch (err) {
      wx.showToast({ title: (err as Error).message, icon: 'none' });
    }
  },

  async toggleVis(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    const vis = e.currentTarget.dataset.vis as string;
    const next = vis === 'circles' ? 'private' : 'circles';
    try {
      await request(`/api/favorites/${id}`, {
        method: 'PATCH',
        data: { visibility: next },
      });
      this.load();
    } catch (err) {
      wx.showToast({ title: (err as Error).message, icon: 'none' });
    }
  },

  nav(e: WechatMiniprogram.TouchEvent) {
    const index = Number(e.currentTarget.dataset.index);
    const item = this.data.items[index];
    if (!item) return;
    openNavigation({
      name: item.name,
      lat: item.lat,
      lng: item.lng,
      address: item.address,
    });
  },

  async remove(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    const ok = await new Promise<boolean>((resolve) => {
      wx.showModal({
        title: '删除收藏？',
        success: (r) => resolve(Boolean(r.confirm)),
      });
    });
    if (!ok) return;
    try {
      await request(`/api/favorites/${id}`, { method: 'DELETE' });
      this.load();
    } catch (err) {
      wx.showToast({ title: (err as Error).message, icon: 'none' });
    }
  },
});
