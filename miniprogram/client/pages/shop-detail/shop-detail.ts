import { request, openNavigation } from '../../utils/api';
import { API_BASE } from '../../utils/config';
import { splitDistance, avatarInitial } from '../../utils/format';
import { getUserLocation } from '../../utils/location';

Page({
  data: {
    circleId: '',
    poiKey: '',
    shop: null as any,
    dist: { main: '—', unit: '', na: true },
    metaLine: '',
    headImgFull: '',
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
    const q = new URLSearchParams();
    if (loc) {
      q.set('lat', String(loc.lat));
      q.set('lng', String(loc.lng));
    }
    const qs = q.toString() ? `?${q.toString()}` : '';
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
    };
    this.setData({
      shop: { ...shop, collectors },
      dist: splitDistance(shop.distanceLabel),
      metaLine: parts.join(' · '),
      headImgFull: shop.headImgProxy ? `${API_BASE}${shop.headImgProxy}` : '',
      sourceLabel: labels[shop.sourceType] || shop.sourceType,
    });
  },

  onNav() {
    openNavigation(this.data.shop);
  },
});
