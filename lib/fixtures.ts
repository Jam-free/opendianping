import fs from 'fs';
import path from 'path';
import { DianpingAPIResponse } from './types';

/** 兼容从仓库根或 miniprogram/ 启动时的 cwd */
function uploadsDir(): string {
  const candidates = [
    path.join(process.cwd(), 'uploads'),
    path.join(process.cwd(), '..', 'uploads'),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(dir)) return dir;
  }
  return candidates[0];
}

export function loadFixture(filename: string): any {
  const filepath = path.join(uploadsDir(), filename);

  if (fs.existsSync(filepath)) {
    const content = fs.readFileSync(filepath, 'utf-8');
    return JSON.parse(content);
  }

  return null;
}

export function getFixtureAlbumData(albumId: number): {
  withVersion: DianpingAPIResponse | null;
  noVersion: DianpingAPIResponse | null;
} {
  if (albumId === 12498807) {
    return {
      withVersion: loadFixture('r0_8c06.json'),
      noVersion: loadFixture('ep_noversion_1494.json')
    };
  }

  return {
    withVersion: null,
    noVersion: null
  };
}

export function getFixtureShopHTML(shopId: number): string | null {
  if (shopId === 1908397290) {
    const filepath = path.join(uploadsDir(), 'shop_1908397290_2380.html');
    if (fs.existsSync(filepath)) {
      return fs.readFileSync(filepath, 'utf-8');
    }
  }
  return null;
}
