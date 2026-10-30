import fs from 'node:fs';
import path from 'node:path';
import { randomUUID as uuidv4 } from 'node:crypto';
import { config } from '../config.js';

/** 上传目录跟数据库同盘，云托管挂 /data 时照片也能持久 */
function uploadsDir(): string {
  const base = path.dirname(config.dbPath);
  const dir = path.join(base, 'uploads');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * 保存小程序传来的图片（base64）。
 * 设计决策：不依赖微信云存储；文件落在持久盘，经 /api/media/local 读出。
 */
export function saveUploadedPhoto(input: {
  base64: string;
  mime?: string;
}): { id: string; url: string } {
  const raw = String(input.base64 || '').replace(/^data:[^;]+;base64,/, '');
  if (!raw || raw.length < 32) {
    throw Object.assign(new Error('图片无效'), { status: 400 });
  }
  // 约 2MB 上限，避免撑爆实例
  if (raw.length > 2.8e6) {
    throw Object.assign(new Error('图片太大，请压缩后再传'), { status: 400 });
  }

  const mime = (input.mime || 'image/jpeg').toLowerCase();
  const ext = mime.includes('png')
    ? 'png'
    : mime.includes('webp')
      ? 'webp'
      : 'jpg';
  const id = `${uuidv4()}.${ext}`;
  const buf = Buffer.from(raw, 'base64');
  fs.writeFileSync(path.join(uploadsDir(), id), buf);
  return { id, url: `/api/media/local/${id}` };
}

export function readLocalPhoto(
  id: string
): { buffer: Buffer; contentType: string } | null {
  if (!/^[a-f0-9-]+\.(jpg|jpeg|png|webp)$/i.test(id)) return null;
  const file = path.join(uploadsDir(), id);
  if (!fs.existsSync(file)) return null;
  const ext = path.extname(id).toLowerCase();
  const contentType =
    ext === '.png'
      ? 'image/png'
      : ext === '.webp'
        ? 'image/webp'
        : 'image/jpeg';
  return { buffer: fs.readFileSync(file), contentType };
}
