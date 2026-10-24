"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.splitDistance = splitDistance;
exports.avatarInitial = avatarInitial;
/** 把后端 distanceLabel 拆成瑞士风大字 + 单位 */
function splitDistance(label) {
    if (!label) {
        return { main: '—', unit: '', na: true };
    }
    const m = label.match(/^([\d.]+)\s*(m|km)$/i);
    if (m) {
        return { main: m[1], unit: m[2].toLowerCase(), na: false };
    }
    return { main: label, unit: '', na: true };
}
function avatarInitial(nickname) {
    const n = (nickname || '').trim();
    return n ? n.slice(0, 1) : '?';
}
