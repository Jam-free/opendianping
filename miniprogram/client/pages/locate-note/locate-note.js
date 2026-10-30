"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const api_1 = require("../../utils/api");
const config_1 = require("../../utils/config");
const media_1 = require("../../utils/media");
/**
 * 把本地临时图读成 base64 上传，换成长住路径。
 * 设计决策：走 JSON+base64，避免云托管 callContainer 对 multipart 的坑。
 */
async function uploadLocalPhoto(tempPath) {
    const fs = wx.getFileSystemManager();
    const base64 = fs.readFileSync(tempPath, 'base64');
    const res = await (0, api_1.request)('/api/me/photos', {
        method: 'POST',
        data: { base64, mime: 'image/jpeg' },
    });
    if (!res.url)
        throw new Error('上传失败');
    return res.url;
}
function formatPoiDistance(meters) {
    if (meters == null || !Number.isFinite(meters))
        return '';
    if (meters < 1000)
        return `${Math.round(meters)}m`;
    return `${(meters / 1000).toFixed(1)}km`;
}
Page({
    data: {
        editing: false,
        favoriteId: '',
        name: '',
        note: '',
        lat: 0,
        lng: 0,
        latLabel: '',
        lngLabel: '',
        address: '',
        locReady: false,
        locError: '',
        photoPath: '',
        /** 已上传的持久路径 /api/media/local/... */
        photoUrl: '',
        pois: [],
        selectedPoiId: '',
        saving: false,
    },
    onLoad(query) {
        if (query.name) {
            this.setData({ name: decodeURIComponent(query.name) });
        }
        if (query.fav) {
            this.setData({ editing: true, favoriteId: query.fav });
            this.loadEdit(query.fav);
            return;
        }
        this.refreshLoc();
    },
    async loadEdit(favoriteId) {
        try {
            const row = await (0, api_1.request)(`/api/me/checkins/${favoriteId}`);
            const display = row.photoUrl
                ? `${config_1.API_BASE}${row.photoUrl}`
                : (0, media_1.shopImageSrc)(config_1.API_BASE, row.headImgProxy);
            this.setData({
                name: row.name || '',
                note: '',
                address: row.address || '',
                lat: row.lat || 0,
                lng: row.lng || 0,
                latLabel: row.lat != null ? row.lat.toFixed(5) : '',
                lngLabel: row.lng != null ? row.lng.toFixed(5) : '',
                locReady: true,
                photoUrl: row.photoUrl || '',
                photoPath: row.photoUrl || row.headImgProxy ? display : '',
            });
        }
        catch (err) {
            wx.showToast({ title: err.message, icon: 'none' });
        }
    },
    onName(e) {
        this.setData({ name: e.detail.value, selectedPoiId: '' });
    },
    onNote(e) {
        this.setData({ note: e.detail.value });
    },
    pickPoi(e) {
        const id = String(e.currentTarget.dataset.id || '');
        const poi = this.data.pois.find((p) => p.id === id);
        if (!poi)
            return;
        this.setData({
            selectedPoiId: id,
            name: poi.title,
            address: poi.address || this.data.address,
            lat: poi.lat != null ? poi.lat : this.data.lat,
            lng: poi.lng != null ? poi.lng : this.data.lng,
            latLabel: poi.lat != null ? poi.lat.toFixed(5) : this.data.latLabel,
            lngLabel: poi.lng != null ? poi.lng.toFixed(5) : this.data.lngLabel,
        });
    },
    async refreshLoc() {
        this.setData({
            locReady: false,
            locError: '',
            address: '',
            pois: [],
            selectedPoiId: '',
        });
        try {
            const res = await new Promise((resolve, reject) => {
                wx.getLocation({ type: 'gcj02', success: resolve, fail: reject });
            });
            const lat = res.latitude;
            const lng = res.longitude;
            this.setData({
                lat,
                lng,
                latLabel: lat.toFixed(5),
                lngLabel: lng.toFixed(5),
                locReady: true,
                address: '正在解析地址…',
            });
            try {
                const qs = (0, api_1.buildQuery)({ lat, lng });
                const geo = await (0, api_1.request)(`/api/geo/reverse?${qs}`);
                const address = geo.address || '';
                const pois = (geo.pois || []).map((p) => (Object.assign(Object.assign({}, p), { distanceLabel: formatPoiDistance(p.distance) })));
                const patch = { address, pois };
                if (!this.data.name.trim() && pois[0]) {
                    patch.name = pois[0].title;
                    patch.selectedPoiId = pois[0].id;
                    if (pois[0].address)
                        patch.address = pois[0].address;
                    if (pois[0].lat != null) {
                        patch.lat = pois[0].lat;
                        patch.latLabel = pois[0].lat.toFixed(5);
                    }
                    if (pois[0].lng != null) {
                        patch.lng = pois[0].lng;
                        patch.lngLabel = pois[0].lng.toFixed(5);
                    }
                }
                else if (!this.data.name.trim() && address) {
                    const short = geo.district ||
                        address.split(/省|市|区|县/).filter(Boolean).pop() ||
                        address.slice(0, 20);
                    patch.name = String(short).trim();
                }
                this.setData(patch);
            }
            catch (_a) {
                this.setData({
                    address: `已定位（${lat.toFixed(4)}, ${lng.toFixed(4)}）`,
                });
            }
        }
        catch (_b) {
            this.setData({
                locError: '无法获取定位，请在设置中开启位置权限后重试',
            });
        }
    },
    pickPhoto() {
        wx.chooseMedia({
            count: 1,
            mediaType: ['image'],
            sourceType: ['album', 'camera'],
            success: (res) => {
                var _a, _b;
                const path = ((_b = (_a = res === null || res === void 0 ? void 0 : res.tempFiles) === null || _a === void 0 ? void 0 : _a[0]) === null || _b === void 0 ? void 0 : _b.tempFilePath) || '';
                if (path) {
                    this.setData({ photoPath: path, photoUrl: '' });
                }
            },
        });
    },
    clearPhoto() {
        this.setData({ photoPath: '', photoUrl: '' });
    },
    previewPhoto() {
        if (!this.data.photoPath)
            return;
        wx.previewImage({ urls: [this.data.photoPath] });
    },
    async resolvePhotoUrl() {
        // 已有持久路径且没换新临时图
        if (this.data.photoUrl &&
            this.data.photoUrl.startsWith('/api/media/local/')) {
            return this.data.photoUrl;
        }
        const path = this.data.photoPath;
        if (!path)
            return undefined;
        // 本地临时文件才上传
        if (path.startsWith('wxfile://') ||
            path.startsWith('http://tmp') ||
            path.indexOf('://tmp') >= 0 ||
            !path.startsWith('http')) {
            wx.showLoading({ title: '上传图片…', mask: true });
            try {
                const url = await uploadLocalPhoto(path);
                this.setData({ photoUrl: url });
                return url;
            }
            finally {
                wx.hideLoading();
            }
        }
        return undefined;
    },
    async onSave() {
        if (!this.data.editing && !this.data.locReady) {
            wx.showToast({ title: '请先获取定位', icon: 'none' });
            return;
        }
        const name = this.data.name.trim() ||
            this.data.address ||
            `记下的位置 ${this.data.latLabel},${this.data.lngLabel}`;
        this.setData({ saving: true });
        try {
            const photoUrl = await this.resolvePhotoUrl();
            if (this.data.editing) {
                await (0, api_1.request)(`/api/me/checkins/${this.data.favoriteId}`, {
                    method: 'PATCH',
                    data: {
                        name,
                        address: this.data.address || undefined,
                        note: this.data.note || undefined,
                        photoUrl: photoUrl !== undefined
                            ? photoUrl
                            : this.data.photoPath
                                ? undefined
                                : '',
                    },
                });
                wx.showToast({ title: '已保存' });
                setTimeout(() => wx.navigateBack(), 400);
                return;
            }
            await (0, api_1.request)('/api/me/checkins', {
                method: 'POST',
                data: {
                    name,
                    note: this.data.note,
                    lat: this.data.lat,
                    lng: this.data.lng,
                    address: this.data.address || undefined,
                    photoUrl,
                    poiId: this.data.selectedPoiId || undefined,
                },
            });
            wx.showToast({ title: '已记下' });
            setTimeout(() => {
                wx.switchTab({ url: '/pages/my-shops/my-shops' });
            }, 400);
        }
        catch (err) {
            wx.showToast({ title: err.message, icon: 'none' });
        }
        finally {
            this.setData({ saving: false });
        }
    },
});
