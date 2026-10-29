"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const api_1 = require("../../utils/api");
const circle_1 = require("../../utils/circle");
Page({
    data: {
        circle: null,
        inviteToken: '',
    },
    onShow() {
        wx.showShareMenu({ withShareTicket: true, menus: ['shareAppMessage'] });
        this.load();
    },
    async load() {
        try {
            const res = await (0, api_1.request)('/api/circles');
            const items = res.items || [];
            let activeId = (0, circle_1.getActiveCircleId)();
            let circle = items.find((c) => c.id === activeId) || items[0];
            if (circle && !activeId) {
                (0, circle_1.setActiveCircleId)(circle.id);
            }
            const token = (circle === null || circle === void 0 ? void 0 : circle.invite_token) || '';
            this.setData({ circle, inviteToken: token });
        }
        catch (err) {
            wx.showToast({ title: err.message, icon: 'none' });
        }
    },
    onShareAppMessage() {
        const { circle, inviteToken } = this.data;
        if (!circle || !inviteToken) {
            return { title: '我和我爱吃的朋友们 · 一起收藏好店', path: '/pages/index/index' };
        }
        return {
            title: `邀请你加入「${circle.name}」`,
            path: `/pages/join/join?c=${circle.id}&t=${inviteToken}`,
        };
    },
    async createCircle() {
        const res = await new Promise((resolve) => {
            wx.showModal({
                title: '创建收藏圈',
                editable: true,
                placeholderText: '圈子名称',
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
            (0, circle_1.setActiveCircleId)(circle.id);
            this.setData({ circle, inviteToken: circle.inviteToken });
        }
        catch (err) {
            wx.showToast({ title: err.message, icon: 'none' });
        }
    },
});
