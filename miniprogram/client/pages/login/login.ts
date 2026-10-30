import {
  ensureLogin,
  hasSession,
  saveCachedUser,
  enterAppAfterLogin,
  request,
} from '../../utils/api';
import { API_BASE } from '../../utils/config';
import { uploadAvatarOrEmpty } from '../../utils/avatar-upload';

/**
 * 登录：点进入 → 选头像 → 选昵称后自动进入。
 * 头像只走云托管内网；上传失败也不挡进入（昵称仍会保存）。
 */
Page({
  data: {
    busy: false,
    bypass: false,
    error: '',
    step: 'avatar' as 'avatar' | 'nickname',
    draftNickname: '',
    draftAvatar: '',
    nickFocus: false,
  },

  onShow() {
    this.bootstrap();
  },

  async bootstrap() {
    try {
      const boot = await request<{ bypass: boolean }>('/api/auth/bootstrap', {
        auth: false,
      });
      this.setData({ bypass: Boolean(boot.bypass) });
    } catch {
      this.setData({ bypass: false });
    }

    if (!hasSession()) return;

    this.setData({ busy: true, error: '' });
    try {
      const me = await request<{
        user: { id: string; nickname?: string | null; avatar?: string | null };
      }>('/api/me');
      saveCachedUser(me.user);
      const nick = (me.user.nickname || '').trim();
      const av = me.user.avatar || '';
      if (nick && av) {
        enterAppAfterLogin();
        return;
      }
      if (av && !nick) {
        this.setData({
          busy: false,
          step: 'nickname',
          draftAvatar: resolveAvatarDisplay(av),
          draftNickname: '',
          nickFocus: true,
        });
        return;
      }
      // 有昵称没头像，或都没有：从头像步走（本地已选的临时头像优先）
      if (nick && !av) {
        this.setData({
          busy: false,
          step: 'avatar',
          draftNickname: nick,
        });
        return;
      }
      this.setData({ busy: false, step: 'avatar' });
    } catch {
      this.setData({ busy: false });
    }
  },

  onChooseAvatar(e: { detail?: { avatarUrl?: string } }) {
    const url = e?.detail?.avatarUrl || '';
    if (!url) {
      this.setData({ error: '未拿到头像，请再试一次' });
      return;
    }
    this.setData({
      draftAvatar: url,
      step: 'nickname',
      error: '',
      nickFocus: true,
    });
  },

  backToAvatar() {
    this.setData({
      step: 'avatar',
      nickFocus: false,
      error: '',
      draftNickname: '',
    });
  },

  onNickInput(e: WechatMiniprogram.Input) {
    const nickname = (e.detail.value || '').trim();
    this.setData({ draftNickname: nickname, error: '' });
    if (nickname) this.tryEnterWithNickname(nickname);
  },

  onNickBlur(e: WechatMiniprogram.Input) {
    const nickname = (e.detail.value || '').trim();
    this.setData({ draftNickname: nickname, nickFocus: false });
    if (nickname) this.tryEnterWithNickname(nickname);
  },

  onNickConfirm(e: WechatMiniprogram.Input) {
    const nickname = (e.detail.value || this.data.draftNickname || '').trim();
    if (nickname) this.tryEnterWithNickname(nickname);
  },

  tryEnterWithNickname(nickname: string) {
    if (this.data.busy) return;
    if (!this.data.draftAvatar) {
      this.setData({ step: 'avatar', error: '请先选择头像' });
      return;
    }
    if (!nickname.trim()) return;
    this.enterApp(nickname.trim());
  },

  async enterApp(nickname: string) {
    if (this.data.busy) return;
    this.setData({ busy: true, error: '', draftNickname: nickname });
    try {
      await ensureLogin({ force: true, interactive: true });

      // 头像失败不拦路：昵称先存上，进得去再说
      const avatarUrl = await uploadAvatarOrEmpty(this.data.draftAvatar);
      await request('/api/me/profile', {
        method: 'PATCH',
        data: {
          nickname,
          ...(avatarUrl ? { avatar: avatarUrl } : {}),
        },
      });
      const me = await request<{
        user: { id: string; nickname?: string | null; avatar?: string | null };
      }>('/api/me');
      saveCachedUser(me.user);
      enterAppAfterLogin();
    } catch (err) {
      this.setData({
        busy: false,
        error: friendlyError(err),
      });
    }
  },
});

function friendlyError(err: unknown): string {
  const raw = ((err as Error)?.message || String(err || '')).trim();
  if (!raw) return '登录失败，请重试';
  if (/fetch failed|request:fail|ERR_CONNECTION|超时|timeout/i.test(raw)) {
    return '登录请求失败，请检查网络后重试';
  }
  return raw.length > 60 ? `${raw.slice(0, 60)}…` : raw;
}

function resolveAvatarDisplay(avatar?: string | null): string {
  if (!avatar) return '';
  if (avatar.startsWith('/api/')) return `${API_BASE}${avatar}`;
  return avatar;
}
