"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const api_1 = require("../../utils/api");
const config_1 = require("../../utils/config");
const media_1 = require("../../utils/media");
const locate_draft_1 = require("../../utils/locate-draft");
const photo_upload_1 = require("../../utils/photo-upload");
async function uploadLocalPhoto(tempPath) {
    const compressed = await (0, photo_upload_1.compressPhotoForUpload)(tempPath);
    const base64 = await (0, photo_upload_1.readPhotoBase64)(compressed);
    const payload = (0, photo_upload_1.estimatePayloadBytes)(base64);
    const token = await (0, api_1.ensureLogin)();
    if (payload > 90 * 1024) {
        return (0, photo_upload_1.uploadPhotoPublic)(base64, token);
    }
    try {
        const res = await (0, api_1.request)('/api/me/photos', {
            method: 'POST',
            data: { base64, mime: 'image/jpeg' },
        });
        if (!res.url)
            throw new Error('上传失败');
        return res.url;
    }
    catch (err) {
        const msg = err.message || '';
        if (/太大|606001|上传失败|网络/i.test(msg)) {
            return (0, photo_upload_1.uploadPhotoPublic)(base64, token);
        }
        throw err;
    }
}
function isTempPath(path) {
    if (!path)
        return false;
    if (path.startsWith('/api/media/'))
        return false;
    if (path.startsWith('http://') || path.startsWith('https://')) {
        return path.indexOf('://tmp') >= 0;
    }
    return true;
}
Page({
    data: {
        editing: false,
        favoriteId: '',
        note: '',
        photos: [],
        /** 已上传封面（编辑态或本轮上传结果） */
        photoUrl: '',
        maxPhotos: locate_draft_1.MAX_LOCATE_PHOTOS,
        place: null,
        placeName: '',
        placeSub: '',
        saving: false,
    },
    onLoad(query) {
        if (query.fav) {
            this.setData({ editing: true, favoriteId: query.fav });
            this.loadEdit(query.fav);
            return;
        }
        this.hydrateFromDraft();
    },
    onShow() {
        // 从选点页返回时刷新美食地点；编辑已有记录不走草稿
        if (this.data.editing)
            return;
        this.hydratePlaceFromDraft();
    },
    hydrateFromDraft() {
        const draft = (0, locate_draft_1.readLocateDraft)();
        this.applyPlace(draft.place || null);
        this.setData({
            note: draft.note || '',
            photos: (draft.photos || []).slice(0, locate_draft_1.MAX_LOCATE_PHOTOS),
        });
    },
    hydratePlaceFromDraft() {
        const draft = (0, locate_draft_1.readLocateDraft)();
        if (draft.place)
            this.applyPlace(draft.place);
    },
    applyPlace(place) {
        const placeSub = place
            ? [place.distanceLabel, place.address].filter(Boolean).join(' · ')
            : '';
        this.setData({
            place,
            placeName: (place === null || place === void 0 ? void 0 : place.name) || '',
            placeSub,
        });
    },
    async loadEdit(favoriteId) {
        try {
            const row = await (0, api_1.request)(`/api/me/checkins/${favoriteId}`);
            const display = row.photoUrl
                ? `${config_1.API_BASE}${row.photoUrl}`
                : (0, media_1.shopImageSrc)(config_1.API_BASE, row.headImgProxy);
            const place = row.lat != null && row.lng != null
                ? {
                    id: 'edit',
                    name: row.name || '',
                    address: row.address || '',
                    lat: row.lat,
                    lng: row.lng,
                }
                : null;
            this.applyPlace(place);
            this.setData({
                note: '',
                photoUrl: row.photoUrl || '',
                photos: display ? [display] : [],
            });
        }
        catch (err) {
            wx.showToast({ title: err.message, icon: 'none' });
        }
    },
    onNote(e) {
        const note = e.detail.value || '';
        this.setData({ note });
        if (!this.data.editing)
            (0, locate_draft_1.writeLocateDraft)({ note });
    },
    async addPhoto() {
        const source = await new Promise((resolve) => {
            wx.showActionSheet({
                itemList: ['拍摄', '从相册选择'],
                success: (r) => resolve(r.tapIndex === 0 ? 'camera' : r.tapIndex === 1 ? 'album' : null),
                fail: () => resolve(null),
            });
        });
        if (!source)
            return;
        const more = await (0, locate_draft_1.chooseLocatePhotos)(source, this.data.photos.length);
        if (!more.length)
            return;
        const photos = [...this.data.photos, ...more].slice(0, locate_draft_1.MAX_LOCATE_PHOTOS);
        this.setData({ photos, photoUrl: '' });
        if (!this.data.editing)
            (0, locate_draft_1.writeLocateDraft)({ photos });
    },
    removePhoto(e) {
        const index = Number(e.currentTarget.dataset.index);
        if (!Number.isFinite(index))
            return;
        const photos = this.data.photos.filter((_, i) => i !== index);
        this.setData({ photos, photoUrl: '' });
        if (!this.data.editing)
            (0, locate_draft_1.writeLocateDraft)({ photos });
    },
    previewPhoto(e) {
        const src = String(e.currentTarget.dataset.src || '');
        if (!src)
            return;
        wx.previewImage({ current: src, urls: this.data.photos });
    },
    goPickPlace() {
        if (this.data.editing) {
            wx.showToast({ title: '改地点暂不支持，可删了重记', icon: 'none' });
            return;
        }
        (0, locate_draft_1.writeLocateDraft)({
            photos: this.data.photos,
            note: this.data.note,
            place: this.data.place,
        });
        wx.navigateTo({ url: '/pages/place-pick/place-pick' });
    },
    /**
     * 封面只用第一张：上传持久化后写入店铺头图。
     */
    async resolveCoverUrl() {
        if (this.data.photoUrl &&
            this.data.photoUrl.startsWith('/api/media/local/') &&
            this.data.photos[0] &&
            !isTempPath(this.data.photos[0])) {
            return this.data.photoUrl;
        }
        const first = this.data.photos[0];
        if (!first) {
            // 编辑态清空了图
            if (this.data.editing && !this.data.photos.length)
                return '';
            return undefined;
        }
        if (!isTempPath(first)) {
            if (first.startsWith('/api/media/local/'))
                return first;
            if (first.includes('/api/media/local/')) {
                const idx = first.indexOf('/api/media/local/');
                return first.slice(idx);
            }
            return this.data.photoUrl || undefined;
        }
        wx.showLoading({ title: '上传图片…', mask: true });
        try {
            const url = await uploadLocalPhoto(first);
            this.setData({ photoUrl: url });
            return url;
        }
        finally {
            wx.hideLoading();
        }
    },
    askNeedPlace() {
        return new Promise((resolve) => {
            wx.showModal({
                title: '还没选美食地点',
                content: '选家附近的店，或先记在你现在的位置。',
                confirmText: '去完善',
                confirmColor: '#ff6b4a',
                cancelText: '放弃记录',
                success: (r) => {
                    if (r.confirm)
                        resolve('fix');
                    else if (r.cancel)
                        resolve('abort');
                    else
                        resolve(null);
                },
                fail: () => resolve(null),
            });
        });
    },
    async onSave() {
        if (this.data.saving)
            return;
        if (!this.data.editing && !this.data.place) {
            const choice = await this.askNeedPlace();
            if (choice === 'fix') {
                this.goPickPlace();
                return;
            }
            if (choice === 'abort') {
                (0, locate_draft_1.clearLocateDraft)();
                wx.navigateBack({ fail: () => wx.reLaunch({ url: '/pages/my-shops/my-shops' }) });
            }
            return;
        }
        if (this.data.editing) {
            await this.saveEdit();
            return;
        }
        await this.saveNew();
    },
    async saveNew() {
        const place = this.data.place;
        if (!place || !Number.isFinite(place.lat) || !Number.isFinite(place.lng)) {
            wx.showToast({ title: '先选一个美食地点', icon: 'none' });
            return;
        }
        this.setData({ saving: true });
        try {
            const photoUrl = await this.resolveCoverUrl();
            await (0, api_1.request)('/api/me/checkins', {
                method: 'POST',
                data: {
                    name: place.name,
                    note: (this.data.note || '').trim() || undefined,
                    lat: place.lat,
                    lng: place.lng,
                    address: place.address || undefined,
                    photoUrl,
                    poiId: place.poiId || undefined,
                },
            });
            (0, locate_draft_1.clearLocateDraft)();
            wx.showToast({ title: '已记下' });
            setTimeout(() => {
                wx.reLaunch({ url: '/pages/my-shops/my-shops' });
            }, 400);
        }
        catch (err) {
            wx.showToast({ title: err.message, icon: 'none' });
        }
        finally {
            this.setData({ saving: false });
        }
    },
    async saveEdit() {
        var _a;
        const name = (this.data.placeName || '').trim();
        if (!name) {
            wx.showToast({ title: '店名不能为空', icon: 'none' });
            return;
        }
        this.setData({ saving: true });
        try {
            const photoUrl = await this.resolveCoverUrl();
            await (0, api_1.request)(`/api/me/checkins/${this.data.favoriteId}`, {
                method: 'PATCH',
                data: {
                    name,
                    address: ((_a = this.data.place) === null || _a === void 0 ? void 0 : _a.address) || undefined,
                    note: (this.data.note || '').trim() || undefined,
                    photoUrl: photoUrl !== undefined
                        ? photoUrl
                        : this.data.photos.length
                            ? undefined
                            : '',
                },
            });
            wx.showToast({ title: '已保存' });
            setTimeout(() => wx.navigateBack(), 400);
        }
        catch (err) {
            wx.showToast({ title: err.message, icon: 'none' });
        }
        finally {
            this.setData({ saving: false });
        }
    },
});
