/**
 * 主页悬浮底栏：导入 / 连接AI / 记美食。
 * 产品：两主页共用同一入口，不依赖系统 tabBar。
 */
Component({
  methods: {
    onImport() {
      wx.navigateTo({ url: '/pages/import/import' });
    },
    onConnectAi() {
      wx.navigateTo({ url: '/pages/connect-ai/connect-ai' });
    },
    onLocate() {
      wx.navigateTo({ url: '/pages/locate-note/locate-note' });
    },
  },
});
