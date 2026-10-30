/**
 * 记美食传图：callContainer 请求体约 100KiB 上限。
 * 先压 JPEG，再 base64 上传；超限直接白话报错，避免甩 -606001。
 */

const MAX_BYTES = 58 * 1024; // base64 后约 78KB，给 JSON 外壳留余量

function fileSize(path: string): number {
  const fs = wx.getFileSystemManager();
  try {
    const st = fs.statSync(path) as { size?: number };
    return Number(st?.size) || 0;
  } catch {
    return 0;
  }
}

function compressOnce(src: string, quality: number): Promise<string> {
  return new Promise((resolve, reject) => {
    wx.compressImage({
      src,
      quality,
      success: (res: { tempFilePath?: string }) => {
        if (res.tempFilePath) resolve(res.tempFilePath);
        else reject(new Error('压缩失败'));
      },
      fail: (err: { errMsg?: string }) =>
        reject(new Error(err?.errMsg || '压缩失败')),
    });
  });
}

/** 压到 callContainer 能带走的大小；返回临时路径 */
export async function compressPhotoForUpload(tempPath: string): Promise<string> {
  let path = tempPath;
  let quality = 72;
  for (let i = 0; i < 6; i++) {
    path = await compressOnce(path, quality);
    if (fileSize(path) <= MAX_BYTES) return path;
    quality = Math.max(18, quality - 12);
  }
  if (fileSize(path) > MAX_BYTES) {
    throw new Error('照片太大，请换一张或裁小一点再试');
  }
  return path;
}

export async function readPhotoBase64(path: string): Promise<string> {
  const fs = wx.getFileSystemManager();
  return fs.readFileSync(path, 'base64') as string;
}
