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
 * 登录：点进入 → 选头像 → 选昵称后进入。
 *
 * 微信 type=nickname 的坑：点选昵称时 input 可能连发空值/半截值，
 * 若一有 input 就进，经常第一次进不去，要连点好几次。
 * 所以：input 只记昵称；真正进入交给 blur / 确认 /「进入」按钮。
 */
Page({
  data: {
    busy: false,
    bypass: false,
    error: '',
    step: 'avatar' as 'avatar' | 'nickname',
    draftNickname: '',
    draftAvatar: '',
  },

  /** 同步锁：setData 的 busy 有延迟，防双触发 */
  _entering: false as boolean,
  _enterTimer: 0 as number,

  onShow() {
    this.bootstrap();
  },

  onUnload() {
    this.clearEnterTimer();
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
        });
        return;
      }
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
      // 有服务端旧昵称时预填到草稿，方便直接点「进入」
      draftNickname: this.data.draftNickname || '',
    });
  },

  backToAvatar() {
    this.clearEnterTimer();
    this.setData({
      step: 'avatar',
      error: '',
      draftNickname: '',
    });
  },

  /** 只记草稿，不立刻进入——避免点选昵称过程中的空/半截事件把流程打乱 */
  onNickInput(e: WechatMiniprogram.Input) {
    const nickname = (e.detail.value || '').trim();
    this.setData({ draftNickname: nickname, error: '' });
    // 选完微信昵称后，部分机型不发 blur；短延迟兜一次进入
    if (nickname) this.scheduleEnter(nickname);
  },

  onNickBlur(e: WechatMiniprogram.Input) {
    const nickname = (e.detail.value || this.data.draftNickname || '').trim();
    if (nickname) this.setData({ draftNickname: nickname });
    if (nickname) this.scheduleEnter(nickname, 80);
  },

  onNickConfirm(e: WechatMiniprogram.Input) {
    const nickname = (e.detail.value || this.data.draftNickname || '').trim();
    if (nickname) this.enterApp(nickname);
  },

  onTapEnter() {
    const nickname = (this.data.draftNickname || '').trim();
    if (!nickname) {
      this.setData({ error: '请先点上方选好昵称' });
      return;
    }
    this.enterApp(nickname);
  },

  clearEnterTimer() {
    if (this._enterTimer) {
      clearTimeout(this._enterTimer);
      this._enterTimer = 0;
    }
  },

  scheduleEnter(nickname: string, delayMs = 360) {
    this.clearEnterTimer();
    this._enterTimer = setTimeout(() => {
      this._enterTimer = 0;
      this.enterApp(nickname);
    }, delayMs) as unknown as number;
  },

  async enterApp(nickname: string) {
    const nick = nickname.trim();
    if (!nick) return;
    if (this._entering || this.data.busy) return;
    if (!this.data.draftAvatar) {
      this.setData({ step: 'avatar', error: '请先选择头像' });
      return;
    }

    this.clearEnterTimer();
    this._entering = true;
    this.setData({ busy: true, error: '', draftNickname: nick });

    try {
      // 已有会话就别强制重登，少一次请求、少一次失败机会
      await ensureLogin({ interactive: true });

      const avatarUrl = await uploadAvatarOrEmpty(this.data.draftAvatar);
      await request('/api/me/profile', {
        method: 'PATCH',
        data: {
          nickname: nick,
          ...(avatarUrl ? { avatar: avatarUrl } : {}),
        },
      });
      const me = await request<{
        user: { id: string; nickname?: string | null; avatar?: string | null };
      }>('/api/me');
      saveCachedUser(me.user);
      enterAppAfterLogin();
    } catch (err) {
      this._entering = false;
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
