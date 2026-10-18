import { NextRequest, NextResponse } from 'next/server';
import { parseAlbumUrl, fetchAlbumData } from '@/lib/fetcher';
import { saveAlbum, saveShop } from '@/lib/db';

export async function POST(request: NextRequest) {
  try {
    const { url, useFixtures } = await request.json();
    
    if (!url) {
      return NextResponse.json({ error: '请提供专辑链接' }, { status: 400 });
    }
    
    const albumId = parseAlbumUrl(url);
    if (!albumId) {
      return NextResponse.json({ error: '无法解析专辑ID' }, { status: 400 });
    }
    
    const { album, shops } = await fetchAlbumData(albumId, useFixtures);
    
    saveAlbum(album);
    for (const shop of shops) {
      saveShop(shop);
    }
    
    return NextResponse.json({
      success: true,
      albumId,
      shopCount: shops.length
    });
  } catch (error: any) {
    console.error('Import error:', error);
    return NextResponse.json(
      { error: error.message || '导入失败' },
      { status: 500 }
    );
  }
}
