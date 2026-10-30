import {
  ensureLogin,
  hasSession,
  peekCachedUser,
  saveCachedUser,
  enterAppAfterLogin,
  request,
} from '../../utils/api';
import { API_BASE } from '../../utils/config';
import {
  compressPhotoForUpload,
  readPhotoBase64,
} from '../../utils/photo-upload';

/**
 * 强制登录门禁页。
 * 头像/昵称在登录前就展示：微信不允许静默读资料，必须用户点选 chooseAvatar / type=nickname。
 */
Page({
  data: {
    busy: false,
    bypass: false,
    error: '',
    draftNickname: '',
    draftAvatar: '',
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
      // 已有票但还没名片：留在本页补齐，避免进了朋友圈才发现
      if (!this.data.bypass && (!me.user.nickname || !me.user.avatar)) {
        this.setData({
          busy: false,
          draftNickname: me.user.nickname || '',
          draftAvatar: resolveAvatarDisplay(me.user.avatar),
        });
        return;
      }
      enterAppAfterLogin();
    } catch {
      this.setData({ busy: false });
    }
  },

  onChooseAvatar(e: { detail?: { avatarUrl?: string } }) {
    const url = e?.detail?.avatarUrl || '';
    if (url) this.setData({ draftAvatar: url });
  },

  onNickInput(e: WechatMiniprogram.Input) {
    this.setData({ draftNickname: e.detail.value });
  },

  onNickBlur(e: WechatMiniprogram.Input) {
    this.setData({ draftNickname: e.detail.value });
  },

  async onLogin() {
    if (this.data.busy) return;

    const nickname = this.data.draftNickname.trim();
    if (!this.data.bypass) {
      if (!this.data.draftAvatar) {
        this.setData({ error: '请先点上方圆形选择头像' });
        return;
      }
      if (!nickname) {
        this.setData({ error: '请填写微信昵称（点输入框可选微信昵称）' });
        return;
      }
    }

    this.setData({ busy: true, error: '' });
    try {
      await ensureLogin({ force: true, interactive: true });

      if (!this.data.bypass) {
        const avatarUrl = await persistAvatarIfNeeded(this.data.draftAvatar);
        await request('/api/me/profile', {
          method: 'PATCH',
          data: { nickname, avatar: avatarUrl },
        });
        const me = await request<{
          user: { id: string; nickname?: string | null; avatar?: string | null };
        }>('/api/me');
        saveCachedUser(me.user);
      } else {
        try {
          const me = await request<{
            user: {
              id: string;
              nickname?: string | null;
              avatar?: string | null;
            };
          }>('/api/me');
          saveCachedUser(me.user);
        } catch {
          saveCachedUser(
            peekCachedUser() || { id: '', nickname: null, avatar: null }
          );
        }
      }
      enterAppAfterLogin();
    } catch (err) {
      this.setData({
        busy: false,
        error: (err as Error).message || '登录失败，请重试',
      });
    }
  },
});

function resolveAvatarDisplay(avatar?: string | null): string {
  if (!avatar) return '';
  if (avatar.startsWith('/api/')) return `${API_BASE}${avatar}`;
  return avatar;
}

/** 微信 chooseAvatar 是临时路径，需上传后朋友才能看见 */
async function persistAvatarIfNeeded(path: string): Promise<string> {
  if (!path) return '';
  if (path.startsWith('/api/media/local/')) return path;
  if (/^https?:\/\//i.test(path) && path.indexOf(API_BASE) === 0) {
    return path.slice(API_BASE.length) || path;
  }
  if (
    path.startsWith('wxfile://') ||
    path.startsWith('http://tmp') ||
    !path.startsWith('http')
  ) {
    const compressed = await compressPhotoForUpload(path);
    const base64 = await readPhotoBase64(compressed);
    const res = await request<{ url: string }>('/api/me/photos', {
      method: 'POST',
      data: { base64, mime: 'image/jpeg' },
    });
    return res.url;
  }
  return path.slice(0, 500);
}
