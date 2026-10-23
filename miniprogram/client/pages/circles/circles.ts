import { request } from '../../utils/api';

Page({
  data: {
    items: [] as any[],
  },

  onShow() {
    this.load();
  },

  async load() {
    try {
      const res = await request<{ items: any[] }>('/api/circles');
      this.setData({ items: res.items || [] });
    } catch (err) {
      wx.showToast({ title: (err as Error).message, icon: 'none' });
    }
  },

  async createCircle() {
    const res = await new Promise<WechatMiniprogram.ShowModalSuccessCallbackResult>(
      (resolve) => {
        wx.showModal({
          title: '创建收藏圈',
          editable: true,
          placeholderText: '给圈子起个名字',
          success: resolve,
          fail: () => resolve({ confirm: false, cancel: true, content: '' } as any),
        });
      }
    );
    if (!res.confirm || !res.content) return;
    try {
      const circle = await request<{ id: string }>('/api/circles', {
        method: 'POST',
        data: { name: res.content },
      });
      wx.navigateTo({
        url: `/pages/circle-detail/circle-detail?id=${circle.id}`,
      });
    } catch (err) {
      wx.showToast({ title: (err as Error).message, icon: 'none' });
    }
  },

  openCircle(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: `/pages/circle-detail/circle-detail?id=${id}` });
  },
});
