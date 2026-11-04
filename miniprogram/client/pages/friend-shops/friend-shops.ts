import { request, buildQuery } from '../../utils/api';
import { API_BASE } from '../../utils/config';
import { avatarInitial } from '../../utils/format';
import { getUserLocation } from '../../utils/location';
import { userAvatarSrc } from '../../utils/media';

Page({
  data: {
    circleId: '',
    memberId: '',
    friendName: '朋友',
    avatarSrc: '',
    initial: '友',
    shops: [] as any[],
    loading: true,
  },

  onLoad(query: Record<string, string | undefined>) {
    const circleId = query.c || '';
    const memberId = query.m || '';
    const friendName = query.n ? decodeURIComponent(query.n) : '朋友';
    const avatarRaw = query.a ? decodeURIComponent(query.a) : '';
    this.setData({
      circleId,
      memberId,
      friendName,
      avatarSrc: userAvatarSrc(API_BASE, avatarRaw) || avatarRaw,
      initial: avatarInitial(friendName),
    });
    wx.setNavigationBarTitle({ title: `${friendName}的收藏` });
    this.load();
  },

  onAvatarError() {
    this.setData({ avatarSrc: '' });
  },

  async load() {
    this.setData({ loading: true });
    try {
      const loc = await getUserLocation();
      const qs = buildQuery({
        lat: loc ? loc.lat : undefined,
        lng: loc ? loc.lng : undefined,
      });
      const res = await request<{ items: any[] }>(
        `/api/members/${this.data.memberId}/shops?${qs}`
      );
      const shops = (res.items || []).map((s) => ({
        ...s,
        collectors: (s.collectors || []).map(
          (c: { avatar?: string | null; [k: string]: unknown }) => ({
            ...c,
            avatar: userAvatarSrc(API_BASE, c.avatar) || c.avatar || '',
          })
        ),
      }));
      this.setData({
        shops,
        loading: false,
      });
    } catch (err) {
      this.setData({ loading: false });
      wx.showToast({ title: (err as Error).message, icon: 'none' });
    }
  },

  openShop(e: WechatMiniprogram.CustomEvent) {
    const shop = e?.detail?.shop;
    if (!shop?.poiKey || !this.data.memberId) {
      wx.showToast({ title: '店铺信息还没准备好', icon: 'none' });
      return;
    }
    wx.navigateTo({
      url: `/pages/shop-detail/shop-detail?m=${encodeURIComponent(this.data.memberId)}&p=${encodeURIComponent(shop.poiKey)}`,
    });
  },
});
