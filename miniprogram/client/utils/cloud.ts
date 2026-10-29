import { CLOUD_ENV, RESOURCE_APPID } from './config';

type CloudInstance = {
  init: () => Promise<void> | void;
  callContainer: (opts: any) => void;
};

let cloud: CloudInstance | null = null;
let ready: Promise<CloudInstance> | null = null;

/**
 * 拿到可调用美食云托管的 Cloud 实例。
 * 资源在美食探索账号下，肥猫必须用 resourceAppid 初始化，否则会 404。
 */
export function getSharedCloud(): Promise<CloudInstance> {
  if (ready) return ready;

  ready = new Promise((resolve, reject) => {
    try {
      if (!wx.cloud || !(wx.cloud as any).Cloud) {
        reject(new Error('云通道还没打开，请用较新的微信基础库再试'));
        return;
      }
      const c = new (wx.cloud as any).Cloud({
        resourceAppid: RESOURCE_APPID,
        resourceEnv: CLOUD_ENV,
      }) as CloudInstance;
      Promise.resolve(c.init()).then(
        () => {
          cloud = c;
          resolve(c);
        },
        (err) => {
          ready = null;
          reject(err || new Error('云环境初始化失败'));
        }
      );
    } catch (err) {
      ready = null;
      reject(err as Error);
    }
  });

  return ready;
}

/** 启动时预热，登录页一点就能用 */
export function warmCloud(): void {
  getSharedCloud().catch(() => {
    /* 登录时再报错 */
  });
}
