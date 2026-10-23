import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';

/** 点评 headImg 常见域名；小程序 downloadFile 需在微信后台配置合法域名 */
const ALLOWED_HOSTS = new Set([
  'img.meituan.net',
  'p0.meituan.net',
  'p1.meituan.net',
  'img.dianping.com',
]);

const cacheDir = path.join(config.rootDir, 'data', 'media-cache');

function ensureCacheDir(): void {
  if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true });
  }
}

export function isAllowedMediaUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' && ALLOWED_HOSTS.has(u.hostname);
  } catch {
    return false;
  }
}

/** 代理外链图片：磁盘缓存 + 流式返回，避免小程序直连第三方域名 */
export async function fetchProxiedImage(
  rawUrl: string
): Promise<{ buffer: Buffer; contentType: string } | null> {
  if (!isAllowedMediaUrl(rawUrl)) return null;
  ensureCacheDir();
  const hash = createHash('sha256').update(rawUrl).digest('hex');
  const cached = path.join(cacheDir, hash);
  if (fs.existsSync(cached)) {
    const buffer = fs.readFileSync(cached);
    const contentType = guessContentType(rawUrl);
    return { buffer, contentType };
  }

  try {
    const res = await fetch(rawUrl, {
      signal: AbortSignal.timeout(12_000),
      headers: { 'User-Agent': 'opendianping-miniprogram/0.2' },
    });
    if (!res.ok) return null;
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length > 2_000_000) return null;
    fs.writeFileSync(cached, buffer);
    const contentType =
      res.headers.get('content-type') || guessContentType(rawUrl);
    return { buffer, contentType };
  } catch {
    return null;
  }
}

function guessContentType(url: string): string {
  if (/\.webp/i.test(url)) return 'image/webp';
  if (/\.png/i.test(url)) return 'image/png';
  return 'image/jpeg';
}

export function buildProxyPath(rawUrl: string): string {
  return `/api/media/proxy?url=${encodeURIComponent(rawUrl)}`;
}
