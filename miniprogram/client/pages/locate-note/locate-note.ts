import { request } from '../../utils/api';

Page({
  data: {
    circleId: '',
    poiKey: '',
    name: '',
    note: '',
    saving: false,
  },

  onLoad(query: Record<string, string | undefined>) {
    this.setData({
      circleId: query.c || '',
      poiKey: decodeURIComponent(query.p || ''),
      name: query.name ? decodeURIComponent(query.name) : '',
    });
  },

  onNote(e: WechatMiniprogram.Input) {
    this.setData({ note: e.detail.value });
  },

  async onSave() {
    this.setData({ saving: true });
    try {
      await request(`/api/circles/${this.data.circleId}/favorites`, {
        method: 'POST',
        data: { poiKey: this.data.poiKey, note: this.data.note },
      });
      wx.showToast({ title: '已保存' });
      setTimeout(() => wx.navigateBack({ delta: 2 }), 500);
    } catch (err) {
      wx.showToast({ title: (err as Error).message, icon: 'none' });
    } finally {
      this.setData({ saving: false });
    }
  },
});
