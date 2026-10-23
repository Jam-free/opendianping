import { request } from '../../utils/api';

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
    // 规格：必须主动点加入，不自动加入
    this.setData({ joining: true });
    try {
      let opengid: string | undefined;
      // 可选群绑定：从分享卡片进入时尝试解 shareTicket
      try {
        const enter = await new Promise<any>((resolve, reject) => {
          // @ts-ignore 基础库接口
          wx.getGroupEnterInfo({ success: resolve, fail: reject });
        });
        // 真实环境需后端用 session_key 解密；此处仅透传占位字段
        if (enter?.cloudID || enter?.encryptedData) {
          opengid = undefined;
        }
      } catch {
        /* 非群进入可忽略 */
      }

      await request(`/api/circles/${this.data.circleId}/join`, {
        method: 'POST',
        data: { token: this.data.token, opengid },
      });
      wx.redirectTo({ url: '/pages/index/index' });
    } catch (err) {
      this.setData({ joining: false });
      wx.showModal({
        title: '无法加入',
        content: (err as Error).message || '邀请可能已过期或已重置',
      });
    }
  },
});
