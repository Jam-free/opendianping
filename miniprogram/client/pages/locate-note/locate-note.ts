import { request, ensureLogin } from '../../utils/api';
import { API_BASE } from '../../utils/config';
import { shopImageSrc } from '../../utils/media';
import {
  chooseLocatePhotos,
  clearLocateDraft,
  LocatePlace,
  MAX_LOCATE_PHOTOS,
  readLocateDraft,
  writeLocateDraft,
} from '../../utils/locate-draft';
import {
  compressPhotoForUpload,
  estimatePayloadBytes,
  readPhotoBase64,
  uploadPhotoPublic,
} from '../../utils/photo-upload';

async function uploadLocalPhoto(tempPath: string): Promise<string> {
  const compressed = await compressPhotoForUpload(tempPath);
  const base64 = await readPhotoBase64(compressed);
  const payload = estimatePayloadBytes(base64);
  const token = await ensureLogin();

  if (payload > 90 * 1024) {
    return uploadPhotoPublic(base64, token);
  }

  try {
    const res = await request<{ url: string }>('/api/me/photos', {
      method: 'POST',
      data: { base64, mime: 'image/jpeg' },
    });
    if (!res.url) throw new Error('上传失败');
    return res.url;
  } catch (err) {
    const msg = (err as Error).message || '';
    if (/太大|606001|上传失败|网络/i.test(msg)) {
      return uploadPhotoPublic(base64, token);
    }
    throw err;
  }
}

function isTempPath(path: string): boolean {
  if (!path) return false;
  if (path.startsWith('/api/media/')) return false;
  if (path.startsWith('http://') || path.startsWith('https://')) {
    return path.indexOf('://tmp') >= 0;
  }
  return true;
}

Page({
  data: {
    editing: false,
    favoriteId: '',
    note: '',
    photos: [] as string[],
    /** 已上传封面（编辑态或本轮上传结果） */
    photoUrl: '',
    maxPhotos: MAX_LOCATE_PHOTOS,
    place: null as LocatePlace | null,
    placeName: '',
    placeSub: '',
    saving: false,
  },

  onLoad(query: Record<string, string | undefined>) {
    if (query.fav) {
      this.setData({ editing: true, favoriteId: query.fav });
      this.loadEdit(query.fav);
      return;
    }
    this.hydrateFromDraft();
  },

  onShow() {
    // 从选点页返回时刷新美食地点；编辑已有记录不走草稿
    if (this.data.editing) return;
    this.hydratePlaceFromDraft();
  },

  hydrateFromDraft() {
    const draft = readLocateDraft();
    this.applyPlace(draft.place || null);
    this.setData({
      note: draft.note || '',
      photos: (draft.photos || []).slice(0, MAX_LOCATE_PHOTOS),
    });
  },

  hydratePlaceFromDraft() {
    const draft = readLocateDraft();
    if (draft.place) this.applyPlace(draft.place);
  },

  applyPlace(place: LocatePlace | null) {
    const placeSub = place
      ? [place.distanceLabel, place.address].filter(Boolean).join(' · ')
      : '';
    this.setData({
      place,
      placeName: place?.name || '',
      placeSub,
    });
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
      const place: LocatePlace | null =
        row.lat != null && row.lng != null
          ? {
              id: 'edit',
              name: row.name || '',
              address: row.address || '',
              lat: row.lat,
              lng: row.lng,
            }
          : null;
      this.applyPlace(place);
      this.setData({
        note: '',
        photoUrl: row.photoUrl || '',
        photos: display ? [display] : [],
      });
    } catch (err) {
      wx.showToast({ title: (err as Error).message, icon: 'none' });
    }
  },

  onNote(e: WechatMiniprogram.Input) {
    const note = e.detail.value || '';
    this.setData({ note });
    if (!this.data.editing) writeLocateDraft({ note });
  },

  async addPhoto() {
    const source = await new Promise<'camera' | 'album' | null>((resolve) => {
      wx.showActionSheet({
        itemList: ['拍摄', '从相册选择'],
        success: (r) =>
          resolve(r.tapIndex === 0 ? 'camera' : r.tapIndex === 1 ? 'album' : null),
        fail: () => resolve(null),
      });
    });
    if (!source) return;
    const more = await chooseLocatePhotos(source, this.data.photos.length);
    if (!more.length) return;
    const photos = [...this.data.photos, ...more].slice(0, MAX_LOCATE_PHOTOS);
    this.setData({ photos, photoUrl: '' });
    if (!this.data.editing) writeLocateDraft({ photos });
  },

  removePhoto(e: WechatMiniprogram.TouchEvent) {
    const index = Number(e.currentTarget.dataset.index);
    if (!Number.isFinite(index)) return;
    const photos = this.data.photos.filter((_, i) => i !== index);
    this.setData({ photos, photoUrl: '' });
    if (!this.data.editing) writeLocateDraft({ photos });
  },

  previewPhoto(e: WechatMiniprogram.TouchEvent) {
    const src = String(e.currentTarget.dataset.src || '');
    if (!src) return;
    wx.previewImage({ current: src, urls: this.data.photos });
  },

  goPickPlace() {
    if (this.data.editing) {
      wx.showToast({ title: '改地点暂不支持，可删了重记', icon: 'none' });
      return;
    }
    writeLocateDraft({
      photos: this.data.photos,
      note: this.data.note,
      place: this.data.place,
    });
    wx.navigateTo({ url: '/pages/place-pick/place-pick' });
  },

  /**
   * 封面只用第一张：上传持久化后写入店铺头图。
   */
  async resolveCoverUrl(): Promise<string | undefined> {
    if (
      this.data.photoUrl &&
      this.data.photoUrl.startsWith('/api/media/local/') &&
      this.data.photos[0] &&
      !isTempPath(this.data.photos[0])
    ) {
      return this.data.photoUrl;
    }

    const first = this.data.photos[0];
    if (!first) {
      // 编辑态清空了图
      if (this.data.editing && !this.data.photos.length) return '';
      return undefined;
    }
    if (!isTempPath(first)) {
      if (first.startsWith('/api/media/local/')) return first;
      if (first.includes('/api/media/local/')) {
        const idx = first.indexOf('/api/media/local/');
        return first.slice(idx);
      }
      return this.data.photoUrl || undefined;
    }

    wx.showLoading({ title: '上传图片…', mask: true });
    try {
      const url = await uploadLocalPhoto(first);
      this.setData({ photoUrl: url });
      return url;
    } finally {
      wx.hideLoading();
    }
  },

  askNeedPlace(): Promise<'fix' | 'abort' | null> {
    return new Promise((resolve) => {
      wx.showModal({
        title: '还没选美食地点',
        content: '选家附近的店，或先记在你现在的位置。',
        confirmText: '去完善',
        confirmColor: '#ff6b4a',
        cancelText: '放弃记录',
        success: (r) => {
          if (r.confirm) resolve('fix');
          else if (r.cancel) resolve('abort');
          else resolve(null);
        },
        fail: () => resolve(null),
      });
    });
  },

  async onSave() {
    if (this.data.saving) return;

    if (!this.data.editing && !this.data.place) {
      const choice = await this.askNeedPlace();
      if (choice === 'fix') {
        this.goPickPlace();
        return;
      }
      if (choice === 'abort') {
        clearLocateDraft();
        wx.navigateBack({ fail: () => wx.reLaunch({ url: '/pages/my-shops/my-shops' }) });
      }
      return;
    }

    if (this.data.editing) {
      await this.saveEdit();
      return;
    }

    await this.saveNew();
  },

  async saveNew() {
    const place = this.data.place as LocatePlace;
    if (!place || !Number.isFinite(place.lat) || !Number.isFinite(place.lng)) {
      wx.showToast({ title: '先选一个美食地点', icon: 'none' });
      return;
    }

    this.setData({ saving: true });
    try {
      const photoUrl = await this.resolveCoverUrl();
      await request('/api/me/checkins', {
        method: 'POST',
        data: {
          name: place.name,
          note: (this.data.note || '').trim() || undefined,
          lat: place.lat,
          lng: place.lng,
          address: place.address || undefined,
          photoUrl,
          poiId: place.poiId || undefined,
        },
      });
      clearLocateDraft();
      wx.showToast({ title: '已记下' });
      setTimeout(() => {
        wx.reLaunch({ url: '/pages/my-shops/my-shops' });
      }, 400);
    } catch (err) {
      wx.showToast({ title: (err as Error).message, icon: 'none' });
    } finally {
      this.setData({ saving: false });
    }
  },

  async saveEdit() {
    const name = (this.data.placeName || '').trim();
    if (!name) {
      wx.showToast({ title: '店名不能为空', icon: 'none' });
      return;
    }
    this.setData({ saving: true });
    try {
      const photoUrl = await this.resolveCoverUrl();
      await request(`/api/me/checkins/${this.data.favoriteId}`, {
        method: 'PATCH',
        data: {
          name,
          address: this.data.place?.address || undefined,
          note: (this.data.note || '').trim() || undefined,
          photoUrl:
            photoUrl !== undefined
              ? photoUrl
              : this.data.photos.length
                ? undefined
                : '',
        },
      });
      wx.showToast({ title: '已保存' });
      setTimeout(() => wx.navigateBack(), 400);
    } catch (err) {
      wx.showToast({ title: (err as Error).message, icon: 'none' });
    } finally {
      this.setData({ saving: false });
    }
  },
});
