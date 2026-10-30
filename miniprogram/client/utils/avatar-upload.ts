/**
 * 头像上传：只走 callContainer（微信内网），不走公网域名。
 * 公网 sh.run.tcloudbase.com 往往没配进合法域名，会直接 fetch failed。
 */
import { request, ensureLogin } from './api';
import {
  compressPhotoForUpload,
  estimatePayloadBytes,
  readPhotoBase64,
} from './photo-upload';

/** 头像再压小一点，保证塞进 callContainer 约 100KiB 限制 */
async function compressAvatar(tempPath: string): Promise<string> {
  // 先走通用压缩；若仍偏大，再压一档边长
  let path = await compressPhotoForUpload(tempPath);
  let base64 = await readPhotoBase64(path);
  if (estimatePayloadBytes(base64) <= 80 * 1024) return path;

  return new Promise((resolve, reject) => {
    wx.compressImage({
      src: tempPath,
      quality: 40,
      compressedWidth: 240,
      success: (res: { tempFilePath?: string }) => {
        if (res.tempFilePath) resolve(res.tempFilePath);
        else reject(new Error('头像压缩失败'));
      },
      fail: (err: { errMsg?: string }) =>
        reject(new Error(err?.errMsg || '头像压缩失败')),
    });
  });
}

/**
 * 把微信临时头像存成服务端路径。
 * 失败返回空字符串——登录不应被头像上传卡住。
 */
export async function uploadAvatarOrEmpty(tempPath: string): Promise<string> {
  if (!tempPath) return '';
  if (tempPath.startsWith('/api/media/local/')) return tempPath;

  try {
    await ensureLogin();
    const path = await compressAvatar(tempPath);
    const base64 = await readPhotoBase64(path);
    if (estimatePayloadBytes(base64) > 95 * 1024) {
      // 再压仍超限：放弃头像，不拦登录
      console.warn('[avatar] still too large after compress');
      return '';
    }
    const res = await request<{ url: string }>('/api/me/photos', {
      method: 'POST',
      data: { base64, mime: 'image/jpeg' },
    });
    return res.url || '';
  } catch (err) {
    console.warn('[avatar] upload failed', err);
    return '';
  }
}
