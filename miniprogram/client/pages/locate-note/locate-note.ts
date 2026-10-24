import { request } from '../../utils/api';

Page({
  data: {
    name: '',
    note: '',
    lat: 0,
    lng: 0,
    latLabel: '',
    lngLabel: '',
    address: '',
    locReady: false,
    locError: '',
    photoPath: '',
    saving: false,
  },

  onLoad(query: Record<string, string | undefined>) {
    if (query.name) {
      this.setData({ name: decodeURIComponent(query.name) });
    }
    this.refreshLoc();
  },

  onName(e: WechatMiniprogram.Input) {
    this.setData({ name: e.detail.value });
  },

  onNote(e: WechatMiniprogram.Input) {
    this.setData({ note: e.detail.value });
  },

  async refreshLoc() {
    this.setData({ locReady: false, locError: '' });
    try {
      const res = await new Promise<WechatMiniprogram.GetLocationSuccessCallbackResult>(
        (resolve, reject) => {
          wx.getLocation({ type: 'gcj02', success: resolve, fail: reject });
        }
      );
      this.setData({
        lat: res.latitude,
        lng: res.longitude,
        latLabel: res.latitude.toFixed(5),
        lngLabel: res.longitude.toFixed(5),
        locReady: true,
      });
    } catch {
      this.setData({
        locError: '无法获取定位，请在设置中开启位置权限后重试',
      });
    }
  },

  pickPhoto() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: (res: any) => {
        const path = res?.tempFiles?.[0]?.tempFilePath || '';
        if (path) this.setData({ photoPath: path });
      },
    });
  },

  clearPhoto() {
    this.setData({ photoPath: '' });
  },

  previewPhoto() {
    if (!this.data.photoPath) return;
    wx.previewImage({ urls: [this.data.photoPath] });
  },

  async onSave() {
    if (!this.data.locReady) {
      wx.showToast({ title: '请先获取定位', icon: 'none' });
      return;
    }
    const name =
      this.data.name.trim() ||
      `记下的位置 ${this.data.latLabel},${this.data.lngLabel}`;
    this.setData({ saving: true });
    try {
      // 今日真机版：照片先留本地路径占位；上云后可改为 uploadFile
      await request('/api/me/checkins', {
        method: 'POST',
        data: {
          name,
          note: this.data.note,
          lat: this.data.lat,
          lng: this.data.lng,
          address: this.data.address || undefined,
          photoUrl: this.data.photoPath || undefined,
        },
      });
      wx.showToast({ title: '已记下' });
      setTimeout(() => {
        wx.switchTab({ url: '/pages/my-shops/my-shops' });
      }, 400);
    } catch (err) {
      wx.showToast({ title: (err as Error).message, icon: 'none' });
    } finally {
      this.setData({ saving: false });
    }
  },
});
