import { request } from '../../utils/api';

Page({
  data: {
    circleId: '',
    name: '',
    inviteToken: '',
    isOwner: false,
    shops: [] as any[],
    city: '',
    category: '',
  },

  onLoad(query: Record<string, string | undefined>) {
    const id = query.id || '';
    this.setData({ circleId: id });
    wx.showShareMenu({ withShareTicket: true, menus: ['shareAppMessage'] });
  },

  onShow() {
    if (this.data.circleId) {
      this.bootstrap();
    }
  },

  async bootstrap() {
    try {
      const list = await request<{ items: any[] }>('/api/circles');
      const mine = (list.items || []).find((c) => c.id === this.data.circleId);
      if (!mine) {
        wx.showToast({ title: '你不在该圈内', icon: 'none' });
        return;
      }
      this.setData({
        name: mine.name,
        isOwner: mine.role === 'owner',
        inviteToken: mine.invite_token || this.data.inviteToken || '',
      });
      await this.loadShops();
    } catch (err) {
      wx.showToast({ title: (err as Error).message, icon: 'none' });
    }
  },

  onCity(e: WechatMiniprogram.Input) {
    this.setData({ city: e.detail.value });
  },

  onCategory(e: WechatMiniprogram.Input) {
    this.setData({ category: e.detail.value });
  },

  async loadShops() {
    const q: string[] = [];
    if (this.data.city) q.push(`city=${encodeURIComponent(this.data.city)}`);
    if (this.data.category) {
      q.push(`category=${encodeURIComponent(this.data.category)}`);
    }
    const qs = q.length ? `?${q.join('&')}` : '';
    try {
      const res = await request<{ items: any[] }>(
        `/api/circles/${this.data.circleId}/shops${qs}`
      );
      this.setData({ shops: res.items || (res as any).items || [] });
    } catch (err) {
      wx.showToast({ title: (err as Error).message, icon: 'none' });
    }
  },

  onShareAppMessage() {
    const { circleId, inviteToken, name } = this.data;
    return {
      title: `邀请你加入收藏圈「${name || '一起探店'}」`,
      path: `/pages/join/join?c=${circleId}&t=${inviteToken}`,
    };
  },

  async resetInvite() {
    try {
      const res = await request<{ inviteToken: string }>(
        `/api/circles/${this.data.circleId}/reset-invite`,
        { method: 'POST' }
      );
      this.setData({ inviteToken: res.inviteToken });
      wx.showToast({ title: '邀请已重置' });
    } catch (err) {
      wx.showToast({ title: (err as Error).message, icon: 'none' });
    }
  },

  async leave() {
    try {
      await request(`/api/circles/${this.data.circleId}/leave`, {
        method: 'POST',
      });
      wx.navigateBack();
    } catch (err) {
      wx.showToast({ title: (err as Error).message, icon: 'none' });
    }
  },

  async dissolve() {
    const ok = await new Promise<boolean>((resolve) => {
      wx.showModal({
        title: '解散收藏圈？',
        content: '成员将无法再看到圈内共享',
        success: (r) => resolve(Boolean(r.confirm)),
      });
    });
    if (!ok) return;
    try {
      await request(`/api/circles/${this.data.circleId}`, { method: 'DELETE' });
      wx.navigateBack();
    } catch (err) {
      wx.showToast({ title: (err as Error).message, icon: 'none' });
    }
  },
});
