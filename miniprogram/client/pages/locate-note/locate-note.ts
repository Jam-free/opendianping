import { request, buildQuery } from '../../utils/api';

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
    this.setData({ locReady: false, locError: '', address: '' });
    try {
      const res = await new Promise<WechatMiniprogram.GetLocationSuccessCallbackResult>(
        (resolve, reject) => {
          wx.getLocation({ type: 'gcj02', success: resolve, fail: reject });
        }
      );
      const lat = res.latitude;
      const lng = res.longitude;
      this.setData({
        lat,
        lng,
        latLabel: lat.toFixed(5),
        lngLabel: lng.toFixed(5),
        locReady: true,
        address: '正在解析地址…',
      });

      // 逆地理：把经纬度变成人能读的地址
      try {
        const qs = buildQuery({ lat, lng });
        const geo = await request<{ address: string; district?: string }>(
          `/api/geo/reverse?${qs}`
        );
        const address = geo.address || '';
        const patch: Record<string, string> = { address };
        // 店名为空时，用商圈/地址末段预填，用户可改
        if (!this.data.name.trim() && address) {
          const short =
            geo.district ||
            address.split(/省|市|区|县/).filter(Boolean).pop() ||
            address.slice(0, 20);
          patch.name = short.trim();
        }
        this.setData(patch);
      } catch {
        this.setData({
          address: `已定位（${lat.toFixed(4)}, ${lng.toFixed(4)}）`,
        });
      }
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
      this.data.address ||
      `记下的位置 ${this.data.latLabel},${this.data.lngLabel}`;
    this.setData({ saving: true });
    try {
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
