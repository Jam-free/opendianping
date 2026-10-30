import { request, buildQuery } from '../../utils/api';
import { getActiveCircleId, setActiveCircleId } from '../../utils/circle';
import { getUserLocation } from '../../utils/location';
import { avatarInitial } from '../../utils/format';

type CircleItem = {
  id: string;
  name: string;
  role?: string;
  invite_token?: string;
};

Page({
  data: {
    tab: 0,
    circles: [] as CircleItem[],
    circleNames: [] as string[],
    circleIndex: 0,
    activeCircleId: '',
    activeCircleName: '',
    shops: [] as any[],
    shopsNoCoord: [] as any[],
    noCoordSection: false,
    members: [] as any[],
    loading: false,
    locHint: '',
    loc: null as { lat: number; lng: number } | null,
  },

  onShow() {
    wx.showShareMenu({ withShareTicket: true, menus: ['shareAppMessage'] });
    this.bootstrap();
  },

  onPullDownRefresh() {
    this.bootstrap().finally(() => wx.stopPullDownRefresh());
  },

  async bootstrap() {
    this.setData({ loading: true });
    try {
      const res = await request<{ items: CircleItem[] }>('/api/circles');
      const circles = res.items || [];
      let activeId = getActiveCircleId();
      if (!circles.find((c) => c.id === activeId)) {
        activeId = circles[0]?.id || '';
        if (activeId) setActiveCircleId(activeId);
      }
      const idx = Math.max(
        0,
        circles.findIndex((c) => c.id === activeId)
      );
      this.setData({
        circles,
        circleNames: circles.map((c) => c.name),
        circleIndex: idx,
        activeCircleId: activeId,
        activeCircleName: circles[idx]?.name || '',
      });

      if (!activeId) {
        this.setData({ loading: false });
        return;
      }

      const loc = await getUserLocation();
      let locHint = '';
      if (!loc) {
        locHint = '未开启定位：店铺按名称排序。可在系统设置中开启位置权限以按距离排序。';
      }
      this.setData({ loc, locHint });

      await Promise.all([this.loadShops(activeId, loc), this.loadMembers(activeId)]);
    } catch (err) {
      wx.showToast({ title: (err as Error).message, icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  async loadShops(circleId: string, loc: { lat: number; lng: number } | null) {
    const qs = buildQuery({
      pageSize: '200',
      lat: loc ? loc.lat : undefined,
      lng: loc ? loc.lng : undefined,
    });
    const res = await request<{ items: any[] }>(
      `/api/circles/${circleId}/shops?${qs}`
    );
    const items = res.items || [];
    const shops = items.filter((s) => s.hasCoords);
    const shopsNoCoord = items.filter((s) => !s.hasCoords);
    this.setData({
      shops,
      shopsNoCoord,
      noCoordSection: shops.length > 0 && shopsNoCoord.length > 0,
    });
  },

  async loadMembers(circleId: string) {
    const res = await request<{ items: any[] }>(
      `/api/circles/${circleId}/members`
    );
    const members = (res.items || []).map((m) => ({
      ...m,
      initial: avatarInitial(m.nickname),
    }));
    this.setData({ members });
  },

  switchTab(e: WechatMiniprogram.TouchEvent) {
    this.setData({ tab: Number(e.currentTarget.dataset.tab) });
  },

  onCirclePick(e: WechatMiniprogram.PickerChange) {
    const idx = Number(e.detail.value);
    const circle = this.data.circles[idx];
    if (!circle) return;
    setActiveCircleId(circle.id);
    this.setData({
      circleIndex: idx,
      activeCircleId: circle.id,
      activeCircleName: circle.name,
    });
    this.loadShops(circle.id, this.data.loc);
    this.loadMembers(circle.id);
  },

  openShop(e: WechatMiniprogram.CustomEvent) {
    const shop = e?.detail?.shop;
    if (!shop?.poiKey || !this.data.activeCircleId) {
      wx.showToast({ title: '店铺信息还没准备好', icon: 'none' });
      return;
    }
    const q = encodeURIComponent(shop.poiKey);
    wx.navigateTo({
      url: `/pages/shop-detail/shop-detail?c=${this.data.activeCircleId}&p=${q}`,
    });
  },

  openFriend(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id;
    const name = e.currentTarget.dataset.name || '圈友';
    wx.navigateTo({
      url: `/pages/friend-shops/friend-shops?c=${this.data.activeCircleId}&m=${id}&n=${encodeURIComponent(name)}`,
    });
  },

  async goCreateCircle() {
    const res = await new Promise<WechatMiniprogram.ShowModalSuccessCallbackResult>(
      (resolve) => {
        wx.showModal({
          title: '创建收藏圈',
          editable: true,
          placeholderText: '给圈子起个名字',
          success: resolve,
          fail: () => resolve({ confirm: false, cancel: true, content: '' } as any),
        });
      }
    );
    if (!res.confirm || !res.content) return;
    try {
      const circle = await request<{ id: string; name: string }>('/api/circles', {
        method: 'POST',
        data: { name: res.content },
      });
      setActiveCircleId(circle.id);
      this.bootstrap();
    } catch (err) {
      wx.showToast({ title: (err as Error).message, icon: 'none' });
    }
  },
});
