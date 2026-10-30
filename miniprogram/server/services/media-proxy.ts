import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';

/**
 * 点评 / 美团店铺头图域名白名单。
 * 设计决策：只代理已知 CDN，避免开放代理被滥用成任意外网跳板。
 */
const ALLOWED_HOST_SUFFIXES = [
  'meituan.net',
  'dianping.com',
  'dpfile.com',
  'dpurl.cn',
];

const cacheDir = path.join(config.rootDir, 'data', 'media-cache');

/**
 * 1×1 浅灰 JPEG：代理失败时返回 200 占位，而不是 404。
 * 产品意图：客户端不要因反复 404 刷屏或露出粗糙灰块；列表侧还有本地兜底图。
 */
const FALLBACK_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBEQCEAwEPwAB/9k=',
  'base64'
);

function ensureCacheDir(): void {
  if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true });
  }
}

function hostAllowed(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return ALLOWED_HOST_SUFFIXES.some(
    (suffix) => host === suffix || host.endsWith(`.${suffix}`)
  );
}

/**
 * 解开查询参数里的多重编码。
 *
 * 根因：美团原图常把 `@300w` 写成 `%40`；再经 encodeURIComponent 后变成 `%2540`。
 * Express 对 query 只自动 decode 一次，服务端仍可能看到 `%40` 或残留 `%25`。
 * 设计模式：幂等规范化（反复 decode 直到稳定），再交给 URL 解析。
 */
export function decodeProxiedUrlParam(raw: string): string {
  let cur = String(raw || '').trim();
  if (!cur) return '';
  for (let i = 0; i < 4; i++) {
    try {
      const next = decodeURIComponent(cur);
      if (next === cur) break;
      cur = next;
    } catch {
      break;
    }
  }
  return cur;
}

/**
 * 把上游地址整理成可抓取的 https URL。
 * - http → https（美团 CDN 均支持 TLS；白名单旧逻辑只放行 https 会直接拒掉大量图）
 * - 路径里残留的 `%40`/`%7C` 再解一层，还原成 `@`/`|`，贴近 CDN 真实路径
 */
export function normalizeUpstreamMediaUrl(raw: string): string | null {
  const decoded = decodeProxiedUrlParam(raw);
  if (!decoded) return null;
  let candidate = decoded;
  if (candidate.startsWith('//')) candidate = `https:${candidate}`;

  let u: URL;
  try {
    u = new URL(candidate);
  } catch {
    return null;
  }

  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (!hostAllowed(u.hostname)) return null;

  u.protocol = 'https:';
  // 路径段里若仍是百分号编码的 @ | 等，还原为字面量，避免上游 404
  try {
    u.pathname = decodeURIComponent(u.pathname);
  } catch {
    /* 保持原 pathname */
  }
  return u.toString();
}

export function isAllowedMediaUrl(raw: string): boolean {
  return normalizeUpstreamMediaUrl(raw) != null;
}

/** 浏览器味请求头：部分美团图对空/脚本 UA 会拒；Referer 贴近点评站内打开 */
function upstreamHeaders(targetUrl: string): Record<string, string> {
  let referer = 'https://www.dianping.com/';
  try {
    const u = new URL(targetUrl);
    referer = `https://${u.hostname}/`;
  } catch {
    /* keep default */
  }
  return {
    'User-Agent':
      'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.0',
    Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
    Referer: referer,
  };
}

/**
 * 代理外链图片：规范化 URL → 磁盘缓存 → 流式返回。
 * 失败返回 null，由路由层改送占位图（200），避免客户端反复 404。
 */
export async function fetchProxiedImage(
  rawUrl: string
): Promise<{ buffer: Buffer; contentType: string } | null> {
  const normalized = normalizeUpstreamMediaUrl(rawUrl);
  if (!normalized) return null;

  ensureCacheDir();
  const hash = createHash('sha256').update(normalized).digest('hex');
  const cached = path.join(cacheDir, hash);
  if (fs.existsSync(cached)) {
    const buffer = fs.readFileSync(cached);
    return { buffer, contentType: guessContentType(normalized, buffer) };
  }

  try {
    const res = await fetch(normalized, {
      signal: AbortSignal.timeout(12_000),
      headers: upstreamHeaders(normalized),
      redirect: 'follow',
    });
    if (!res.ok) return null;
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length < 32 || buffer.length > 2_000_000) return null;
    fs.writeFileSync(cached, buffer);
    const contentType =
      res.headers.get('content-type') || guessContentType(normalized, buffer);
    return { buffer, contentType };
  } catch {
    return null;
  }
}

/** 代理失败时的静默兜底（200 + 极小 JPEG） */
export function fallbackPlaceholderImage(): {
  buffer: Buffer;
  contentType: string;
} {
  return { buffer: FALLBACK_JPEG, contentType: 'image/jpeg' };
}

function guessContentType(url: string, buffer?: Buffer): string {
  if (buffer && buffer.length >= 3) {
    if (buffer[0] === 0xff && buffer[1] === 0xd8) return 'image/jpeg';
    if (buffer[0] === 0x89 && buffer[1] === 0x50) return 'image/png';
    if (buffer[0] === 0x52 && buffer[1] === 0x49) return 'image/webp';
  }
  if (/\.webp/i.test(url)) return 'image/webp';
  if (/\.png/i.test(url)) return 'image/png';
  return 'image/jpeg';
}

export function buildProxyPath(rawUrl: string): string {
  // 本地上传图已是本服务路径，不必再走外链代理
  if (rawUrl.startsWith('/api/media/local/')) return rawUrl;
  // 存库的是原始 headImg；这里只 encode 一次。客户端拼 API_BASE 后由 Express 解一次。
  return `/api/media/proxy?url=${encodeURIComponent(rawUrl)}`;
}
