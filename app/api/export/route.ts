import { NextRequest, NextResponse } from 'next/server';
import { getShopsByAlbum } from '@/lib/db';
import * as Papa from 'papaparse';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const albumId = searchParams.get('albumId');
    const format = searchParams.get('format') || 'json';
    
    if (!albumId) {
      return NextResponse.json({ error: '请提供专辑ID' }, { status: 400 });
    }
    
    const shops = getShopsByAlbum(parseInt(albumId));
    
    if (format === 'csv') {
      const csvData = shops.map(shop => ({
        name: shop.title,
        shopId: shop.shopId,
        uuid: shop.uuid,
        city: shop.city,
        category_area: `${shop.category} ${shop.region}`,
        avg_price: shop.priceNumber,
        stars: '★'.repeat(Math.floor(shop.star / 10)) + (shop.star % 10 >= 5 ? '☆' : ''),
        shopPower: shop.star,
        reviews: shop.reviewCount,
        tags: shop.tags.join('|'),
        cityid: shop.cityId,
        url: shop.webUrl,
        lat: shop.lat,
        lng: shop.lng,
        region: shop.region,
        rec_dishes: shop.recDishes.join('|'),
        fiveScore: shop.fiveScore,
        rec_reason: shop.recReason
      }));
      
      const csv = Papa.unparse(csvData, {
        quotes: true,
        delimiter: ',',
        header: true
      });
      
      return new NextResponse(csv, {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="shops_${albumId}.csv"`
        }
      });
    } else {
      return NextResponse.json(shops, {
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Disposition': `attachment; filename="shops_${albumId}.json"`
        }
      });
    }
  } catch (error: any) {
    console.error('Export error:', error);
    return NextResponse.json(
      { error: error.message || '导出失败' },
      { status: 500 }
    );
  }
}
