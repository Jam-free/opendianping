import { request, buildQuery } from '../../utils/api';
import { API_BASE } from '../../utils/config';
import { shopImageSrc } from '../../utils/media';

type PoiItem = {
  id: string;
  title: string;
  address: string;
  distance?: number;
  distanceLabel?: string;
  lat?: number;
  lng?: number;
};

/**
 * 把本地临时图读成 base64 上传，换成长住路径。
 * 设计决策：走 JSON+base64，避免云托管 callContainer 对 multipart 的坑。
 */
async function uploadLocalPhoto(tempPath: string): Promise<string> {
  const fs = wx.getFileSystemManager();
  const base64 = fs.readFileSync(tempPath, 'base64') as string;
  const res = await request<{ url: string }>('/api/me/photos', {
    method: 'POST',
    data: { base64, mime: 'image/jpeg' },
  });
  if (!res.url) throw new Error('上传失败');
  return res.url;
}

function formatPoiDistance(meters?: number): string {
  if (meters == null || !Number.isFinite(meters)) return '';
  if (meters < 1000) return `${Math.round(meters)}m`;
  return `${(meters / 1000).toFixed(1)}km`;
}

Page({
  data: {
    editing: false,
    favoriteId: '',
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
    /** 已上传的持久路径 /api/media/local/... */
    photoUrl: '',
    pois: [] as PoiItem[],
    selectedPoiId: '',
    saving: false,
  },

  onLoad(query: Record<string, string | undefined>) {
    if (query.name) {
      this.setData({ name: decodeURIComponent(query.name) });
    }
    if (query.fav) {
      this.setData({ editing: true, favoriteId: query.fav });
      this.loadEdit(query.fav);
      return;
    }
    this.refreshLoc();
  },

  async loadEdit(favoriteId: string) {
    try {
      const row = await request<{
        name: string;
        note: string | null;
        address: string | null;
        lat: number | null;
        lng: number | null;
        photoUrl: string | null;
        headImgProxy: string | null;
      }>(`/api/me/checkins/${favoriteId}`);
      const display = row.photoUrl
        ? `${API_BASE}${row.photoUrl}`
        : shopImageSrc(API_BASE, row.headImgProxy);
      this.setData({
        name: row.name || '',
        note: '',
        address: row.address || '',
        lat: row.lat || 0,
        lng: row.lng || 0,
        latLabel: row.lat != null ? row.lat.toFixed(5) : '',
        lngLabel: row.lng != null ? row.lng.toFixed(5) : '',
        locReady: true,
        photoUrl: row.photoUrl || '',
        photoPath: row.photoUrl || row.headImgProxy ? display : '',
      });
    } catch (err) {
      wx.showToast({ title: (err as Error).message, icon: 'none' });
    }
  },

  onName(e: WechatMiniprogram.Input) {
    this.setData({ name: e.detail.value, selectedPoiId: '' });
  },

  onNote(e: WechatMiniprogram.Input) {
    this.setData({ note: e.detail.value });
  },

  pickPoi(e: WechatMiniprogram.TouchEvent) {
    const id = String(e.currentTarget.dataset.id || '');
    const poi = (this.data.pois as PoiItem[]).find((p) => p.id === id);
    if (!poi) return;
    this.setData({
      selectedPoiId: id,
      name: poi.title,
      address: poi.address || this.data.address,
      lat: poi.lat != null ? poi.lat : this.data.lat,
      lng: poi.lng != null ? poi.lng : this.data.lng,
      latLabel:
        poi.lat != null ? poi.lat.toFixed(5) : this.data.latLabel,
      lngLabel:
        poi.lng != null ? poi.lng.toFixed(5) : this.data.lngLabel,
    });
  },

  async refreshLoc() {
    this.setData({
      locReady: false,
      locError: '',
      address: '',
      pois: [],
      selectedPoiId: '',
    });
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

      try {
        const qs = buildQuery({ lat, lng });
        const geo = await request<{
          address: string;
          district?: string;
          pois?: Array<{
            id: string;
            title: string;
            address: string;
            distance?: number;
            lat?: number;
            lng?: number;
          }>;
        }>(`/api/geo/reverse?${qs}`);
        const address = geo.address || '';
        const pois: PoiItem[] = (geo.pois || []).map((p) => ({
          ...p,
          distanceLabel: formatPoiDistance(p.distance),
        }));
        const patch: Record<string, unknown> = { address, pois };
        if (!this.data.name.trim() && pois[0]) {
          patch.name = pois[0].title;
          patch.selectedPoiId = pois[0].id;
          if (pois[0].address) patch.address = pois[0].address;
          if (pois[0].lat != null) {
            patch.lat = pois[0].lat;
            patch.latLabel = pois[0].lat.toFixed(5);
          }
          if (pois[0].lng != null) {
            patch.lng = pois[0].lng;
            patch.lngLabel = pois[0].lng.toFixed(5);
          }
        } else if (!this.data.name.trim() && address) {
          const short =
            geo.district ||
            address.split(/省|市|区|县/).filter(Boolean).pop() ||
            address.slice(0, 20);
          patch.name = String(short).trim();
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
        if (path) {
          this.setData({ photoPath: path, photoUrl: '' });
        }
      },
    });
  },

  clearPhoto() {
    this.setData({ photoPath: '', photoUrl: '' });
  },

  previewPhoto() {
    if (!this.data.photoPath) return;
    wx.previewImage({ urls: [this.data.photoPath] });
  },

  async resolvePhotoUrl(): Promise<string | undefined> {
    // 已有持久路径且没换新临时图
    if (
      this.data.photoUrl &&
      this.data.photoUrl.startsWith('/api/media/local/')
    ) {
      return this.data.photoUrl;
    }
    const path = this.data.photoPath;
    if (!path) return undefined;
    // 本地临时文件才上传
    if (
      path.startsWith('wxfile://') ||
      path.startsWith('http://tmp') ||
      path.indexOf('://tmp') >= 0 ||
      !path.startsWith('http')
    ) {
      wx.showLoading({ title: '上传图片…', mask: true });
      try {
        const url = await uploadLocalPhoto(path);
        this.setData({ photoUrl: url });
        return url;
      } finally {
        wx.hideLoading();
      }
    }
    return undefined;
  },

  async onSave() {
    if (!this.data.editing && !this.data.locReady) {
      wx.showToast({ title: '请先获取定位', icon: 'none' });
      return;
    }
    const name =
      this.data.name.trim() ||
      this.data.address ||
      `记下的位置 ${this.data.latLabel},${this.data.lngLabel}`;
    this.setData({ saving: true });
    try {
      const photoUrl = await this.resolvePhotoUrl();
      if (this.data.editing) {
        await request(`/api/me/checkins/${this.data.favoriteId}`, {
          method: 'PATCH',
          data: {
            name,
            address: this.data.address || undefined,
            note: this.data.note || undefined,
            photoUrl:
              photoUrl !== undefined
                ? photoUrl
                : this.data.photoPath
                  ? undefined
                  : '',
          },
        });
        wx.showToast({ title: '已保存' });
        setTimeout(() => wx.navigateBack(), 400);
        return;
      }

      await request('/api/me/checkins', {
        method: 'POST',
        data: {
          name,
          note: this.data.note,
          lat: this.data.lat,
          lng: this.data.lng,
          address: this.data.address || undefined,
          photoUrl,
          poiId: this.data.selectedPoiId || undefined,
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
