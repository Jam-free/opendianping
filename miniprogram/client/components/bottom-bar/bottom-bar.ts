Component({
  methods: {
    onImport() {
      wx.navigateTo({ url: '/pages/import/import' });
    },
    onLocate() {
      wx.navigateTo({ url: '/pages/locate/locate' });
    },
    onInvite() {
      wx.navigateTo({ url: '/pages/invite/invite' });
    },
  },
});
