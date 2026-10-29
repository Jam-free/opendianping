import { request, openNavigation, buildQuery } from '../../utils/api';
import { API_BASE } from '../../utils/config';
import { splitDistance, avatarInitial } from '../../utils/format';
import { getUserLocation } from '../../utils/location';
import { SHOP_PLACEHOLDER, shopImageSrc } from '../../utils/media';

/** 拼点评店铺页；优先接口里的真实链接，否则用店铺 ID 兜底 */
function buildDianpingUrl(shop: {
  sourceUrl?: string | null;
  sourceShopId?: string | null;
  poiKey?: string;
  sourceType?: string;
}): string {
  if (shop.sourceUrl && /^https?:\/\//i.test(shop.sourceUrl)) {
    return shop.sourceUrl;
  }
  const id = shop.sourceShopId || shop.poiKey || '';
  if (
    id &&
    (shop.sourceType === 'dianping_album' || /^\d+$/.test(id) || /^[A-Za-z0-9_-]+$/.test(id))
  ) {
    return `https://m.dianping.com/shop/${encodeURIComponent(id)}`;
  }
  return '';
}

Page({
  data: {
    circleId: '',
    poiKey: '',
    shop: null as any,
    dist: { main: '—', unit: '', na: true },
    metaLine: '',
    displaySrc: SHOP_PLACEHOLDER,
    sourceLabel: '',
    dianpingUrl: '',
    friendNotes: [] as any[],
    draftNote: '',
    savingNote: false,
  },

  onLoad(query: Record<string, string | undefined>) {
    this.setData({
      circleId: query.c || '',
      poiKey: decodeURIComponent(query.p || ''),
    });
    this.load();
  },

  async load() {
    const loc = await getUserLocation();
    const query = buildQuery({
      lat: loc ? loc.lat : undefined,
      lng: loc ? loc.lng : undefined,
    });
    const qs = query ? `?${query}` : '';
    const res = await request<{ shop: any }>(
      `/api/circles/${this.data.circleId}/shops/${encodeURIComponent(this.data.poiKey)}${qs}`
    );
    const shop = res.shop;
    const friendNotes = (shop.collectors || []).map((c: any) => ({
      ...c,
      initial: avatarInitial(c.nickname),
    }));
    const parts = [shop.category, shop.district].filter(Boolean);
    const labels: Record<string, string> = {
      dianping_album: '点评专辑',
      amap: '高德匹配',
      text: '文本识别',
      locate: '记美食',
      photo: '拍照记下',
    };
    const title = shop.name || '店铺详情';
    wx.setNavigationBarTitle({ title });
    this.setData({
      shop,
      dist: splitDistance(shop.distanceLabel),
      metaLine: parts.join(' · '),
      displaySrc: shopImageSrc(API_BASE, shop.headImgProxy),
      sourceLabel: labels[shop.sourceType] || shop.sourceType,
      dianpingUrl: buildDianpingUrl(shop),
      friendNotes,
      draftNote: shop.myNote || '',
    });
  },

  onImgError() {
    if (this.data.displaySrc === SHOP_PLACEHOLDER) return;
    this.setData({ displaySrc: SHOP_PLACEHOLDER });
  },

  onNoteInput(e: WechatMiniprogram.Input) {
    this.setData({ draftNote: e.detail.value });
  },

  async saveNote() {
    if (!this.data.circleId || !this.data.poiKey) return;
    this.setData({ savingNote: true });
    try {
      await request(`/api/circles/${this.data.circleId}/favorites`, {
        method: 'POST',
        data: {
          poiKey: this.data.poiKey,
          note: this.data.draftNote || '',
        },
      });
      this.setData({ savingNote: false });
      wx.showToast({ title: '备注已保存' });
    } catch (err) {
      this.setData({ savingNote: false });
      wx.showToast({ title: (err as Error).message, icon: 'none' });
    }
  },

  openDianping() {
    const url = this.data.dianpingUrl;
    if (!url) {
      wx.showToast({ title: '暂无点评链接', icon: 'none' });
      return;
    }
    // 小程序不能直接打开外链：复制后可粘贴到浏览器 / 点评 App
    wx.setClipboardData({
      data: url,
      success() {
        wx.showModal({
          title: '点评链接已复制',
          content: '打开浏览器或大众点评 App，粘贴即可查看这家店。',
          showCancel: false,
          confirmText: '知道了',
        });
      },
    });
  },

  onNav() {
    openNavigation(this.data.shop);
  },
});
