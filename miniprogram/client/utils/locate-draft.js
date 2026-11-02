"use strict";
/**
 * 记美食草稿：入口三选一 → 白板/选点之间传递照片与美食地点。
 * 存在 storage，避免临时路径塞进 URL。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_PHOTO_PICK_BYTES = exports.MAX_LOCATE_PHOTOS = void 0;
exports.readLocateDraft = readLocateDraft;
exports.writeLocateDraft = writeLocateDraft;
exports.clearLocateDraft = clearLocateDraft;
exports.nearbyFoodName = nearbyFoodName;
exports.chooseLocatePhotos = chooseLocatePhotos;
exports.startLocateFlow = startLocateFlow;
exports.MAX_LOCATE_PHOTOS = 3;
/** 单张原图上限；再大压缩也费事，直接请用户换一张 */
exports.MAX_PHOTO_PICK_BYTES = 15 * 1024 * 1024;
const KEY = 'locate_draft_v1';
function readLocateDraft() {
    try {
        const raw = wx.getStorageSync(KEY);
        if (!raw || typeof raw !== 'object')
            return { photos: [] };
        return {
            photos: Array.isArray(raw.photos) ? raw.photos.filter(Boolean) : [],
            place: raw.place || null,
            note: raw.note || '',
        };
    }
    catch (_a) {
        return { photos: [] };
    }
}
function writeLocateDraft(patch) {
    const cur = readLocateDraft();
    const next = {
        photos: patch.photos !== undefined ? patch.photos : cur.photos,
        place: patch.place !== undefined ? patch.place : cur.place,
        note: patch.note !== undefined ? patch.note : cur.note,
    };
    wx.setStorageSync(KEY, next);
    return next;
}
function clearLocateDraft() {
    try {
        wx.removeStorageSync(KEY);
    }
    catch (_a) {
        /* ignore */
    }
}
/** 从地址里抽一个短地名，拼「XXX附近的美食」 */
function nearbyFoodName(parts) {
    const short = (parts.township || '').trim() ||
        (parts.street || '').trim() ||
        (parts.district || '').trim() ||
        shortFromAddress(parts.address || '');
    return `${short || '这里'}附近的美食`;
}
function shortFromAddress(address) {
    if (!address)
        return '';
    const tail = address
        .split(/省|市|区|县|街道|镇/)
        .map((s) => s.trim())
        .filter(Boolean);
    const last = tail[tail.length - 1] || address;
    return last.slice(0, 16);
}
function fileSize(path) {
    try {
        const st = wx.getFileSystemManager().statSync(path);
        return Number(st === null || st === void 0 ? void 0 : st.size) || 0;
    }
    catch (_a) {
        return 0;
    }
}
/**
 * 选图：拍摄或相册。
 * 边界：最多 MAX_LOCATE_PHOTOS 张；单张超 15MB 跳过并提示。
 */
function chooseLocatePhotos(source, already = 0) {
    const remain = Math.max(0, exports.MAX_LOCATE_PHOTOS - already);
    if (remain <= 0) {
        wx.showToast({ title: `最多 ${exports.MAX_LOCATE_PHOTOS} 张图`, icon: 'none' });
        return Promise.resolve([]);
    }
    return new Promise((resolve) => {
        wx.chooseMedia({
            count: remain,
            mediaType: ['image'],
            sourceType: source === 'camera' ? ['camera'] : ['album'],
            sizeType: ['compressed'],
            success: (res) => {
                const files = (res === null || res === void 0 ? void 0 : res.tempFiles) || [];
                const ok = [];
                let skippedBig = 0;
                for (const f of files) {
                    const path = (f === null || f === void 0 ? void 0 : f.tempFilePath) || '';
                    if (!path)
                        continue;
                    const size = Number(f.size) || fileSize(path);
                    if (size > exports.MAX_PHOTO_PICK_BYTES) {
                        skippedBig += 1;
                        continue;
                    }
                    ok.push(path);
                }
                if (skippedBig) {
                    wx.showToast({
                        title: '有图片太大，已跳过',
                        icon: 'none',
                    });
                }
                if (!ok.length && !skippedBig) {
                    wx.showToast({ title: '没有选到图片', icon: 'none' });
                }
                resolve(ok.slice(0, remain));
            },
            fail: () => resolve([]),
        });
    });
}
/**
 * 底栏「记美食」：拍摄 / 相册 / 记录地点。
 */
function startLocateFlow() {
    wx.showActionSheet({
        itemList: ['拍摄', '从相册选择', '记录地点'],
        success: async (tap) => {
            const idx = tap.tapIndex;
            if (idx === 0 || idx === 1) {
                const photos = await chooseLocatePhotos(idx === 0 ? 'camera' : 'album', 0);
                // 取消选图 / 全部被跳过：不进白板
                if (!photos.length)
                    return;
                clearLocateDraft();
                writeLocateDraft({ photos, place: null, note: '' });
                wx.navigateTo({ url: '/pages/locate-note/locate-note' });
                return;
            }
            if (idx === 2) {
                clearLocateDraft();
                writeLocateDraft({ photos: [], place: null, note: '' });
                wx.navigateTo({ url: '/pages/place-pick/place-pick?entry=1' });
            }
        },
    });
}
