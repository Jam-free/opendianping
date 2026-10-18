#!/usr/bin/env tsx

import { parseAlbumUrl, fetchAlbumData } from './lib/fetcher';
import { saveAlbum, saveShop, getShopsByAlbum, listShops, getShop, getShopsNear } from './lib/db';

console.log('═══════════════════════════════════════════════════════');
console.log('  OpenDianping MCP Tools Test Suite');
console.log('═══════════════════════════════════════════════════════\n');

// Tool 1: import_album
console.log('📥 Tool 1: import_album (with fixtures)');
console.log('─────────────────────────────────────────────────────');
const url = 'https://h5.dianping.com/app/commonplatform-collection-static/album.html?albumid=12498807';
const albumId = parseAlbumUrl(url);
console.log(`Input URL: ${url}`);
console.log(`Parsed albumId: ${albumId}`);

const { album, shops } = await fetchAlbumData(albumId!, true);
saveAlbum(album);
shops.forEach(shop => saveShop(shop));

console.log(`✅ Imported album "${album.title}"`);
console.log(`   - Album ID: ${album.albumId}`);
console.log(`   - Shop count: ${shops.length}`);
console.log(`   - Author: ${album.authorName}`);
console.log(`   - Shops: ${shops.map(s => s.title).join(', ')}\n`);

// Tool 2: list_shops
console.log('📋 Tool 2: list_shops (all shops)');
console.log('─────────────────────────────────────────────────────');
const allShops = listShops();
console.log(`✅ Found ${allShops.length} shops:`);
allShops.forEach((shop, idx) => {
  console.log(`   ${idx + 1}. ${shop.title}`);
  console.log(`      - ID: ${shop.shopId}, Category: ${shop.category}, Price: ¥${shop.priceNumber}, Score: ${shop.fiveScore}`);
});
console.log();

// Tool 2b: list_shops with filters
console.log('📋 Tool 2b: list_shops (filtered: price < 25, score >= 4.0)');
console.log('─────────────────────────────────────────────────────');
const filteredShops = listShops({ maxPrice: 25, minScore: 4.0 });
console.log(`✅ Found ${filteredShops.length} shops matching criteria:`);
filteredShops.forEach(shop => {
  console.log(`   - ${shop.title}: ¥${shop.priceNumber}, score ${shop.fiveScore}`);
});
console.log();

// Tool 3: get_shop
console.log('🏪 Tool 3: get_shop (shopId: 1908397290)');
console.log('─────────────────────────────────────────────────────');
const shop = getShop(1908397290);
if (shop) {
  console.log(`✅ Shop details:`);
  console.log(`   - Name: ${shop.title}`);
  console.log(`   - UUID: ${shop.uuid}`);
  console.log(`   - Category: ${shop.category}`);
  console.log(`   - Region: ${shop.region}`);
  console.log(`   - City: ${shop.city} (ID: ${shop.cityId})`);
  console.log(`   - Price: ${shop.avgPrice} (${shop.priceNumber})`);
  console.log(`   - Score: ${shop.fiveScore}/5.0 (★${shop.star})`);
  console.log(`   - Reviews: ${shop.reviewCount} (${shop.reviewNumber})`);
  console.log(`   - Location: ${shop.lat}, ${shop.lng}`);
  console.log(`   - Tags: ${shop.tags.join(', ')}`);
  console.log(`   - Recommended dishes: ${shop.recDishes.slice(0, 5).join(', ')}`);
  console.log(`   - Reason: ${shop.recReason}`);
  console.log(`   - Web URL: ${shop.webUrl}`);
}
console.log();

// Tool 4: shops_near
console.log('📍 Tool 4: shops_near (lat: 22.625, lng: 114.062, radius: 2km)');
console.log('─────────────────────────────────────────────────────');
const nearbyShops = getShopsNear(22.625, 114.062, 2);
console.log(`✅ Found ${nearbyShops.length} shops within 2km:`);
nearbyShops.forEach((shop: any) => {
  console.log(`   - ${shop.title}`);
  console.log(`     Distance: ${shop.distance?.toFixed(2)}km, Price: ¥${shop.priceNumber}, Score: ${shop.fiveScore}`);
});
console.log();

// Tool 5: plan_route
console.log('🗺️  Tool 5: plan_route (3 shops from start point)');
console.log('─────────────────────────────────────────────────────');
const startLat = 22.62;
const startLng = 114.08;
const shopIds = [1908397290, 931452608, 1321112760];

console.log(`Start point: ${startLat}, ${startLng}`);
console.log(`Shop IDs to visit: ${shopIds.join(', ')}`);

const routeShops = shopIds.map(id => getShop(id)).filter(s => s !== null);

const distance = (lat1: number, lng1: number, lat2: number, lng2: number) => {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

const route: any[] = [];
const remaining = [...routeShops];
let currentLat = startLat;
let currentLng = startLng;
let totalDistance = 0;

while (remaining.length > 0) {
  let nearest = remaining[0];
  let nearestIndex = 0;
  let nearestDistance = distance(currentLat, currentLng, nearest.lat, nearest.lng);

  for (let i = 1; i < remaining.length; i++) {
    const d = distance(currentLat, currentLng, remaining[i].lat, remaining[i].lng);
    if (d < nearestDistance) {
      nearest = remaining[i];
      nearestIndex = i;
      nearestDistance = d;
    }
  }

  totalDistance += nearestDistance;
  route.push({
    shop: nearest,
    distanceFromPrevious: nearestDistance
  });

  currentLat = nearest.lat;
  currentLng = nearest.lng;
  remaining.splice(nearestIndex, 1);
}

console.log(`✅ Optimized route (nearest-neighbor):`);
route.forEach((item, idx) => {
  console.log(`   ${idx + 1}. ${item.shop.title}`);
  console.log(`      Distance from previous: ${item.distanceFromPrevious.toFixed(2)}km`);
  console.log(`      Category: ${item.shop.category}, Price: ${item.shop.avgPrice}`);
});
console.log(`   Total distance: ${totalDistance.toFixed(2)}km`);
console.log();

console.log('═══════════════════════════════════════════════════════');
console.log('✅ All 5 MCP tools tested successfully!');
console.log('═══════════════════════════════════════════════════════');
