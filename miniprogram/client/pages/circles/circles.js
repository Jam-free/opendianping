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
            const res = await (0, api_1.request)('/api/circles');
            this.setData({ items: res.items || [] });
        }
        catch (err) {
            wx.showToast({ title: err.message, icon: 'none' });
        }
    },
    async createCircle() {
        const res = await new Promise((resolve) => {
            wx.showModal({
                title: '创建收藏圈',
                editable: true,
                placeholderText: '给圈子起个名字',
                success: resolve,
                fail: () => resolve({ confirm: false, cancel: true, content: '' }),
            });
        });
        if (!res.confirm || !res.content)
            return;
        try {
            const circle = await (0, api_1.request)('/api/circles', {
                method: 'POST',
                data: { name: res.content },
            });
            wx.navigateTo({
                url: `/pages/circle-detail/circle-detail?id=${circle.id}`,
            });
        }
        catch (err) {
            wx.showToast({ title: err.message, icon: 'none' });
        }
    },
    openCircle(e) {
        const id = e.currentTarget.dataset.id;
        wx.navigateTo({ url: `/pages/circle-detail/circle-detail?id=${id}` });
    },
});
