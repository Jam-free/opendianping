"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getActiveCircleId = getActiveCircleId;
exports.setActiveCircleId = setActiveCircleId;
const ACTIVE_CIRCLE_KEY = 'active_circle_id';
function getActiveCircleId() {
    return wx.getStorageSync(ACTIVE_CIRCLE_KEY) || '';
}
function setActiveCircleId(id) {
    wx.setStorageSync(ACTIVE_CIRCLE_KEY, id);
}
