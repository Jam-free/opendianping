import {
  logoutAndLeave,
  peekCachedUser,
  saveCachedUser,
  request,
  ensureLogin,
} from '../../utils/api';
import { avatarInitial } from '../../utils/format';
import { API_BASE } from '../../utils/config';
import { userAvatarSrc } from '../../utils/media';
import {
  compressPhotoForUpload,
  estimatePayloadBytes,
  readPhotoBase64,
  uploadPhotoPublic,
} from '../../utils/photo-upload';

/**
 * 账号页：可点头像/昵称修改并保存；也可退出。
 */
Page({
  data: {
    nickname: '',
    draftNickname: '',
    avatar: '',
    /** 原始存库路径或临时路径 */
    avatarRaw: '',
    initial: '?',
    busy: false,
    saving: false,
  },

  onShow() {
    this.hydrate();
  },

  async hydrate() {
    const cached = peekCachedUser();
    if (cached) {
      this.setData({
        nickname: cached.nickname || '',
        draftNickname: cached.nickname || '',
        avatar: userAvatarSrc(API_BASE, cached.avatar),
        avatarRaw: cached.avatar || '',
        initial: avatarInitial(cached.nickname),
      });
    }
    try {
      const me = await request<{
        user: { id: string; nickname?: string | null; avatar?: string | null };
      }>('/api/me');
      saveCachedUser(me.user);
      this.setData({
        nickname: me.user.nickname || '',
        draftNickname: me.user.nickname || '',
        avatar: userAvatarSrc(API_BASE, me.user.avatar),
        avatarRaw: me.user.avatar || '',
        initial: avatarInitial(me.user.nickname),
      });
    } catch {
      /* 缓存已展示 */
    }
  },

  onChooseAvatar(e: { detail?: { avatarUrl?: string } }) {
    const url = e?.detail?.avatarUrl || '';
    if (!url) return;
    this.setData({ avatar: url, avatarRaw: url });
  },

  onNickInput(e: WechatMiniprogram.Input) {
    this.setData({ draftNickname: e.detail.value });
  },

  onNickBlur(e: WechatMiniprogram.Input) {
    this.setData({ draftNickname: e.detail.value });
  },

  async saveProfile() {
    const nickname = this.data.draftNickname.trim();
    if (!nickname) {
      wx.showToast({ title: '请填写昵称', icon: 'none' });
      return;
    }
    this.setData({ saving: true });
    try {
      const avatarUrl = await persistAvatarIfNeeded(this.data.avatarRaw);
      const res = await request<{
        user: { id: string; nickname?: string | null; avatar?: string | null };
      }>('/api/me/profile', {
        method: 'PATCH',
        data: { nickname, avatar: avatarUrl || undefined },
      });
      saveCachedUser(res.user as { id: string; nickname?: string | null; avatar?: string | null });
      this.setData({
        saving: false,
        nickname: res.user.nickname || nickname,
        draftNickname: res.user.nickname || nickname,
        avatar: userAvatarSrc(API_BASE, res.user.avatar),
        avatarRaw: res.user.avatar || '',
        initial: avatarInitial(res.user.nickname || nickname),
      });
      wx.showToast({ title: '已保存' });
    } catch (err) {
      this.setData({ saving: false });
      wx.showToast({ title: (err as Error).message, icon: 'none' });
    }
  },

  onLogout() {
    wx.showModal({
      title: '退出登录？',
      content: '将撤销本机授权，回到登录页。已导入的店仍保留在你的账号里。',
      confirmText: '退出',
      confirmColor: '#e05a5a',
      success: async (r) => {
        if (!r.confirm) return;
        this.setData({ busy: true });
        await logoutAndLeave();
      },
    });
  },
});

async function persistAvatarIfNeeded(path: string): Promise<string> {
  if (!path) return '';
  if (path.startsWith('/api/media/local/')) return path;
  if (/^https?:\/\//i.test(path) && path.indexOf(API_BASE) === 0) {
    return path.slice(API_BASE.length) || path;
  }
  if (/^https?:\/\//i.test(path) && !/tmp|wxfile/i.test(path)) {
    return path.slice(0, 800);
  }
  if (
    !(
      path.startsWith('wxfile://') ||
      path.startsWith('http://tmp') ||
      !path.startsWith('http')
    )
  ) {
    return path.slice(0, 800);
  }

  const compressed = await compressPhotoForUpload(path);
  const base64 = await readPhotoBase64(compressed);
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
    if (/太大|606001|上传|网络|失败|404|不存在/i.test(msg)) {
      return await uploadPhotoPublic(base64, token);
    }
    throw err;
  }
}
