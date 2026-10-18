#!/usr/bin/env tsx

import { fetchAlbumData } from './lib/fetcher';

console.log('Testing LIVE import (without fixtures)...\n');
console.log('Target: albumid=12498807');
console.log('API calls: https://mapi.dianping.com/mapi/collect/getfavoralbumdetail.bin\n');

try {
  const { album, shops } = await fetchAlbumData(12498807, false);
  
  console.log('✅ SUCCESS: Live API import worked!');
  console.log(`   Album: "${album.title}"`);
  console.log(`   Shops: ${shops.length} imported`);
  console.log(`   First shop: ${shops[0]?.title || 'N/A'}`);
  console.log(`   Has coordinates: ${shops[0]?.lat > 0 && shops[0]?.lng > 0}`);
} catch (error: any) {
  console.log('⚠️  FAILED: Live API call failed, fell back to fixtures');
  console.log(`   Error: ${error.message}`);
  console.log('\nThis is expected if running from a restricted network.');
  console.log('The app will automatically use fixtures in this case.');
}
