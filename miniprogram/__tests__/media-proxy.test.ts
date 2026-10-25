import {
  decodeProxiedUrlParam,
  normalizeUpstreamMediaUrl,
  isAllowedMediaUrl,
  buildProxyPath,
} from '../server/services/media-proxy.js';

describe('media proxy URL 规范化', () => {
  test('解开双重编码的 %2540（美团 @300w）', () => {
    const raw =
      'http%3A%2F%2Fp0.meituan.net%2Fbiztone%2Ffoo.jpg%2540300w_300h';
    const decoded = decodeProxiedUrlParam(raw);
    expect(decoded).toContain('p0.meituan.net');
    expect(decoded.includes('%2540')).toBe(false);
    // 最终应能还原出 @ 或仍保留单层 %40，均可被 normalize
    const normalized = normalizeUpstreamMediaUrl(raw);
    expect(normalized).toBeTruthy();
    expect(normalized!.startsWith('https://p0.meituan.net/')).toBe(true);
    expect(normalized!.includes('@300w') || normalized!.includes('%40300w')).toBe(
      true
    );
  });

  test('http 升级为 https，并放行 meituan 子域', () => {
    const n = normalizeUpstreamMediaUrl(
      'http://p0.meituan.net/biztone/foo.jpg@300w_300h_1e_1c_1l'
    );
    expect(n).toBe(
      'https://p0.meituan.net/biztone/foo.jpg@300w_300h_1e_1c_1l'
    );
    expect(isAllowedMediaUrl('http://img.meituan.net/a.jpg')).toBe(true);
  });

  test('拒绝非白名单域名', () => {
    expect(isAllowedMediaUrl('https://evil.example/x.jpg')).toBe(false);
    expect(normalizeUpstreamMediaUrl('https://evil.example/x.jpg')).toBeNull();
  });

  test('buildProxyPath 只 encode 一次', () => {
    const path = buildProxyPath(
      'https://img.meituan.net/content/a.jpg%40300w'
    );
    expect(path.startsWith('/api/media/proxy?url=')).toBe(true);
    expect(path.includes('%2540')).toBe(true); // encode 后 % → %25
    expect(path.includes('%252540')).toBe(false); // 不应三次编码
  });
});
