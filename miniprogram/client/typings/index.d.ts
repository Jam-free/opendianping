/// 精简微信类型，避免强制安装 miniprogram-api-typings 才能打开工程
declare namespace WechatMiniprogram {
  interface LoginSuccessCallbackResult {
    code: string;
  }
  interface GetLocationSuccessCallbackResult {
    latitude: number;
    longitude: number;
  }
  interface Input {
    detail: { value: string };
  }
  interface SwitchChange {
    detail: { value: boolean };
  }
  interface PickerChange {
    detail: { value: string | number };
  }
  interface TouchEvent {
    currentTarget: { dataset: Record<string, string | number | undefined> };
  }
  interface CustomEvent {
    detail: any;
  }
  interface ShowModalSuccessCallbackResult {
    confirm: boolean;
    cancel: boolean;
    content?: string;
  }
  namespace App {
    interface Instance<T extends Record<string, any>> {
      globalData: T['globalData'] extends infer G ? G : any;
    }
  }
}

declare const App: (options: Record<string, any>) => void;
declare const Page: (options: Record<string, any>) => void;
declare const Component: (options: Record<string, any>) => void;
declare const getApp: <T = any>() => T;
declare const wx: {
  login: (opts: any) => void;
  request: (opts: any) => void;
  showShareMenu: (opts: any) => void;
  showToast: (opts: any) => void;
  showModal: (opts: any) => void;
  navigateTo: (opts: any) => void;
  redirectTo: (opts: any) => void;
  switchTab: (opts: any) => void;
  navigateBack: (opts?: any) => void;
  setStorageSync: (k: string, v: any) => void;
  getStorageSync: (k: string) => any;
  removeStorageSync: (k: string) => void;
  setClipboardData: (opts: any) => void;
  openLocation: (opts: any) => void;
  getLocation: (opts: any) => void;
  chooseMedia: (opts: any) => void;
  previewImage: (opts: any) => void;
  setNavigationBarTitle: (opts: any) => void;
  stopPullDownRefresh: () => void;
  getGroupEnterInfo?: (opts: any) => void;
};
