import { request } from '../../utils/api';
import { setActiveCircleId } from '../../utils/circle';

Page({
  data: {
    circleId: '',
    token: '',
    info: {} as any,
    joining: false,
  },

  onLoad(query: Record<string, string | undefined>) {
    const circleId = query.c || '';
    const token = query.t || '';
    this.setData({ circleId, token });
    if (circleId) this.loadPreview();
  },

  async loadPreview() {
    try {
      const info = await request<any>(
        `/api/circles/${this.data.circleId}/preview`
      );
      this.setData({ info });
    } catch (err) {
      wx.showToast({ title: (err as Error).message, icon: 'none' });
    }
  },

  async onJoin() {
    this.setData({ joining: true });
    try {
      await request(`/api/circles/${this.data.circleId}/join`, {
        method: 'POST',
        data: { token: this.data.token },
      });
      setActiveCircleId(this.data.circleId);
      wx.showToast({ title: '已加入' });
      setTimeout(() => {
        wx.reLaunch({ url: '/pages/my-shops/my-shops?panel=1' });
      }, 400);
    } catch (err) {
      this.setData({ joining: false });
      wx.showModal({
        title: '无法加入',
        content: (err as Error).message || '邀请可能已过期或已重置',
      });
    }
  },
});
