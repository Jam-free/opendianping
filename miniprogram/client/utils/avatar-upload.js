"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.uploadAvatarOrEmpty = uploadAvatarOrEmpty;
/**
 * 头像上传：只走 callContainer（微信内网），不走公网域名。
 * 公网 sh.run.tcloudbase.com 往往没配进合法域名，会直接 fetch failed。
 */
const api_1 = require("./api");
const photo_upload_1 = require("./photo-upload");
/** 头像再压小一点，保证塞进 callContainer 约 100KiB 限制 */
async function compressAvatar(tempPath) {
    // 先走通用压缩；若仍偏大，再压一档边长
    let path = await (0, photo_upload_1.compressPhotoForUpload)(tempPath);
    let base64 = await (0, photo_upload_1.readPhotoBase64)(path);
    if ((0, photo_upload_1.estimatePayloadBytes)(base64) <= 80 * 1024)
        return path;
    return new Promise((resolve, reject) => {
        wx.compressImage({
            src: tempPath,
            quality: 40,
            compressedWidth: 240,
            success: (res) => {
                if (res.tempFilePath)
                    resolve(res.tempFilePath);
                else
                    reject(new Error('头像压缩失败'));
            },
            fail: (err) => reject(new Error((err === null || err === void 0 ? void 0 : err.errMsg) || '头像压缩失败')),
        });
    });
}
/**
 * 把微信临时头像存成服务端路径。
 * 失败返回空字符串——登录不应被头像上传卡住。
 */
async function uploadAvatarOrEmpty(tempPath) {
    if (!tempPath)
        return '';
    if (tempPath.startsWith('/api/media/local/'))
        return tempPath;
    try {
        await (0, api_1.ensureLogin)();
        const path = await compressAvatar(tempPath);
        const base64 = await (0, photo_upload_1.readPhotoBase64)(path);
        if ((0, photo_upload_1.estimatePayloadBytes)(base64) > 95 * 1024) {
            // 再压仍超限：放弃头像，不拦登录
            console.warn('[avatar] still too large after compress');
            return '';
        }
        const res = await (0, api_1.request)('/api/me/photos', {
            method: 'POST',
            data: { base64, mime: 'image/jpeg' },
        });
        return res.url || '';
    }
    catch (err) {
        console.warn('[avatar] upload failed', err);
        return '';
    }
}
