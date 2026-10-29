import { warmCloud } from './utils/cloud';

/**
 * 小程序入口。
 * 设计决策：启动不再静默登录——首屏是登录门禁；有票由登录页验过后进「我的店」。
 * 云要尽早就绪：肥猫借用美食探索的云托管，初始化比本机环境多一步。
 * withShareTicket：分享到群后，打开者可拿到群信息用于「仅本群可加入」校验。
 */
App({
  globalData: {
    token: '' as string,
    userId: '' as string,
    user: null as {
      id: string;
      nickname?: string | null;
      avatar?: string | null;
    } | null,
  },
  onLaunch() {
    warmCloud();
    wx.showShareMenu({
      withShareTicket: true,
      menus: ['shareAppMessage', 'shareTimeline'],
    });
    // 恢复本地票到内存，供登录页 hasSession / 业务页使用；不自动换票
    try {
      const token = wx.getStorageSync('session_token') as string;
      if (token) this.globalData.token = token;
      const user = wx.getStorageSync('session_user') as {
        id: string;
        nickname?: string | null;
        avatar?: string | null;
      };
      if (user && user.id) {
        this.globalData.user = user;
        this.globalData.userId = user.id;
      }
    } catch {
      /* ignore */
    }
  },
});
