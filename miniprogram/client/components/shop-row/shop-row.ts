import { API_BASE } from '../../utils/config';
import { splitDistance, avatarInitial } from '../../utils/format';

Component({
  properties: {
    shop: { type: Object, value: {} },
    /** 覆盖推荐行文案，如「我导入」「来自小王」 */
    sourceTag: { type: String, value: '' },
  },
  data: {
    dist: { main: '', unit: '', na: true },
    metaLine: '',
    previewAvatars: [] as Array<{
      userId: string;
      avatar?: string;
      initial: string;
    }>,
    headImgProxyFull: '',
  },
  observers: {
    shop(shop: Record<string, unknown>) {
      if (!shop) return;
      const dist = splitDistance(shop.distanceLabel as string | undefined);
      const parts = [shop.category, shop.district].filter(Boolean);
      const preview = ((shop.collectors as any[]) || []).slice(0, 3);
      const proxy = shop.headImgProxy as string | undefined;
      this.setData({
        dist,
        metaLine: parts.join(' · '),
        previewAvatars: preview.map((c) => ({
          userId: c.userId,
          avatar: c.avatar || '',
          initial: avatarInitial(c.nickname),
        })),
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
