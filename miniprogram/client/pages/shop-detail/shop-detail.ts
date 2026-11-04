import { request, openNavigation, buildQuery } from '../../utils/api';
import { API_BASE } from '../../utils/config';
import { splitDistance, avatarInitial } from '../../utils/format';
import { getUserLocation } from '../../utils/location';
import { SHOP_PLACEHOLDER, shopImageSrc } from '../../utils/media';

/**
 * 有真实点评链接才返回；自己记下的店（locate/photo）没有链接，不要硬拼。
 * 避免用内部 UUID 冒充点评 shopId，否则会误显示点评图标。
 */
function buildDianpingUrl(shop: {
  sourceUrl?: string | null;
  sourceShopId?: string | null;
  sourceType?: string;
}): string {
  if (shop.sourceType === 'locate' || shop.sourceType === 'photo') {
    return '';
  }
  if (shop.sourceUrl && /^https?:\/\//i.test(shop.sourceUrl)) {
    return shop.sourceUrl;
  }
  // 仅点评导入且带有来源店铺 ID 时才拼移动站链接
  const id = (shop.sourceShopId || '').trim();
  if (shop.sourceType === 'dianping_album' && id) {
    return `https://m.dianping.com/shop/${encodeURIComponent(id)}`;
  }
  return '';
}

function timeLabel(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  const h = `${d.getHours()}`.padStart(2, '0');
  const min = `${d.getMinutes()}`.padStart(2, '0');
  return `${m}-${day} ${h}:${min}`;
}

Page({
  data: {
    circleId: '',
    memberId: '',
    poiKey: '',
    shop: null as any,
    dist: { main: '—', unit: '', na: true },
    metaLine: '',
    displaySrc: SHOP_PLACEHOLDER,
    sourceLabel: '',
    dianpingUrl: '',
    comments: [] as any[],
    draftComment: '',
    sending: false,
    wishlist: false,
    canEditCheckin: false,
    canDelete: false,
    canNav: false,
    /** 从谁的收藏点进来的（亮心进私藏时记为推荐人） */
    fromUserId: '',
  },

  onLoad(query: Record<string, string | undefined>) {
    this.setData({
      circleId: query.c || '',
      memberId: query.m || '',
      poiKey: decodeURIComponent(query.p || ''),
      fromUserId: query.from ? decodeURIComponent(query.from) : '',
    });
    this.load();
  },

  onShow() {
    // 从「改记美食」回来时刷新
    if (this.data.poiKey) this.loadComments();
  },

  async load() {
    const loc = await getUserLocation();
    const query = buildQuery({
      lat: loc ? loc.lat : undefined,
      lng: loc ? loc.lng : undefined,
    });
    const qs = query ? `?${query}` : '';
    
    let url: string;
    if (this.data.memberId) {
      url = `/api/members/${encodeURIComponent(this.data.memberId)}/shops/${encodeURIComponent(this.data.poiKey)}${qs}`;
    } else {
      url = `/api/circles/${this.data.circleId}/shops/${encodeURIComponent(this.data.poiKey)}${qs}`;
    }
    
    const res = await request<{ shop: any }>(url);
    const shop = res.shop;
    const parts = [shop.category, shop.district].filter(Boolean);
    const labels: Record<string, string> = {
      dianping_album: '大众点评',
      amap: '高德匹配',
      text: '文本识别',
      locate: '记美食',
      photo: '拍照记下',
      agent: 'AI 帮你记下',
    };
    
    let sourceLabel = labels[shop.sourceType] || '未知';
    if (shop.sourceType === 'agent' && shop.collectors && shop.collectors.length > 0) {
      const recommender = shop.collectors[0];
      if (recommender && recommender.nickname) {
        sourceLabel = `来自${recommender.nickname}`;
      }
    } else if (shop.collectors && shop.collectors.length > 0) {
      const recommender = shop.collectors[0];
      if (recommender && recommender.nickname) {
        sourceLabel = `来自${recommender.nickname}`;
      }
    }
    
    wx.setNavigationBarTitle({ title: shop.name || '店铺详情' });
    this.setData({
      shop,
      dist: splitDistance(shop.distanceLabel),
      metaLine: parts.join(' · '),
      displaySrc: shopImageSrc(API_BASE, shop.headImgProxy),
      sourceLabel,
      dianpingUrl: buildDianpingUrl(shop),
      wishlist: Boolean(shop.wishlist),
      canEditCheckin:
        (shop.sourceType === 'locate' || shop.sourceType === 'photo') &&
        Boolean(shop.myFavoriteId),
      // 只要是自己收藏/记下的，就可以从私藏里删掉
      canDelete: Boolean(shop.myFavoriteId),
      canNav: shop.lat != null && shop.lng != null,
    });
    await this.loadComments();
  },

  async loadComments() {
    if (!this.data.poiKey) return;
    try {
      const res = await request<{ items: any[] }>(
        `/api/shops/${encodeURIComponent(this.data.poiKey)}/comments`
      );
      const comments = (res.items || []).map((c) => ({
        ...c,
        initial: avatarInitial(c.nickname),
        timeLabel: timeLabel(c.createdAt),
      }));
      this.setData({ comments });
    } catch {
      /* 评论失败不挡详情 */
    }
  },

  onImgError() {
    if (this.data.displaySrc === SHOP_PLACEHOLDER) return;
    this.setData({ displaySrc: SHOP_PLACEHOLDER });
  },

  onCommentInput(e: WechatMiniprogram.Input) {
    this.setData({ draftComment: e.detail.value });
  },

  async sendComment() {
    const body = (this.data.draftComment || '').trim();
    if (!body) {
      wx.showToast({ title: '先写一句', icon: 'none' });
      return;
    }
    this.setData({ sending: true });
    try {
      await request(
        `/api/shops/${encodeURIComponent(this.data.poiKey)}/comments`,
        { method: 'POST', data: { body } }
      );
      this.setData({ draftComment: '', sending: false });
      await this.loadComments();
    } catch (err) {
      this.setData({ sending: false });
      wx.showToast({ title: (err as Error).message, icon: 'none' });
    }
  },

  async toggleWishlist() {
    const next = !this.data.wishlist;
    this.setData({ wishlist: next });
    try {
      const collectors = (this.data.shop?.collectors || []) as Array<{
        userId?: string;
      }>;
      const fromUserId =
        this.data.fromUserId ||
        collectors.find((c) => c.userId)?.userId ||
        '';
      await request('/api/me/wishlist', {
        method: 'POST',
        data: {
          poiKey: this.data.poiKey,
          wishlist: next,
          fromUserId: fromUserId || undefined,
        },
      });
      wx.showToast({
        title: next ? '已标心心念念' : '已取消心心念念',
        icon: 'none',
      });
    } catch (err) {
      this.setData({ wishlist: !next });
      wx.showToast({ title: (err as Error).message, icon: 'none' });
    }
  },

  goEditCheckin() {
    const fav = this.data.shop?.myFavoriteId;
    if (!fav) return;
    wx.navigateTo({
      url: `/pages/locate-note/locate-note?fav=${encodeURIComponent(fav)}`,
    });
  },

  onDelete() {
    const fav = this.data.shop?.myFavoriteId;
    const name = (this.data.shop?.name || '这家店').slice(0, 20);
    if (!fav) return;
    wx.showModal({
      title: '删除这家店？',
      content: `「${name}」会从你的私藏里移除。`,
      confirmText: '删除',
      confirmColor: '#e05a5a',
      success: async (r) => {
        if (!r.confirm) return;
        try {
          await request(`/api/favorites/${encodeURIComponent(fav)}`, {
            method: 'DELETE',
          });
          wx.showToast({ title: '已删除', icon: 'success' });
          setTimeout(() => wx.navigateBack({ fail: () => {
            wx.reLaunch({ url: '/pages/my-shops/my-shops' });
          }}), 400);
        } catch (err) {
          wx.showToast({ title: (err as Error).message, icon: 'none' });
        }
      },
    });
  },

  openDianping() {
    const url = this.data.dianpingUrl;
    if (!url) {
      wx.showToast({ title: '暂无点评链接', icon: 'none' });
      return;
    }
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

  onCall() {
    const phone = this.data.shop?.phone;
    if (!phone) return;
    wx.makePhoneCall({ phoneNumber: String(phone).replace(/\s/g, '') });
  },

  onNav() {
    openNavigation(this.data.shop);
  },
});
