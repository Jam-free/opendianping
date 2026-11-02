"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const api_1 = require("../../utils/api");
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
        listLabel: '附近',
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
    async bootstrap() {
        this.setData({ loading: true, locError: '' });
        try {
            const res = await new Promise((resolve, reject) => {
                wx.getLocation({ type: 'gcj02', success: resolve, fail: reject });
            });
            const lat = res.latitude;
            const lng = res.longitude;
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
                listLabel: '附近',
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
        var _a;
        const keyword = e.detail.value || '';
        this.setData({ keyword });
        if (this._searchTimer)
            clearTimeout(this._searchTimer);
        if (!keyword.trim()) {
            this.setData({
                items: this.data.nearbyItems,
                listLabel: '附近',
                selectedId: ((_a = this.data.nearbyItems[0]) === null || _a === void 0 ? void 0 : _a.id) || '',
            });
            const first = this.data.nearbyItems[0];
            if (first)
                this.syncMap(first);
            return;
        }
        this._searchTimer = setTimeout(() => this.runSearch(keyword.trim()), 350);
    },
    clearKeyword() {
        this.setData({
            keyword: '',
            items: this.data.nearbyItems,
            listLabel: '附近',
        });
    },
    onSearch() {
        const keyword = (this.data.keyword || '').trim();
        if (keyword)
            this.runSearch(keyword);
    },
    async runSearch(keyword) {
        this.setData({ listLabel: '搜索中…' });
        try {
            const qs = (0, api_1.buildQuery)({
                q: keyword,
                lat: this.data.lat || undefined,
                lng: this.data.lng || undefined,
            });
            const res = await (0, api_1.request)(`/api/geo/search?${qs}`);
            const here = this.data.nearbyItems.find((p) => p.isCurrent);
            const hits = (res.pois || []).map((p) => ({
                id: p.id,
                title: p.title,
                address: p.address || '',
                distanceLabel: formatDistance(p.distance),
                lat: p.lat != null ? p.lat : this.data.lat,
                lng: p.lng != null ? p.lng : this.data.lng,
                poiId: p.id,
            }));
            // 搜不到店时仍保留「我当前位置」，方便记成附近美食
            const items = here ? [...hits, here] : hits;
            const selected = items[0];
            this.setData({
                items,
                listLabel: hits.length ? '搜索结果' : '没搜到店',
                selectedId: (selected === null || selected === void 0 ? void 0 : selected.id) || '',
            });
            if (selected)
                this.syncMap(selected);
        }
        catch (err) {
            wx.showToast({ title: err.message || '搜索失败', icon: 'none' });
            this.setData({ listLabel: '搜索结果' });
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
        (0, locate_draft_1.writeLocateDraft)({ place });
        if (this.data.entry) {
            wx.redirectTo({ url: '/pages/locate-note/locate-note' });
            return;
        }
        wx.navigateBack();
    },
});
