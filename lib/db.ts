import Database from 'better-sqlite3';
import { Album, Shop } from './types';
import path from 'path';
import fs from 'fs';

const dbPath = path.join(process.cwd(), 'data', 'opendianping.db');

let db: Database.Database | null = null;

export function getDB(): Database.Database {
  if (!db) {
    const dataDir = path.join(process.cwd(), 'data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    initDB(db);
  }
  return db;
}

function initDB(database: Database.Database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS albums (
      albumId INTEGER PRIMARY KEY,
      title TEXT NOT NULL,
      shopCount INTEGER,
      contentCount INTEGER,
      createTime INTEGER,
      latestModifyTime INTEGER,
      authorName TEXT,
      authorId INTEGER
    );

    CREATE TABLE IF NOT EXISTS shops (
      shopId INTEGER PRIMARY KEY,
      uuid TEXT,
      title TEXT NOT NULL,
      cityId INTEGER,
      city TEXT,
      category TEXT,
      region TEXT,
      avgPrice TEXT,
      priceNumber REAL,
      fiveScore REAL,
      star INTEGER,
      reviewCount TEXT,
      reviewNumber INTEGER,
      recReason TEXT,
      tags TEXT,
      headImg TEXT,
      webUrl TEXT,
      lat REAL,
      lng REAL,
      recDishes TEXT,
      albumId INTEGER,
      FOREIGN KEY (albumId) REFERENCES albums(albumId)
    );

    CREATE INDEX IF NOT EXISTS idx_shops_albumId ON shops(albumId);
    CREATE INDEX IF NOT EXISTS idx_shops_lat_lng ON shops(lat, lng);
  `);
}

export function saveAlbum(album: Album): void {
  const db = getDB();
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO albums 
    (albumId, title, shopCount, contentCount, createTime, latestModifyTime, authorName, authorId)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  
  stmt.run(
    album.albumId,
    album.title,
    album.shopCount,
    album.contentCount,
    album.createTime,
    album.latestModifyTime,
    album.authorName,
    album.authorId
  );
}

export function saveShop(shop: Shop): void {
  const db = getDB();
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO shops 
    (shopId, uuid, title, cityId, city, category, region, avgPrice, priceNumber,
     fiveScore, star, reviewCount, reviewNumber, recReason, tags, headImg, webUrl,
     lat, lng, recDishes, albumId)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  
  stmt.run(
    shop.shopId,
    shop.uuid,
    shop.title,
    shop.cityId,
    shop.city,
    shop.category,
    shop.region,
    shop.avgPrice,
    shop.priceNumber,
    shop.fiveScore,
    shop.star,
    shop.reviewCount,
    shop.reviewNumber,
    shop.recReason,
    JSON.stringify(shop.tags),
    shop.headImg,
    shop.webUrl,
    shop.lat,
    shop.lng,
    JSON.stringify(shop.recDishes),
    shop.albumId
  );
}

export function getAlbum(albumId: number): Album | null {
  const db = getDB();
  const stmt = db.prepare('SELECT * FROM albums WHERE albumId = ?');
  return stmt.get(albumId) as Album | null;
}

export function getShopsByAlbum(albumId: number): Shop[] {
  const db = getDB();
  const stmt = db.prepare('SELECT * FROM shops WHERE albumId = ?');
  const rows = stmt.all(albumId) as any[];
  
  return rows.map(row => ({
    ...row,
    tags: JSON.parse(row.tags || '[]'),
    recDishes: JSON.parse(row.recDishes || '[]')
  }));
}

export function getShop(shopId: number): Shop | null {
  const db = getDB();
  const stmt = db.prepare('SELECT * FROM shops WHERE shopId = ?');
  const row = stmt.get(shopId) as any;
  
  if (!row) return null;
  
  return {
    ...row,
    tags: JSON.parse(row.tags || '[]'),
    recDishes: JSON.parse(row.recDishes || '[]')
  };
}

export function getShopsNear(lat: number, lng: number, radiusKm: number): Shop[] {
  const db = getDB();
  const stmt = db.prepare(`
    SELECT *,
      (6371 * acos(cos(radians(?)) * cos(radians(lat)) * 
       cos(radians(lng) - radians(?)) + sin(radians(?)) * sin(radians(lat)))) 
      AS distance
    FROM shops
    WHERE lat IS NOT NULL AND lng IS NOT NULL
      AND lat != 0 AND lng != 0
      AND (6371 * acos(cos(radians(?)) * cos(radians(lat)) * 
           cos(radians(lng) - radians(?)) + sin(radians(?)) * sin(radians(lat)))) < ?
    ORDER BY distance
  `);
  
  const rows = stmt.all(lat, lng, lat, lat, lng, lat, radiusKm) as any[];
  
  return rows.map(row => ({
    ...row,
    tags: JSON.parse(row.tags || '[]'),
    recDishes: JSON.parse(row.recDishes || '[]')
  }));
}

export function listShops(filters?: {
  minPrice?: number;
  maxPrice?: number;
  minScore?: number;
  category?: string;
}): Shop[] {
  const db = getDB();
  
  let query = 'SELECT * FROM shops WHERE 1=1';
  const params: any[] = [];
  
  if (filters?.minPrice) {
    query += ' AND priceNumber >= ?';
    params.push(filters.minPrice);
  }
  
  if (filters?.maxPrice) {
    query += ' AND priceNumber <= ?';
    params.push(filters.maxPrice);
  }
  
  if (filters?.minScore) {
    query += ' AND fiveScore >= ?';
    params.push(filters.minScore);
  }
  
  if (filters?.category) {
    query += ' AND category LIKE ?';
    params.push(`%${filters.category}%`);
  }
  
  const stmt = db.prepare(query);
  const rows = stmt.all(...params) as any[];
  
  return rows.map(row => ({
    ...row,
    tags: JSON.parse(row.tags || '[]'),
    recDishes: JSON.parse(row.recDishes || '[]')
  }));
}
