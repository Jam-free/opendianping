"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * 主页悬浮底栏：导入 / 连接AI / 记美食。
 * 产品：两主页共用同一入口，不依赖系统 tabBar。
 */
const locate_draft_1 = require("../../utils/locate-draft");
Component({
    methods: {
        onImport() {
            wx.navigateTo({ url: '/pages/import/import' });
        },
        onConnectAi() {
            wx.navigateTo({ url: '/pages/connect-ai/connect-ai' });
        },
        onLocate() {
            (0, locate_draft_1.startLocateFlow)();
        },
    },
});
