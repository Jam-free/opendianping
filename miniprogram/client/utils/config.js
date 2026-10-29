"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.API_BASE = exports.CLOUD_SERVICE = exports.CLOUD_ENV = exports.RESOURCE_APPID = void 0;
/**
 * 真机走微信云托管内部通道，不把测试域名写进「服务器域名」。
 *
 * 美食后台部署在「美食探索」小程序的云环境里。
 * 肥猫通过「资源复用」借用那朵云，因此必须带上资源方 AppID 初始化，
 * 不能只用 wx.cloud.init（那是给环境主人自己用的）。
 */
exports.RESOURCE_APPID = 'wxdc667965329f3c1b';
exports.CLOUD_ENV = 'prod-d7gehpzxo723b97cb';
exports.CLOUD_SERVICE = 'feimaocat-api';
/**
 * 仅店铺图片仍拼这个公网地址。
 * 微信不允许把 sh.run.tcloudbase.com 填进正式环境，所以真机上图片可能暂时空白。
 */
exports.API_BASE = 'https://feimaocat-api-311874-12-1485452020.sh.run.tcloudbase.com';
