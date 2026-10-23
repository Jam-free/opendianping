import { API_BASE } from '../../utils/config';
import { splitDistance, avatarInitial } from '../../utils/format';

Component({
  properties: {
    shop: { type: Object, value: {} },
  },
  data: {
    dist: { main: '—', unit: '', na: true },
    metaLine: '',
    previewAvatars: [] as Array<{
      userId: string;
      avatar?: string;
      initial: string;
    }>,
    extraCount: 0,
    headImgProxyFull: '',
  },
  observers: {
    shop(shop: Record<string, unknown>) {
      if (!shop) return;
      const dist = splitDistance(shop.distanceLabel as string | undefined);
      const parts = [shop.category, shop.district].filter(Boolean);
      const preview = ((shop.collectors as any[]) || []).slice(0, 3);
      const total = (shop.collectorCount as number) || preview.length;
      const proxy = shop.headImgProxy as string | undefined;
      this.setData({
        dist,
        metaLine: parts.join(' · '),
        previewAvatars: preview.map((c) => ({
          userId: c.userId,
          avatar: c.avatar || '',
          initial: avatarInitial(c.nickname),
        })),
        extraCount: Math.max(0, total - 3),
        headImgProxyFull: proxy ? `${API_BASE}${proxy}` : '',
      });
    },
  },
  methods: {
    onTap() {
      this.triggerEvent('tap', { shop: this.properties.shop });
    },
  },
});
