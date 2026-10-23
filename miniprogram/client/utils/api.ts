import { API_BASE } from './config';

type Json = Record<string, unknown>;

function getAppSafe(): WechatMiniprogram.App.Instance<{
  globalData: { token: string; userId: string };
}> {
  return getApp();
}

export async function ensureLogin(): Promise<string> {
  const app = getAppSafe();
  if (app.globalData.token) return app.globalData.token;

  const cached = wx.getStorageSync('session_token') as string;
  if (cached) {
    app.globalData.token = cached;
    return cached;
  }

  const loginRes = await new Promise<WechatMiniprogram.LoginSuccessCallbackResult>(
    (resolve, reject) => {
      wx.login({ success: resolve, fail: reject });
    }
  );

  const data = await request<{
    token: string;
    user: { id: string };
  }>('/api/auth/login', {
    method: 'POST',
    data: { code: loginRes.code || 'dev' },
    auth: false,
  });

  app.globalData.token = data.token;
  app.globalData.userId = data.user.id;
  wx.setStorageSync('session_token', data.token);
  return data.token;
}

export async function request<T>(
  path: string,
  options: {
    method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
    data?: Json;
    auth?: boolean;
  } = {}
): Promise<T> {
  const auth = options.auth !== false;
  let token = '';
  if (auth) token = await ensureLogin();

  return new Promise((resolve, reject) => {
    wx.request({
      url: `${API_BASE}${path}`,
      method: options.method || 'GET',
      data: options.data,
      header: {
        'content-type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      success(res) {
        const status = res.statusCode || 0;
        const body = res.data as { error?: string } & T;
        if (status >= 200 && status < 300) {
          resolve(body);
          return;
        }
        reject(new Error(body?.error || `请求失败(${status})`));
      },
      fail(err) {
        reject(new Error(err.errMsg || '网络错误'));
      },
    });
  });
}

/** 打开外部地图导航（高德 / 腾讯 scheme，缺失坐标则提示） */
export function openNavigation(shop: {
  name: string;
  lat?: number;
  lng?: number;
  address?: string;
}) {
  if (shop.lat == null || shop.lng == null) {
    wx.showToast({ title: '暂无坐标', icon: 'none' });
    return;
  }
  const name = encodeURIComponent(shop.name);
  const amap = `https://uri.amap.com/navigation?to=${shop.lng},${shop.lat},${name}&mode=walk&src=opendianping`;
  wx.setClipboardData({
    data: amap,
    success() {
      wx.showModal({
        title: '导航链接已复制',
        content: '可粘贴到浏览器或高德 App 打开；小程序内也可使用下方地图选点。',
        confirmText: '打开地图',
        success(r) {
          if (r.confirm) {
            wx.openLocation({
              latitude: shop.lat!,
              longitude: shop.lng!,
              name: shop.name,
              address: shop.address || '',
              scale: 16,
            });
          }
        },
      });
    },
  });
}
