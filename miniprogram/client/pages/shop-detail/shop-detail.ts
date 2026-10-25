import { request, openNavigation, buildQuery } from '../../utils/api';
import { API_BASE } from '../../utils/config';
import { splitDistance, avatarInitial } from '../../utils/format';
import { getUserLocation } from '../../utils/location';
import { SHOP_PLACEHOLDER, shopImageSrc } from '../../utils/media';

Page({
  data: {
    circleId: '',
    poiKey: '',
    shop: null as any,
    dist: { main: '—', unit: '', na: true },
    metaLine: '',
    displaySrc: SHOP_PLACEHOLDER,
    sourceLabel: '',
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
    const collectors = (shop.collectors || []).map((c: any) => ({
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
      shop: { ...shop, collectors },
      dist: splitDistance(shop.distanceLabel),
      metaLine: parts.join(' · '),
      displaySrc: shopImageSrc(API_BASE, shop.headImgProxy),
      sourceLabel: labels[shop.sourceType] || shop.sourceType,
    });
  },

  onImgError() {
    if (this.data.displaySrc === SHOP_PLACEHOLDER) return;
    this.setData({ displaySrc: SHOP_PLACEHOLDER });
  },

  onNav() {
    openNavigation(this.data.shop);
  },
});
