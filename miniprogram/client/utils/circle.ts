const ACTIVE_CIRCLE_KEY = 'active_circle_id';

export function getActiveCircleId(): string {
  return (wx.getStorageSync(ACTIVE_CIRCLE_KEY) as string) || '';
}

export function setActiveCircleId(id: string): void {
  wx.setStorageSync(ACTIVE_CIRCLE_KEY, id);
}
