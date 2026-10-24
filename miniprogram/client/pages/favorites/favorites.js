"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const api_1 = require("../../utils/api");
Page({
    data: {
        items: [],
    },
    onShow() {
        this.load();
    },
    async load() {
        try {
            const res = await (0, api_1.request)('/api/favorites');
            this.setData({ items: res.items || [] });
        }
        catch (err) {
            wx.showToast({ title: err.message, icon: 'none' });
        }
    },
    async toggleVis(e) {
        const id = e.currentTarget.dataset.id;
        const vis = e.currentTarget.dataset.vis;
        const next = vis === 'circles' ? 'private' : 'circles';
        try {
            await (0, api_1.request)(`/api/favorites/${id}`, {
                method: 'PATCH',
                data: { visibility: next },
            });
            this.load();
        }
        catch (err) {
            wx.showToast({ title: err.message, icon: 'none' });
        }
    },
    nav(e) {
        const index = Number(e.currentTarget.dataset.index);
        const item = this.data.items[index];
        if (!item)
            return;
        (0, api_1.openNavigation)({
            name: item.name,
            lat: item.lat,
            lng: item.lng,
            address: item.address,
        });
    },
    async remove(e) {
        const id = e.currentTarget.dataset.id;
        const ok = await new Promise((resolve) => {
            wx.showModal({
                title: '删除收藏？',
                success: (r) => resolve(Boolean(r.confirm)),
            });
        });
        if (!ok)
            return;
        try {
            await (0, api_1.request)(`/api/favorites/${id}`, { method: 'DELETE' });
            this.load();
        }
        catch (err) {
            wx.showToast({ title: err.message, icon: 'none' });
        }
    },
});
