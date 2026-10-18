import { NextRequest, NextResponse } from 'next/server';
import { getShopsByAlbum, listShops, getAlbum } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const albumId = searchParams.get('albumId');
    const minPrice = searchParams.get('minPrice');
    const maxPrice = searchParams.get('maxPrice');
    const minScore = searchParams.get('minScore');
    const category = searchParams.get('category');
    
    let shops;
    
    if (albumId) {
      shops = getShopsByAlbum(parseInt(albumId));
    } else {
      const filters: any = {};
      if (minPrice) filters.minPrice = parseFloat(minPrice);
      if (maxPrice) filters.maxPrice = parseFloat(maxPrice);
      if (minScore) filters.minScore = parseFloat(minScore);
      if (category) filters.category = category;
      
      shops = listShops(filters);
    }
    
    const album = albumId ? getAlbum(parseInt(albumId)) : null;
    
    return NextResponse.json({
      success: true,
      album,
      shops
    });
  } catch (error: any) {
    console.error('Query error:', error);
    return NextResponse.json(
      { error: error.message || '查询失败' },
      { status: 500 }
    );
  }
}
