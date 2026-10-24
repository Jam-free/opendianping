"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const api_1 = require("./utils/api");
/**
 * 小程序入口。
 * withShareTicket：分享到群后，打开者可拿到群信息用于「仅本群可加入」校验。
 */
App({
    globalData: {
        token: '',
        userId: '',
    },
    onLaunch() {
        wx.showShareMenu({
            withShareTicket: true,
            menus: ['shareAppMessage', 'shareTimeline'],
        });
        (0, api_1.ensureLogin)().catch((err) => {
            console.warn('登录失败', err);
        });
    },
});
