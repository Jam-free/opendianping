"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const config_1 = require("../../utils/config");
const format_1 = require("../../utils/format");
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
        headImgProxyFull: '',
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
                headImgProxyFull: proxy ? `${config_1.API_BASE}${proxy}` : '',
            });
        },
    },
    methods: {
        onTap() {
            this.triggerEvent('tap', { shop: this.properties.shop });
        },
    },
});
