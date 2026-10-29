"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSharedCloud = getSharedCloud;
exports.warmCloud = warmCloud;
const config_1 = require("./config");
let cloud = null;
let ready = null;
/**
 * 拿到可调用美食云托管的 Cloud 实例。
 * 资源在美食探索账号下，肥猫必须用 resourceAppid 初始化，否则会 404。
 */
function getSharedCloud() {
    if (ready)
        return ready;
    ready = new Promise((resolve, reject) => {
        try {
            if (!wx.cloud || !wx.cloud.Cloud) {
                reject(new Error('云通道还没打开，请用较新的微信基础库再试'));
                return;
            }
            const c = new wx.cloud.Cloud({
                resourceAppid: config_1.RESOURCE_APPID,
                resourceEnv: config_1.CLOUD_ENV,
            });
            Promise.resolve(c.init()).then(() => {
                cloud = c;
                resolve(c);
            }, (err) => {
                ready = null;
                reject(err || new Error('云环境初始化失败'));
            });
        }
        catch (err) {
            ready = null;
            reject(err);
        }
    });
    return ready;
}
/** 启动时预热，登录页一点就能用 */
function warmCloud() {
    getSharedCloud().catch(() => {
        /* 登录时再报错 */
    });
}
