import { request } from '../../utils/api';
import { avatarInitial } from '../../utils/format';
import { setActiveCircleId } from '../../utils/circle';

type Friend = {
  id: string;
  nickname: string | null;
  avatar: string | null;
  sharedShopCount: number;
  initial: string;
};

Page({
  data: {
    loading: true,
    friends: [] as Friend[],
    networkId: '',
    inviteToken: '',
    needProfile: false,
    showProfile: false,
    draftNickname: '',
    draftAvatar: '',
    savingProfile: false,
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
      const [me, net] = await Promise.all([
        request<{ user: { nickname?: string; avatar?: string } }>('/api/me'),
        request<{
          networkId: string;
          inviteToken: string;
          friends: Array<{
            id: string;
            nickname: string | null;
            avatar: string | null;
            sharedShopCount: number;
          }>;
        }>('/api/me/network'),
      ]);
      setActiveCircleId(net.networkId);
      const friends = (net.friends || []).map((f) => ({
        ...f,
        initial: avatarInitial(f.nickname),
      }));
      const needProfile = !me.user?.nickname || !me.user?.avatar;
      this.setData({
        friends,
        networkId: net.networkId,
        inviteToken: net.inviteToken,
        needProfile,
        draftNickname: me.user?.nickname || '',
        draftAvatar: me.user?.avatar || '',
        loading: false,
      });
    } catch (err) {
      this.setData({ loading: false });
      wx.showToast({ title: (err as Error).message, icon: 'none' });
    }
  },

  onShareAppMessage() {
    const { networkId, inviteToken } = this.data;
    if (!networkId || !inviteToken) {
      return { title: '美食肥猫 · 一起收藏好店', path: '/pages/friends/friends' };
    }
    return {
      title: '来美食肥猫，一起共享收藏的店',
      path: `/pages/join/join?c=${networkId}&t=${inviteToken}`,
    };
  },

  openFriend(e: WechatMiniprogram.TouchEvent) {
    const id = String(e.currentTarget.dataset.id || '');
    const name = encodeURIComponent(
      String(e.currentTarget.dataset.name || '朋友')
    );
    wx.navigateTo({
      url: `/pages/friend-shops/friend-shops?c=${this.data.networkId}&m=${id}&n=${name}`,
    });
  },

  openProfile() {
    this.setData({ showProfile: true });
  },

  closeProfile() {
    this.setData({ showProfile: false });
  },

  onChooseAvatar(e: any) {
    const url = e?.detail?.avatarUrl || '';
    if (url) this.setData({ draftAvatar: url });
  },

  onNickInput(e: WechatMiniprogram.Input) {
    this.setData({ draftNickname: e.detail.value });
  },

  onNickBlur(e: WechatMiniprogram.Input) {
    this.setData({ draftNickname: e.detail.value });
  },

  async saveProfile() {
    const nickname = this.data.draftNickname.trim();
    const avatar = this.data.draftAvatar.trim();
    if (!nickname) {
      wx.showToast({ title: '请填写昵称', icon: 'none' });
      return;
    }
    this.setData({ savingProfile: true });
    try {
      await request('/api/me/profile', {
        method: 'PATCH',
        data: { nickname, avatar: avatar || undefined },
      });
      this.setData({
        savingProfile: false,
        showProfile: false,
        needProfile: !avatar,
      });
      wx.showToast({ title: '已保存' });
    } catch (err) {
      this.setData({ savingProfile: false });
      wx.showToast({ title: (err as Error).message, icon: 'none' });
    }
  },
});
