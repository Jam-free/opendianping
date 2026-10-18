import { parseAlbumUrl, fetchAlbumData } from '../lib/fetcher';
import { saveAlbum, saveShop, getShopsByAlbum, getAlbum } from '../lib/db';

describe('Fetcher', () => {
  test('parseAlbumUrl should extract album ID', () => {
    const url1 = 'https://h5.dianping.com/app/commonplatform-collection-static/album.html?albumid=12498807';
    expect(parseAlbumUrl(url1)).toBe(12498807);

    const url2 = 'albumid:12498807';
    expect(parseAlbumUrl(url2)).toBe(12498807);

    const url3 = 'invalid url';
    expect(parseAlbumUrl(url3)).toBeNull();
  });

  test('fetchAlbumData with fixtures should return 6 shops', async () => {
    const { album, shops } = await fetchAlbumData(12498807, true);

    expect(album.albumId).toBe(12498807);
    expect(album.title).toBe('坂田');
    expect(album.shopCount).toBe(6);
    expect(shops.length).toBe(6);

    const firstShop = shops[0];
    expect(firstShop.shopId).toBe(1908397290);
    expect(firstShop.title).toContain('懂爱小面');
    expect(firstShop.lat).toBeGreaterThan(0);
    expect(firstShop.lng).toBeGreaterThan(0);
  });

  test('database save and retrieve', async () => {
    const { album, shops } = await fetchAlbumData(12498807, true);

    saveAlbum(album);
    shops.forEach(shop => saveShop(shop));

    const retrievedAlbum = getAlbum(12498807);
    expect(retrievedAlbum?.title).toBe('坂田');

    const retrievedShops = getShopsByAlbum(12498807);
    expect(retrievedShops.length).toBe(6);

    const firstShop = retrievedShops.find(s => s.shopId === 1908397290);
    expect(firstShop).toBeDefined();
    expect(firstShop?.title).toContain('懂爱小面');
    expect(firstShop?.lat).toBeGreaterThan(0);
    expect(firstShop?.tags).toBeInstanceOf(Array);
    expect(firstShop?.recDishes).toBeInstanceOf(Array);
  });
});
