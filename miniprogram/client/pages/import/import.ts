import { request } from '../../utils/api';
import { API_BASE } from '../../utils/config';
import { SHOP_PLACEHOLDER, shopImageSrc } from '../../utils/media';

interface PreviewShop {
  name: string;
  avgPrice?: string;
  category?: string;
  district?: string;
  address?: string;
  sourceLabel: string;
  headImgProxy?: string | null;
  displaySrc: string;
  checked: boolean;
}

Page({
  data: {
    step: 'input' as 'input' | 'preview' | 'result',
    text: '',
    loading: false,
    saving: false,
    previewId: '',
    shops: [] as PreviewShop[],
    message: '',
    selectedCount: 0,
    result: { success: 0, duplicate: 0, failed: 0, batchId: '' },
  },

  onText(e: WechatMiniprogram.Input) {
    this.setData({ text: e.detail.value });
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
        shops: Omit<PreviewShop, 'checked' | 'displaySrc'>[];
        message?: string;
      }>('/api/import/parse', {
        method: 'POST',
        data: {
          text: this.data.text,
          useFixtures: false,
        },
      });
      const shops = (res.shops || []).map((s) => ({
        ...s,
        checked: true,
        displaySrc: shopImageSrc(API_BASE, s.headImgProxy),
      }));
      if (!shops.length) {
        this.setData({ loading: false });
        wx.showModal({
          title: '没有解析到店铺',
          content: res.message || '请确认链接是公开专辑，或换一条再试',
        });
        return;
      }
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

  /** 预览缩略图失败 → 本地兜底；catchtap 已阻止误触勾选 */
  onPreviewImgError(e: WechatMiniprogram.TouchEvent) {
    const index = Number(e.currentTarget.dataset.index);
    if (Number.isNaN(index)) return;
    if (this.data.shops[index]?.displaySrc === SHOP_PLACEHOLDER) return;
    this.setData({ [`shops[${index}].displaySrc`]: SHOP_PLACEHOLDER } as any);
  },

  noop() {},

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
      }>('/api/import/save', {
        method: 'POST',
        data: {
          previewId: this.data.previewId,
          selectedIndexes,
          visibility: 'circles',
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

  goMyShops() {
    wx.switchTab({ url: '/pages/my-shops/my-shops' });
  },

  reset() {
    this.setData({
      step: 'input',
      previewId: '',
      shops: [],
      message: '',
      selectedCount: 0,
      text: '',
    });
  },
});
