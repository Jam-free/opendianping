import { request, ensureLogin } from '../../utils/api';
import { API_BASE } from '../../utils/config';
import { avatarInitial } from '../../utils/format';
import { setActiveCircleId } from '../../utils/circle';

type Friend = {
  id: string;
  nickname: string | null;
  avatar: string | null;
  avatarSrc: string;
  sharedShopCount: number;
  initial: string;
};

function avatarSrc(avatar?: string | null): string {
  if (!avatar) return '';
  if (avatar.startsWith('/api/')) return `${API_BASE}${avatar}`;
  return avatar;
}

Page({
  data: {
    loading: true,
    friends: [] as Friend[],
    networkId: '',
    inviteToken: '',
    loginError: '',
  },

  onShow() {
    wx.showShareMenu({ withShareTicket: true, menus: ['shareAppMessage'] });
    this.bootstrap();
  },

  onPullDownRefresh() {
    this.bootstrap().finally(() => wx.stopPullDownRefresh());
  },

  async retryLogin() {
    try {
      await ensureLogin({ force: true });
      this.setData({ loginError: '' });
      await this.bootstrap();
    } catch {
      /* ensureLogin 已弹窗 */
    }
  },

  async bootstrap() {
    this.setData({ loading: true, loginError: '' });
    try {
      const net = await request<{
        networkId: string;
        inviteToken: string;
        friends: Array<{
          id: string;
          nickname: string | null;
          avatar: string | null;
          sharedShopCount: number;
        }>;
      }>('/api/me/network');
      setActiveCircleId(net.networkId);
      const friends = (net.friends || []).map((f) => ({
        ...f,
        avatarSrc: avatarSrc(f.avatar),
        initial: avatarInitial(f.nickname),
      }));
      this.setData({
        friends,
        networkId: net.networkId,
        inviteToken: net.inviteToken,
        loading: false,
        loginError: '',
      });
    } catch (err) {
      const msg = (err as Error).message || '加载失败';
      this.setData({
        loading: false,
        loginError: msg.includes('登录') || msg.includes('401')
          ? '登录已失效，点此重新登录'
          : msg.includes('503') || msg.includes('不可用')
            ? '服务暂时繁忙，点此重试'
            : `${msg} · 点此重试`,
      });
    }
  },

  onShareAppMessage() {
    const { networkId, inviteToken } = this.data;
    if (!networkId || !inviteToken) {
      return {
        title: '我和我爱吃的朋友们 · 一起收藏好店',
        path: '/pages/friends/friends',
      };
    }
    return {
      title: '来我和我爱吃的朋友们，一起共享收藏的店',
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
});
