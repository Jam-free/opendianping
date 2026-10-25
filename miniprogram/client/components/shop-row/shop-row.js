"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const config_1 = require("../../utils/config");
const format_1 = require("../../utils/format");
const media_1 = require("../../utils/media");
Component({
    properties: {
        shop: { type: Object, value: {} },
        /** 覆盖推荐行文案，如「我导入」「来自小王」 */
        sourceTag: { type: String, value: '' },
    },
    data: {
        dist: { main: '', unit: '', na: true },
        metaLine: '',
        previewAvatars: [],
        displaySrc: media_1.SHOP_PLACEHOLDER,
    },
    observers: {
        shop(shop) {
            if (!shop)
                return;
            const dist = (0, format_1.splitDistance)(shop.distanceLabel);
            const parts = [shop.category, shop.district].filter(Boolean);
            const preview = (shop.collectors || []).slice(0, 3);
            const proxy = shop.headImgProxy;
            this.setData({
                dist,
                metaLine: parts.join(' · '),
                previewAvatars: preview.map((c) => ({
                    userId: c.userId,
                    avatar: c.avatar || '',
                    initial: (0, format_1.avatarInitial)(c.nickname),
                })),
                // 无 headImgProxy 也直接用兜底，不留空灰块
                displaySrc: (0, media_1.shopImageSrc)(config_1.API_BASE, proxy),
            });
        },
    },
    methods: {
        onTap() {
            this.triggerEvent('tap', { shop: this.properties.shop });
        },
        /** 代理/CDN 失败时切本地兜底，只切一次避免循环 */
        onImgError() {
            if (this.data.displaySrc === media_1.SHOP_PLACEHOLDER)
                return;
            this.setData({ displaySrc: media_1.SHOP_PLACEHOLDER });
        },
    },
});
