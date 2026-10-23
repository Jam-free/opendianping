import { request } from '../../utils/api';

interface PreviewShop {
  name: string;
  avgPrice?: string;
  category?: string;
  district?: string;
  address?: string;
  sourceLabel: string;
  checked: boolean;
}

Page({
  data: {
    step: 'input' as 'input' | 'preview' | 'result',
    text: 'https://h5.dianping.com/app/commonplatform-collection-static/album.html?albumid=12498807',
    useFixtures: true,
    loading: false,
    saving: false,
    previewId: '',
    shops: [] as PreviewShop[],
    message: '',
    selectedCount: 0,
    visLabels: ['仅自己可见', '共享到收藏圈'],
    visIndex: 1,
    result: { success: 0, duplicate: 0, failed: 0, batchId: '' },
  },

  onText(e: WechatMiniprogram.Input) {
    this.setData({ text: e.detail.value });
  },

  onFixtures(e: WechatMiniprogram.SwitchChange) {
    this.setData({ useFixtures: e.detail.value });
  },

  onVis(e: WechatMiniprogram.PickerChange) {
    this.setData({ visIndex: Number(e.detail.value) });
  },

  async onParse() {
    if (!this.data.text.trim()) {
      wx.showToast({ title: '请粘贴链接', icon: 'none' });
      return;
    }
    this.setData({ loading: true });
    try {
      const res = await request<{
        previewId: string;
        shops: Omit<PreviewShop, 'checked'>[];
        message?: string;
      }>('/api/import/parse', {
        method: 'POST',
        data: {
          text: this.data.text,
          useFixtures: this.data.useFixtures,
        },
      });
      const shops = res.shops.map((s) => ({ ...s, checked: true }));
      this.setData({
        step: 'preview',
        previewId: res.previewId,
        shops,
        message: res.message || '',
        selectedCount: shops.length,
        loading: false,
      });
    } catch (err) {
      this.setData({ loading: false });
      wx.showModal({
        title: '解析失败',
        content: (err as Error).message || '请检查链接是否公开有效',
        confirmText: '重试',
      });
    }
  },

  toggle(e: WechatMiniprogram.TouchEvent) {
    const index = Number(e.currentTarget.dataset.index);
    const key = `shops[${index}].checked`;
    const checked = !this.data.shops[index].checked;
    this.setData({ [key]: checked } as any);
    this.refreshCount();
  },

  selectAll() {
    const shops = this.data.shops.map((s) => ({ ...s, checked: true }));
    this.setData({ shops, selectedCount: shops.length });
  },

  selectNone() {
    const shops = this.data.shops.map((s) => ({ ...s, checked: false }));
    this.setData({ shops, selectedCount: 0 });
  },

  refreshCount() {
    const selectedCount = this.data.shops.filter((s) => s.checked).length;
    this.setData({ selectedCount });
  },

  async onSave() {
    const selectedIndexes = this.data.shops
      .map((s, i) => (s.checked ? i : -1))
      .filter((i) => i >= 0);
    if (!selectedIndexes.length) {
      wx.showToast({ title: '请先勾选店铺', icon: 'none' });
      return;
    }
    this.setData({ saving: true });
    try {
      const res = await request<{
        success: number;
        duplicate: number;
        failed: number;
        batchId: string;
        message: string;
      }>('/api/import/save', {
        method: 'POST',
        data: {
          previewId: this.data.previewId,
          selectedIndexes,
          visibility: this.data.visIndex === 1 ? 'circles' : 'private',
        },
      });
      this.setData({
        step: 'result',
        saving: false,
        result: {
          success: res.success,
          duplicate: res.duplicate,
          failed: res.failed,
          batchId: res.batchId,
        },
      });
    } catch (err) {
      this.setData({ saving: false });
      wx.showToast({ title: (err as Error).message, icon: 'none' });
    }
  },

  async undoBatch() {
    const batchId = this.data.result.batchId;
    if (!batchId) return;
    try {
      await request(`/api/import/batches/${batchId}`, { method: 'DELETE' });
      wx.showToast({ title: '已撤销' });
      this.reset();
    } catch (err) {
      wx.showToast({ title: (err as Error).message, icon: 'none' });
    }
  },

  goFavorites() {
    wx.redirectTo({ url: '/pages/favorites/favorites' });
  },

  reset() {
    this.setData({
      step: 'input',
      previewId: '',
      shops: [],
      message: '',
      selectedCount: 0,
    });
  },
});
