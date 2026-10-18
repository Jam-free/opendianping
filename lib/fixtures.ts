import fs from 'fs';
import path from 'path';
import { DianpingAPIResponse } from './types';

export function loadFixture(filename: string): any {
  const uploadsDir = path.join(process.cwd(), 'uploads');
  const filepath = path.join(uploadsDir, filename);
  
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
    const filepath = path.join(process.cwd(), 'uploads', 'shop_1908397290_2380.html');
    if (fs.existsSync(filepath)) {
      return fs.readFileSync(filepath, 'utf-8');
    }
  }
  return null;
}
