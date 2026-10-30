"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const api_1 = require("../../utils/api");
const circle_1 = require("../../utils/circle");
Page({
    data: {
        circleId: '',
        token: '',
        info: {},
        joining: false,
    },
    onLoad(query) {
        const circleId = query.c || '';
        const token = query.t || '';
        this.setData({ circleId, token });
        if (circleId)
            this.loadPreview();
    },
    async loadPreview() {
        try {
            const info = await (0, api_1.request)(`/api/circles/${this.data.circleId}/preview`);
            this.setData({ info });
        }
        catch (err) {
            wx.showToast({ title: err.message, icon: 'none' });
        }
    },
    async onJoin() {
        this.setData({ joining: true });
        try {
            await (0, api_1.request)(`/api/circles/${this.data.circleId}/join`, {
                method: 'POST',
                data: { token: this.data.token },
            });
            (0, circle_1.setActiveCircleId)(this.data.circleId);
            wx.showToast({ title: '已加入' });
            setTimeout(() => {
                wx.reLaunch({ url: '/pages/my-shops/my-shops?panel=1' });
            }, 400);
        }
        catch (err) {
            this.setData({ joining: false });
            wx.showModal({
                title: '无法加入',
                content: err.message || '邀请可能已过期或已重置',
            });
        }
    },
});
