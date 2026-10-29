import { request } from '../../utils/api';
import { getActiveCircleId, setActiveCircleId } from '../../utils/circle';

Page({
  data: {
    circle: null as any,
    inviteToken: '',
  },

  onShow() {
    wx.showShareMenu({ withShareTicket: true, menus: ['shareAppMessage'] });
    this.load();
  },

  async load() {
    try {
      const res = await request<{ items: any[] }>('/api/circles');
      const items = res.items || [];
      let activeId = getActiveCircleId();
      let circle = items.find((c) => c.id === activeId) || items[0];
      if (circle && !activeId) {
        setActiveCircleId(circle.id);
      }
      const token = circle?.invite_token || '';
      this.setData({ circle, inviteToken: token });
    } catch (err) {
      wx.showToast({ title: (err as Error).message, icon: 'none' });
    }
  },

  onShareAppMessage() {
    const { circle, inviteToken } = this.data;
    if (!circle || !inviteToken) {
      return { title: '我和我爱吃的朋友们 · 一起收藏好店', path: '/pages/index/index' };
    }
    return {
      title: `邀请你加入「${circle.name}」`,
      path: `/pages/join/join?c=${circle.id}&t=${inviteToken}`,
    };
  },

  async createCircle() {
    const res = await new Promise<WechatMiniprogram.ShowModalSuccessCallbackResult>(
      (resolve) => {
        wx.showModal({
          title: '创建收藏圈',
          editable: true,
          placeholderText: '圈子名称',
          success: resolve,
          fail: () => resolve({ confirm: false, cancel: true, content: '' } as any),
        });
      }
    );
    if (!res.confirm || !res.content) return;
    try {
      const circle = await request<any>('/api/circles', {
        method: 'POST',
        data: { name: res.content },
      });
      setActiveCircleId(circle.id);
      this.setData({ circle, inviteToken: circle.inviteToken });
    } catch (err) {
      wx.showToast({ title: (err as Error).message, icon: 'none' });
    }
  },
});
