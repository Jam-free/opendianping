"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const api_1 = require("../../utils/api");
const location_1 = require("../../utils/location");
const locate_draft_1 = require("../../utils/locate-draft");
function formatDistance(meters) {
    if (meters == null || !Number.isFinite(meters))
        return '';
    if (meters < 100)
        return '100m内';
    if (meters < 1000)
        return `${Math.round(meters)}m`;
    return `${(meters / 1000).toFixed(1)}km`;
}
Page({
    data: {
        entry: false,
        loading: true,
        locError: '',
        keyword: '',
        listLabel: '地点',
        lat: 0,
        lng: 0,
        mapLat: 22.54,
        mapLng: 114.06,
        address: '',
        district: '',
        township: '',
        street: '',
        items: [],
        nearbyItems: [],
        selectedId: '',
        markers: [],
        saving: false,
    },
    _searchTimer: 0,
    onLoad(query) {
        this.setData({ entry: query.entry === '1' });
        this.bootstrap();
    },
    onUnload() {
        if (this._searchTimer)
            clearTimeout(this._searchTimer);
    },
    /**
     * 打开就列出地点，第一项永远是「我当前位置」。
     * 输入店名只是刷新下面的地点，不把当前位置拿掉。
     * 坐标用模糊位置：精确位置申请未通过，且不能和列表同时开。
     */
    async bootstrap() {
        this.setData({ loading: true, locError: '' });
        try {
            const loc = await (0, location_1.getUserLocation)();
            if (!loc) {
                this.setData({
                    loading: false,
                    locError: '无法获取位置，请在设置里打开位置权限后再试',
                });
                return;
            }
            const lat = loc.lat;
            const lng = loc.lng;
            this.setData({ lat, lng, mapLat: lat, mapLng: lng, loading: true });
            const qs = (0, api_1.buildQuery)({ lat, lng });
            const geo = await (0, api_1.request)(`/api/geo/reverse?${qs}`);
            const address = geo.address || '';
            const saveName = (0, locate_draft_1.nearbyFoodName)({
                address,
                district: geo.district,
                township: geo.township,
                street: geo.street,
            });
            const here = {
                id: '__here__',
                title: '我当前位置',
                address: address || '已定位',
                distanceLabel: '100m内',
                lat,
                lng,
                isCurrent: true,
                saveName,
            };
            const pois = (geo.pois || [])
                .filter((p) => p.title)
                .map((p) => ({
                id: p.id,
                title: p.title,
                address: p.address || address,
                distanceLabel: formatDistance(p.distance),
                lat: p.lat != null ? p.lat : lat,
                lng: p.lng != null ? p.lng : lng,
                poiId: p.id,
            }));
            const items = [here, ...pois];
            this.setData({
                loading: false,
                address,
                district: geo.district || '',
                township: geo.township || '',
                street: geo.street || '',
                items,
                nearbyItems: items,
                selectedId: here.id,
                listLabel: '地点',
            });
            this.syncMap(here);
        }
        catch (_a) {
            this.setData({
                loading: false,
                locError: '无法获取定位，请在设置里打开位置权限后再试',
            });
        }
    },
    syncMap(item) {
        this.setData({
            mapLat: item.lat,
            mapLng: item.lng,
            markers: [
                {
                    id: 1,
                    latitude: item.lat,
                    longitude: item.lng,
                    width: 24,
                    height: 24,
                },
            ],
        });
    },
    onPick(e) {
        const id = String(e.currentTarget.dataset.id || '');
        const item = this.data.items.find((p) => p.id === id);
        if (!item)
            return;
        this.setData({ selectedId: id });
        this.syncMap(item);
    },
    onKeyword(e) {
        const keyword = e.detail.value || '';
        this.setData({ keyword });
        if (this._searchTimer)
            clearTimeout(this._searchTimer);
        if (!keyword.trim()) {
            const items = this.data.nearbyItems;
            const selectedId = this.keepOrHere(items);
            this.setData({ items, listLabel: '地点', selectedId });
            const picked = items.find((p) => p.id === selectedId);
            if (picked)
                this.syncMap(picked);
            return;
        }
        this._searchTimer = setTimeout(() => this.runSearch(keyword.trim()), 350);
    },
    /** 当前位置始终留在列表里，方便随时改选。 */
    withHere(hits) {
        const here = this.data.nearbyItems.find((p) => p.isCurrent);
        const rest = hits.filter((p) => !p.isCurrent && p.id !== '__here__');
        return here ? [here, ...rest] : rest;
    },
    keepOrHere(items) {
        var _a, _b;
        const still = items.find((p) => p.id === this.data.selectedId);
        if (still)
            return still.id;
        return ((_a = items.find((p) => p.isCurrent)) === null || _a === void 0 ? void 0 : _a.id) || ((_b = items[0]) === null || _b === void 0 ? void 0 : _b.id) || '';
    },
    clearKeyword() {
        const items = this.data.nearbyItems;
        const selectedId = this.keepOrHere(items);
        this.setData({ keyword: '', items, listLabel: '地点', selectedId });
        const picked = items.find((p) => p.id === selectedId);
        if (picked)
            this.syncMap(picked);
    },
    onSearch() {
        const keyword = (this.data.keyword || '').trim();
        if (keyword)
            this.runSearch(keyword);
    },
    async runSearch(keyword) {
        this.setData({ listLabel: '地点' });
        try {
            const qs = (0, api_1.buildQuery)({
                q: keyword,
                lat: this.data.lat || undefined,
                lng: this.data.lng || undefined,
            });
            const res = await (0, api_1.request)(`/api/geo/search?${qs}`);
            const hits = (res.pois || []).map((p) => ({
                id: p.id,
                title: p.title,
                address: p.address || '',
                distanceLabel: formatDistance(p.distance),
                lat: p.lat != null ? p.lat : this.data.lat,
                lng: p.lng != null ? p.lng : this.data.lng,
                poiId: p.id,
            }));
            // 输入店名只刷新候选；当前位置永远留在最上面，由用户自己点选。
            const items = this.withHere(hits);
            const selectedId = this.keepOrHere(items);
            this.setData({ items, listLabel: '地点', selectedId });
            const picked = items.find((p) => p.id === selectedId);
            if (picked)
                this.syncMap(picked);
        }
        catch (err) {
            wx.showToast({ title: err.message || '没有刷新地点', icon: 'none' });
            this.setData({ listLabel: '地点' });
        }
    },
    toLocatePlace(item) {
        return {
            id: item.id,
            name: item.isCurrent ? item.saveName || (0, locate_draft_1.nearbyFoodName)({}) : item.title,
            address: item.address,
            lat: item.lat,
            lng: item.lng,
            distanceLabel: item.distanceLabel,
            poiId: item.isCurrent ? undefined : item.poiId,
            isCurrent: Boolean(item.isCurrent),
        };
    },
    onDone() {
        const item = this.data.items.find((p) => p.id === this.data.selectedId);
        if (!item) {
            wx.showToast({ title: '先选一个地点', icon: 'none' });
            return;
        }
        if (!Number.isFinite(item.lat) || !Number.isFinite(item.lng)) {
            wx.showToast({ title: '这个地点没有坐标', icon: 'none' });
            return;
        }
        const place = this.toLocatePlace(item);
        const typed = (this.data.keyword || '').trim();
        // 手写了店名，又选的是当前位置：店名用输入的字，位置仍是脚下这一点。
        if (item.isCurrent && typed) {
            place.name = typed;
        }
        (0, locate_draft_1.writeLocateDraft)({ place });
        if (this.data.entry) {
            wx.redirectTo({ url: '/pages/locate-note/locate-note' });
            return;
        }
        wx.navigateBack();
    },
});
