/**
 * 旧「朋友圈」入口：合并进主页「吃货排行」后，这里只做跳转兼容。
 */
Page({
  onShow() {
    wx.reLaunch({ url: '/pages/my-shops/my-shops?panel=1' });
  },
});
