"use strict";
/**
 * 记美食传图。
 *
 * 产品坑：手机里 200KB 的图「看起来不大」，但 callContainer 整包约 100KiB。
 * base64 还会再胀 ~1.33 倍，所以必须先缩边长，不能只拧 JPEG 质量。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.compressPhotoForUpload = compressPhotoForUpload;
exports.readPhotoBase64 = readPhotoBase64;
exports.estimatePayloadBytes = estimatePayloadBytes;
exports.uploadPhotoPublic = uploadPhotoPublic;
const config_1 = require("./config");
/** 二进制目标：base64 后仍留 JSON 外壳余量 */
const MAX_BYTES = 58 * 1024;
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
function compressOnce(src, quality, maxEdge) {
    return new Promise((resolve, reject) => {
        const opts = {
            src,
            quality,
            success: (res) => {
                if (res.tempFilePath)
                    resolve(res.tempFilePath);
                else
                    reject(new Error('压缩失败'));
            },
            fail: (err) => reject(new Error((err === null || err === void 0 ? void 0 : err.errMsg) || '压缩失败')),
        };
        // 缩边长才压得动已经是 JPEG 的相册图；只拧 quality 往往几乎不动
        if (maxEdge && maxEdge > 0) {
            opts.compressedWidth = maxEdge;
        }
        wx.compressImage(opts);
    });
}
/**
 * 压到 callContainer 能带走的大小。
 * 从原图反复：960→720→540→400 边长 + 递减质量。
 */
async function compressPhotoForUpload(tempPath) {
    const steps = [
        { edge: 960, quality: 70 },
        { edge: 720, quality: 60 },
        { edge: 540, quality: 50 },
        { edge: 420, quality: 40 },
        { edge: 360, quality: 32 },
        { edge: 280, quality: 24 },
    ];
    let last = tempPath;
    let lastSize = fileSize(tempPath);
    for (const step of steps) {
        try {
            // 始终从原图缩，避免连环压糊掉还压不小
            last = await compressOnce(tempPath, step.quality, step.edge);
            lastSize = fileSize(last);
            if (lastSize > 0 && lastSize <= MAX_BYTES)
                return last;
        }
        catch (_a) {
            /* 个别基础库不认 compressedWidth，退回只压质量 */
            try {
                last = await compressOnce(last, step.quality);
                lastSize = fileSize(last);
                if (lastSize > 0 && lastSize <= MAX_BYTES)
                    return last;
            }
            catch (_b) {
                /* 继续下一档 */
            }
        }
    }
    if (lastSize > 0 && lastSize <= MAX_BYTES)
        return last;
    // 仍超：返回当前最小结果，交给公网通道兜底（见 uploadLocalPhoto）
    return last;
}
async function readPhotoBase64(path) {
    const fs = wx.getFileSystemManager();
    return fs.readFileSync(path, 'base64');
}
/** 估算 base64 JSON 包大概多大（字符数≈字节数） */
function estimatePayloadBytes(base64) {
    // {"base64":"...","mime":"image/jpeg"} 外壳约 40B
    return base64.length + 48;
}
/**
 * 公网直传：不受 callContainer 100KiB 限制。
 * 需合法域名或开发工具勾选「不校验」；失败则抛错。
 */
function uploadPhotoPublic(base64, token) {
    return new Promise((resolve, reject) => {
        wx.request({
            url: `${config_1.API_BASE}/api/me/photos`,
            method: 'POST',
            timeout: 30000,
            header: {
                'content-type': 'application/json',
                Authorization: `Bearer ${token}`,
            },
            data: { base64, mime: 'image/jpeg' },
            success(res) {
                const status = res.statusCode || 0;
                const body = res.data || {};
                if (status >= 200 && status < 300 && body.url) {
                    resolve(body.url);
                    return;
                }
                reject(new Error(body.error || `上传失败(${status})`));
            },
            fail(err) {
                reject(new Error((err === null || err === void 0 ? void 0 : err.errMsg) || '公网上传失败'));
            },
        });
    });
}
