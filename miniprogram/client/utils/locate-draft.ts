/**
 * 记美食草稿：入口三选一 → 白板/选点之间传递照片与美食地点。
 * 存在 storage，避免临时路径塞进 URL。
 */

export const MAX_LOCATE_PHOTOS = 3;
/** 单张原图上限；再大压缩也费事，直接请用户换一张 */
export const MAX_PHOTO_PICK_BYTES = 15 * 1024 * 1024;

export type LocatePlace = {
  /** 列表项 id；我当前位置用 __here__ */
  id: string;
  /** 写入店铺的名字（当前位置会变成「XXX附近的美食」） */
  name: string;
  address: string;
  lat: number;
  lng: number;
  distanceLabel?: string;
  /** 地图 POI id，便于详情对齐 */
  poiId?: string;
  /** 是否「我当前位置」 */
  isCurrent?: boolean;
};

export type LocateDraft = {
  photos: string[];
  place?: LocatePlace | null;
  note?: string;
};

const KEY = 'locate_draft_v1';

export function readLocateDraft(): LocateDraft {
  try {
    const raw = wx.getStorageSync(KEY) as LocateDraft | undefined;
    if (!raw || typeof raw !== 'object') return { photos: [] };
    return {
      photos: Array.isArray(raw.photos) ? raw.photos.filter(Boolean) : [],
      place: raw.place || null,
      note: raw.note || '',
    };
  } catch {
    return { photos: [] };
  }
}

export function writeLocateDraft(patch: Partial<LocateDraft>): LocateDraft {
  const cur = readLocateDraft();
  const next: LocateDraft = {
    photos: patch.photos !== undefined ? patch.photos : cur.photos,
    place: patch.place !== undefined ? patch.place : cur.place,
    note: patch.note !== undefined ? patch.note : cur.note,
  };
  wx.setStorageSync(KEY, next);
  return next;
}

export function clearLocateDraft() {
  try {
    wx.removeStorageSync(KEY);
  } catch {
    /* ignore */
  }
}

/** 从地址里抽一个短地名，拼「XXX附近的美食」 */
export function nearbyFoodName(parts: {
  address?: string;
  district?: string;
  township?: string;
  street?: string;
}): string {
  const short =
    (parts.township || '').trim() ||
    (parts.street || '').trim() ||
    (parts.district || '').trim() ||
    shortFromAddress(parts.address || '');
  return `${short || '这里'}附近的美食`;
}

function shortFromAddress(address: string): string {
  if (!address) return '';
  const tail = address
    .split(/省|市|区|县|街道|镇/)
    .map((s) => s.trim())
    .filter(Boolean);
  const last = tail[tail.length - 1] || address;
  return last.slice(0, 16);
}

function fileSize(path: string): number {
  try {
    const st = wx.getFileSystemManager().statSync(path) as { size?: number };
    return Number(st?.size) || 0;
  } catch {
    return 0;
  }
}

/**
 * 选图：拍摄或相册。
 * 边界：最多 MAX_LOCATE_PHOTOS 张；单张超 15MB 跳过并提示。
 */
export function chooseLocatePhotos(
  source: 'camera' | 'album',
  already = 0
): Promise<string[]> {
  const remain = Math.max(0, MAX_LOCATE_PHOTOS - already);
  if (remain <= 0) {
    wx.showToast({ title: `最多 ${MAX_LOCATE_PHOTOS} 张图`, icon: 'none' });
    return Promise.resolve([]);
  }

  return new Promise((resolve) => {
    wx.chooseMedia({
      count: remain,
      mediaType: ['image'],
      sourceType: source === 'camera' ? ['camera'] : ['album'],
      sizeType: ['compressed'],
      success: (res: {
        tempFiles?: Array<{ tempFilePath?: string; size?: number }>;
      }) => {
        const files = res?.tempFiles || [];
        const ok: string[] = [];
        let skippedBig = 0;
        for (const f of files) {
          const path = f?.tempFilePath || '';
          if (!path) continue;
          const size = Number(f.size) || fileSize(path);
          if (size > MAX_PHOTO_PICK_BYTES) {
            skippedBig += 1;
            continue;
          }
          ok.push(path);
        }
        if (skippedBig) {
          wx.showToast({
            title: '有图片太大，已跳过',
            icon: 'none',
          });
        }
        if (!ok.length && !skippedBig) {
          wx.showToast({ title: '没有选到图片', icon: 'none' });
        }
        resolve(ok.slice(0, remain));
      },
      fail: () => resolve([]),
    });
  });
}

/**
 * 底栏「记美食」：拍摄 / 相册 / 记录地点。
 */
export function startLocateFlow() {
  wx.showActionSheet({
    itemList: ['拍摄', '从相册选择', '记录地点'],
    success: async (tap) => {
      const idx = tap.tapIndex;
      if (idx === 0 || idx === 1) {
        const photos = await chooseLocatePhotos(
          idx === 0 ? 'camera' : 'album',
          0
        );
        // 取消选图 / 全部被跳过：不进白板
        if (!photos.length) return;
        clearLocateDraft();
        writeLocateDraft({ photos, place: null, note: '' });
        wx.navigateTo({ url: '/pages/locate-note/locate-note' });
        return;
      }
      if (idx === 2) {
        clearLocateDraft();
        writeLocateDraft({ photos: [], place: null, note: '' });
        wx.navigateTo({ url: '/pages/place-pick/place-pick?entry=1' });
      }
    },
  });
}
