"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.selectShareCircle = selectShareCircle;
function selectShareCircle(circles, currentCircleId) {
    // 过滤出可分享的圈子（非个人空间，有邀请令牌）
    const shareable = circles.filter((c) => !c.is_personal &&
        c.invite_token &&
        c.token_expires_at);
    if (shareable.length === 0) {
        return null;
    }
    // 如果提供了当前圈子 ID，且该圈子可分享，优先使用
    if (currentCircleId) {
        const current = shareable.find((c) => c.id === currentCircleId);
        if (current) {
            return {
                id: current.id,
                name: current.name,
                inviteToken: current.invite_token,
                tokenExpiresAt: current.token_expires_at,
            };
        }
    }
    // 否则选择最早加入的圈子
    // 按 joined_at 升序，circle.id 作为 tie-break
    const sorted = [...shareable].sort((a, b) => {
        if (a.joined_at && b.joined_at) {
            const timeCompare = a.joined_at.localeCompare(b.joined_at);
            if (timeCompare !== 0)
                return timeCompare;
        }
        // tie-break: circle id
        return a.id.localeCompare(b.id);
    });
    const selected = sorted[0];
    return {
        id: selected.id,
        name: selected.name,
        inviteToken: selected.invite_token,
        tokenExpiresAt: selected.token_expires_at,
    };
}
