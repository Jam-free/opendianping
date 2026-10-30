"use strict";
/**
 * 记美食传图：callContainer 请求体约 100KiB 上限。
 * 先压 JPEG，再 base64 上传；超限直接白话报错，避免甩 -606001。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.compressPhotoForUpload = compressPhotoForUpload;
exports.readPhotoBase64 = readPhotoBase64;
const MAX_BYTES = 58 * 1024; // base64 后约 78KB，给 JSON 外壳留余量
function fileSize(path) {
    const fs = wx.getFileSystemManager();
    try {
        const st = fs.statSync(path);
        return Number(st === null || st === void 0 ? void 0 : st.size) || 0;
    }
    catch (_a) {
        return 0;
    }
}
function compressOnce(src, quality) {
    return new Promise((resolve, reject) => {
        wx.compressImage({
            src,
            quality,
            success: (res) => {
                if (res.tempFilePath)
                    resolve(res.tempFilePath);
                else
                    reject(new Error('压缩失败'));
            },
            fail: (err) => reject(new Error((err === null || err === void 0 ? void 0 : err.errMsg) || '压缩失败')),
        });
    });
}
/** 压到 callContainer 能带走的大小；返回临时路径 */
async function compressPhotoForUpload(tempPath) {
    let path = tempPath;
    let quality = 72;
    for (let i = 0; i < 6; i++) {
        path = await compressOnce(path, quality);
        if (fileSize(path) <= MAX_BYTES)
            return path;
        quality = Math.max(18, quality - 12);
    }
    if (fileSize(path) > MAX_BYTES) {
        throw new Error('照片太大，请换一张或裁小一点再试');
    }
    return path;
}
async function readPhotoBase64(path) {
    const fs = wx.getFileSystemManager();
    return fs.readFileSync(path, 'base64');
}
