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
  estimatePayloadBytes,
  readPhotoBase64,
  uploadPhotoPublic,
} from '../../utils/photo-upload';

/**
 * 登录门禁：头像/昵称必须用户点选（微信不支持静默读取）。
 * 不论是否 DEV bypass，都要先选齐再进，避免云上 bypass=true 时整块 UI 被藏掉。
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
      const nick = (me.user.nickname || '').trim();
      const av = me.user.avatar || '';
      // 缺名片就停在登录页补齐（bypass 也一样）
      if (!nick || !av) {
        this.setData({
          busy: false,
          draftNickname: nick,
          draftAvatar: resolveAvatarDisplay(av),
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
    if (url) {
      this.setData({ draftAvatar: url, error: '' });
    }
  },

  onNickInput(e: WechatMiniprogram.Input) {
    this.setData({ draftNickname: e.detail.value, error: '' });
  },

  onNickBlur(e: WechatMiniprogram.Input) {
    this.setData({ draftNickname: e.detail.value });
  },

  onNickReview() {
    /* 基础库昵称审核回调，有即可，不拦登录 */
  },

  async onLogin() {
    if (this.data.busy) return;

    const nickname = this.data.draftNickname.trim();
    if (!this.data.draftAvatar) {
      this.setData({ error: '请先点上方圆形选择微信头像' });
      return;
    }
    if (!nickname) {
      this.setData({ error: '请点昵称框，选择或填写微信昵称' });
      return;
    }

    this.setData({ busy: true, error: '' });
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

async function persistAvatarIfNeeded(path: string): Promise<string> {
  if (!path) return '';
  if (path.startsWith('/api/media/local/')) return path;
  if (/^https?:\/\//i.test(path) && path.indexOf(API_BASE) === 0) {
    return path.slice(API_BASE.length) || path;
  }
  // 已是可公网访问的头像链接（少见）
  if (/^https?:\/\//i.test(path) && !/tmp|wxfile/i.test(path)) {
    return path.slice(0, 800);
  }

  const compressed = await compressPhotoForUpload(path);
  const base64 = await readPhotoBase64(compressed);
  const token = await (
    await import('../../utils/api')
  ).ensureLogin();

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
    if (/太大|606001|上传|网络|失败|404|不存在/i.test(msg)) {
      return await uploadPhotoPublic(base64, token);
    }
    throw err;
  }
}
