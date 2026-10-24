"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const api_1 = require("../../utils/api");
Page({
    data: {
        step: 'input',
        text: '',
        loading: false,
        saving: false,
        previewId: '',
        shops: [],
        message: '',
        selectedCount: 0,
        result: { success: 0, duplicate: 0, failed: 0, batchId: '' },
    },
    onText(e) {
        this.setData({ text: e.detail.value });
    },
    async onParse() {
        if (!this.data.text.trim()) {
            wx.showToast({ title: '请粘贴链接', icon: 'none' });
            return;
        }
        this.setData({ loading: true });
        try {
            const res = await (0, api_1.request)('/api/import/parse', {
                method: 'POST',
                data: {
                    text: this.data.text,
                    useFixtures: false,
                },
            });
            const shops = (res.shops || []).map((s) => (Object.assign(Object.assign({}, s), { checked: true })));
            if (!shops.length) {
                this.setData({ loading: false });
                wx.showModal({
                    title: '没有解析到店铺',
                    content: res.message || '请确认链接是公开专辑，或换一条再试',
                });
                return;
            }
            this.setData({
                step: 'preview',
                previewId: res.previewId,
                shops,
                message: res.message || '',
                selectedCount: shops.length,
                loading: false,
            });
        }
        catch (err) {
            this.setData({ loading: false });
            wx.showModal({
                title: '解析失败',
                content: err.message || '请检查链接是否公开有效',
                confirmText: '重试',
            });
        }
    },
    toggle(e) {
        const index = Number(e.currentTarget.dataset.index);
        const key = `shops[${index}].checked`;
        const checked = !this.data.shops[index].checked;
        this.setData({ [key]: checked });
        this.refreshCount();
    },
    selectAll() {
        const shops = this.data.shops.map((s) => (Object.assign(Object.assign({}, s), { checked: true })));
        this.setData({ shops, selectedCount: shops.length });
    },
    selectNone() {
        const shops = this.data.shops.map((s) => (Object.assign(Object.assign({}, s), { checked: false })));
        this.setData({ shops, selectedCount: 0 });
    },
    refreshCount() {
        const selectedCount = this.data.shops.filter((s) => s.checked).length;
        this.setData({ selectedCount });
    },
    async onSave() {
        const selectedIndexes = this.data.shops
            .map((s, i) => (s.checked ? i : -1))
            .filter((i) => i >= 0);
        if (!selectedIndexes.length) {
            wx.showToast({ title: '请先勾选店铺', icon: 'none' });
            return;
        }
        this.setData({ saving: true });
        try {
            const res = await (0, api_1.request)('/api/import/save', {
                method: 'POST',
                data: {
                    previewId: this.data.previewId,
                    selectedIndexes,
                    visibility: 'circles',
                },
            });
            this.setData({
                step: 'result',
                saving: false,
                result: {
                    success: res.success,
                    duplicate: res.duplicate,
                    failed: res.failed,
                    batchId: res.batchId,
                },
            });
        }
        catch (err) {
            this.setData({ saving: false });
            wx.showToast({ title: err.message, icon: 'none' });
        }
    },
    goMyShops() {
        wx.switchTab({ url: '/pages/my-shops/my-shops' });
    },
    reset() {
        this.setData({
            step: 'input',
            previewId: '',
            shops: [],
            message: '',
            selectedCount: 0,
            text: '',
        });
    },
});
