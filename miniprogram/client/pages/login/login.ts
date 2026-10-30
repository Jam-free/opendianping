import {
  ensureLogin,
  hasSession,
  saveCachedUser,
  enterAppAfterLogin,
  request,
} from '../../utils/api';
import { API_BASE } from '../../utils/config';
import {
  compressPhotoForUpload,
  estimatePayloadBytes,
  readPhotoBase64,
  uploadPhotoPublic,
} from '../../utils/photo-upload';

/**
 * 登录：点进入 → 选头像 → 选昵称后自动进入。
 * type=nickname 不能用受控 value，否则微信昵称点选经常进不了 data。
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
      this.setData({
        busy: false,
        step: 'avatar',
        draftAvatar: resolveAvatarDisplay(av),
        draftNickname: nick,
      });
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
    // 点选微信昵称时，input 往往会带上完整值，直接进
    if (nickname) {
      this.tryEnterWithNickname(nickname);
    }
  },

  onNickBlur(e: WechatMiniprogram.Input) {
    const nickname = (e.detail.value || '').trim();
    this.setData({ draftNickname: nickname, nickFocus: false });
    if (nickname) {
      this.tryEnterWithNickname(nickname);
    }
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
      const avatarUrl = await persistAvatarIfNeeded(this.data.draftAvatar);
      await request('/api/me/profile', {
        method: 'PATCH',
        data: { nickname, avatar: avatarUrl },
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
    return '网络没连上云服务，请检查网络后重试；若刚部署过，稍等再试';
  }
  if (/照片太大|太大|606001/i.test(raw)) {
    return '头像有点大，请换一张或再试一次';
  }
  if (/上传/i.test(raw)) {
    return '头像上传失败，请重试；云服务若在更新，稍等一会儿';
  }
  return raw.length > 60 ? `${raw.slice(0, 60)}…` : raw;
}

function resolveAvatarDisplay(avatar?: string | null): string {
  if (!avatar) return '';
  if (avatar.startsWith('/api/')) return `${API_BASE}${avatar}`;
  return avatar;
}

async function persistAvatarIfNeeded(path: string): Promise<string> {
  if (!path) return '';
  if (path.startsWith('/api/media/local/')) return path;
  if (/^https?:\/\//i.test(path) && path.indexOf(API_BASE) === 0) {
    return path.slice(API_BASE.length) || path;
  }
  if (/^https?:\/\//i.test(path) && !/tmp|wxfile/i.test(path)) {
    return path.slice(0, 800);
  }

  const compressed = await compressPhotoForUpload(path);
  const base64 = await readPhotoBase64(compressed);
  const { ensureLogin, request } = await import('../../utils/api');
  const token = await ensureLogin();

  try {
    if (estimatePayloadBytes(base64) > 90 * 1024) {
      return await uploadPhotoPublic(base64, token);
    }
    const res = await request<{ url: string }>('/api/me/photos', {
      method: 'POST',
      data: { base64, mime: 'image/jpeg' },
    });
    if (!res.url) throw new Error('头像上传失败');
    return res.url;
  } catch (err) {
    const msg = (err as Error).message || '';
    if (/太大|606001|上传|网络|失败|404|不存在|fetch failed/i.test(msg)) {
      return await uploadPhotoPublic(base64, token);
    }
    throw err;
  }
}
