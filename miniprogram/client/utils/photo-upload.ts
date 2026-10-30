/**
 * 记美食传图。
 *
 * 产品坑：手机里 200KB 的图「看起来不大」，但 callContainer 整包约 100KiB。
 * base64 还会再胀 ~1.33 倍，所以必须先缩边长，不能只拧 JPEG 质量。
 */

import { API_BASE } from './config';

/** 二进制目标：base64 后仍留 JSON 外壳余量 */
const MAX_BYTES = 58 * 1024;

function fileSize(path: string): number {
  const fs = wx.getFileSystemManager();
  try {
    const st = fs.statSync(path) as { size?: number };
    return Number(st?.size) || 0;
  } catch {
    return 0;
  }
}

function compressOnce(
  src: string,
  quality: number,
  maxEdge?: number
): Promise<string> {
  return new Promise((resolve, reject) => {
    const opts: Record<string, unknown> = {
      src,
      quality,
      success: (res: { tempFilePath?: string }) => {
        if (res.tempFilePath) resolve(res.tempFilePath);
        else reject(new Error('压缩失败'));
      },
      fail: (err: { errMsg?: string }) =>
        reject(new Error(err?.errMsg || '压缩失败')),
    };
    // 缩边长才压得动已经是 JPEG 的相册图；只拧 quality 往往几乎不动
    if (maxEdge && maxEdge > 0) {
      opts.compressedWidth = maxEdge;
    }
    wx.compressImage(opts);
  });
}

/**
 * 压到 callContainer 能带走的大小。
 * 从原图反复：960→720→540→400 边长 + 递减质量。
 */
export async function compressPhotoForUpload(tempPath: string): Promise<string> {
  const steps: Array<{ edge: number; quality: number }> = [
    { edge: 960, quality: 70 },
    { edge: 720, quality: 60 },
    { edge: 540, quality: 50 },
    { edge: 420, quality: 40 },
    { edge: 360, quality: 32 },
    { edge: 280, quality: 24 },
  ];

  let last = tempPath;
  let lastSize = fileSize(tempPath);

  for (const step of steps) {
    try {
      // 始终从原图缩，避免连环压糊掉还压不小
      last = await compressOnce(tempPath, step.quality, step.edge);
      lastSize = fileSize(last);
      if (lastSize > 0 && lastSize <= MAX_BYTES) return last;
    } catch {
      /* 个别基础库不认 compressedWidth，退回只压质量 */
      try {
        last = await compressOnce(last, step.quality);
        lastSize = fileSize(last);
        if (lastSize > 0 && lastSize <= MAX_BYTES) return last;
      } catch {
        /* 继续下一档 */
      }
    }
  }

  if (lastSize > 0 && lastSize <= MAX_BYTES) return last;
  // 仍超：返回当前最小结果，交给公网通道兜底（见 uploadLocalPhoto）
  return last;
}

export async function readPhotoBase64(path: string): Promise<string> {
  const fs = wx.getFileSystemManager();
  return fs.readFileSync(path, 'base64') as string;
}

/** 估算 base64 JSON 包大概多大（字符数≈字节数） */
export function estimatePayloadBytes(base64: string): number {
  // {"base64":"...","mime":"image/jpeg"} 外壳约 40B
  return base64.length + 48;
}

/**
 * 公网直传：不受 callContainer 100KiB 限制。
 * 需合法域名或开发工具勾选「不校验」；失败则抛错。
 */
export function uploadPhotoPublic(
  base64: string,
  token: string
): Promise<string> {
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${API_BASE}/api/me/photos`,
      method: 'POST',
      timeout: 30000,
      header: {
        'content-type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      data: { base64, mime: 'image/jpeg' },
      success(res: {
        statusCode?: number;
        data?: { url?: string; error?: string };
      }) {
        const status = res.statusCode || 0;
        const body = res.data || {};
        if (status >= 200 && status < 300 && body.url) {
          resolve(body.url);
          return;
        }
        reject(new Error(body.error || `上传失败(${status})`));
      },
      fail(err: { errMsg?: string }) {
        reject(new Error(err?.errMsg || '公网上传失败'));
      },
    });
  });
}
