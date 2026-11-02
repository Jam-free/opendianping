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
        pageSize: '200',
        memberId: this.data.memberId,
        lat: loc ? loc.lat : undefined,
        lng: loc ? loc.lng : undefined,
      });
      const res = await request<{ items: any[] }>(
        `/api/circles/${this.data.circleId}/shops?${qs}`
      );
      const shops = (res.items || []).map((s) => ({
        ...s,
        // 店铺行里的圈友头像也补全可访问地址
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
    if (!shop?.poiKey || !this.data.circleId) {
      wx.showToast({ title: '店铺信息还没准备好', icon: 'none' });
      return;
    }
    const from = this.data.memberId
      ? `&from=${encodeURIComponent(this.data.memberId)}`
      : '';
    wx.navigateTo({
      url: `/pages/shop-detail/shop-detail?c=${this.data.circleId}&p=${encodeURIComponent(shop.poiKey)}${from}`,
    });
  },
});
