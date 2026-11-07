#!/usr/bin/env tsx
/**
 * 安全数据导出工具（不含敏感凭证）
 * 
 * 用途：
 * - 导出业务数据到 JSON
 * - 避开敏感凭证（token hash、session token）
 * - 按 openid 组织数据，便于恢复时验证身份
 * - 可用于备份或迁移
 * 
 * 用法：
 *   tsx scripts/export-db-safe.ts [数据库路径] [输出路径]
 *   tsx scripts/export-db-safe.ts /data/miniprogram.db ./backup.json
 * 
 * 安全性：
 * - 只读操作，不修改数据库
 * - 不导出 sessions.token
 * - 不导出 agent_tokens.token_hash
 * - 手机号脱敏（如果有）
 * - 输出文件应加密存储
 * 
 * ⚠️ 重要：
 * - 导出文件包含用户 openid（敏感）
 * - 导出文件包含店铺坐标和地址
 * - 妥善保管，不要提交到公开仓库
 */

import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

interface ExportedUser {
  id: string;
  openid: string; // 敏感，用于恢复时验证身份
  unionid?: string | null;
  nickname?: string | null;
  avatar?: string | null;
  created_at: string;
}

interface ExportedShop {
  id: string;
  source_type: string;
  source_shop_id?: string | null;
  amap_poi_id?: string | null;
  raw_name: string;
  adcode?: string | null;
  category?: string | null;
  district?: string | null;
  city?: string | null;
  address?: string | null;
  avg_price?: string | null;
  lat?: number | null;
  lng?: number | null;
  source_url?: string | null;
  head_img?: string | null;
  phone?: string | null; // 脱敏处理
}

interface ExportedFavorite {
  id: string;
  user_id: string;
  shop_id: string;
  note?: string | null;
  visibility: string;
  import_batch_id?: string | null;
  photo_url?: string | null;
  wishlist: number;
  from_user_id?: string | null;
  created_at: string;
}

interface ExportedCircle {
  id: string;
  name: string;
  owner_id: string;
  opengid?: string | null;
  member_limit: number;
  is_personal?: number | null;
  created_at: string;
  // 不导出 invite_token 和 token_expires_at（敏感）
}

interface ExportedCircleMember {
  circle_id: string;
  user_id: string;
  role: string;
  joined_at: string;
}

interface ExportedCircleShare {
  circle_id: string;
  favorite_id: string;
}

interface ExportedImportBatch {
  id: string;
  user_id: string;
  source_type: string;
  source_url?: string | null;
  albumid?: string | null;
  status: string;
  counts: string;
  created_at: string;
}

interface ExportedShopComment {
  id: string;
  shop_id: string;
  user_id: string;
  body: string;
  created_at: string;
}

interface ExportData {
  exportedAt: string;
  source: {
    dbPath: string;
    fileSize: number;
  };
  metadata: {
    totalUsers: number;
    totalShops: number;
    totalFavorites: number;
    totalCircles: number;
    totalComments: number;
  };
  users: ExportedUser[];
  shops: ExportedShop[];
  favorites: ExportedFavorite[];
  circles: ExportedCircle[];
  circle_members: ExportedCircleMember[];
  circle_shares: ExportedCircleShare[];
  import_batches: ExportedImportBatch[];
  shop_comments: ExportedShopComment[];
  security: {
    excludedTables: string[];
    sanitizedFields: string[];
  };
}

function maskPhone(phone: string | null | undefined): string | null {
  if (!phone || typeof phone !== 'string') return null;
  // 保留前3位和后4位，中间用 * 替换
  if (phone.length >= 11) {
    return phone.slice(0, 3) + '****' + phone.slice(-4);
  }
  return phone;
}

function exportUsers(db: Database.Database): ExportedUser[] {
  const rows = db.prepare(`
    SELECT id, openid, unionid, nickname, avatar, created_at
    FROM users
    ORDER BY created_at
  `).all() as ExportedUser[];
  
  return rows;
}

function exportShops(db: Database.Database): ExportedShop[] {
  const rows = db.prepare(`
    SELECT 
      id, source_type, source_shop_id, amap_poi_id, raw_name,
      adcode, category, district, city, address, avg_price,
      lat, lng, source_url, head_img, phone
    FROM shops
  `).all() as ExportedShop[];
  
  // 手机号脱敏
  return rows.map(shop => ({
    ...shop,
    phone: maskPhone(shop.phone),
  }));
}

function exportFavorites(db: Database.Database): ExportedFavorite[] {
  const rows = db.prepare(`
    SELECT 
      id, user_id, shop_id, note, visibility, import_batch_id,
      photo_url, wishlist, from_user_id, created_at
    FROM favorites
    ORDER BY created_at
  `).all() as ExportedFavorite[];
  
  return rows;
}

function exportCircles(db: Database.Database): ExportedCircle[] {
  const rows = db.prepare(`
    SELECT 
      id, name, owner_id, opengid, member_limit, is_personal, created_at
    FROM circles
    ORDER BY created_at
  `).all() as ExportedCircle[];
  
  return rows;
}

function exportCircleMembers(db: Database.Database): ExportedCircleMember[] {
  const rows = db.prepare(`
    SELECT circle_id, user_id, role, joined_at
    FROM circle_members
    ORDER BY joined_at
  `).all() as ExportedCircleMember[];
  
  return rows;
}

function exportCircleShares(db: Database.Database): ExportedCircleShare[] {
  const rows = db.prepare(`
    SELECT circle_id, favorite_id
    FROM circle_shares
  `).all() as ExportedCircleShare[];
  
  return rows;
}

function exportImportBatches(db: Database.Database): ExportedImportBatch[] {
  const rows = db.prepare(`
    SELECT 
      id, user_id, source_type, source_url, albumid, status, counts, created_at
    FROM import_batches
    ORDER BY created_at
  `).all() as ExportedImportBatch[];
  
  return rows;
}

function exportShopComments(db: Database.Database): ExportedShopComment[] {
  const rows = db.prepare(`
    SELECT id, shop_id, user_id, body, created_at
    FROM shop_comments
    ORDER BY created_at
  `).all() as ExportedShopComment[];
  
  return rows;
}

async function main() {
  const args = process.argv.slice(2);
  const dbPath = args[0] || path.join(process.cwd(), 'data', 'miniprogram.db');
  const outputPath = args[1] || path.join(process.cwd(), 'data', 'backup.json');

  console.log('═══════════════════════════════════════════════════════════');
  console.log('        安全数据导出工具（不含敏感凭证）');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('');
  console.log(`数据库: ${dbPath}`);
  console.log(`输出: ${outputPath}`);
  console.log('');

  // 检查数据库文件
  if (!fs.existsSync(dbPath)) {
    console.error('❌ 数据库文件不存在');
    process.exit(1);
  }

  const fileStats = fs.statSync(dbPath);
  console.log(`数据库大小: ${(fileStats.size / 1024).toFixed(2)} KB`);
  console.log('');

  // 打开数据库（只读）
  let db: Database.Database | null = null;
  try {
    db = new Database(dbPath, { readonly: true });
    
    console.log('导出数据...');
    console.log('');

    const exportData: ExportData = {
      exportedAt: new Date().toISOString(),
      source: {
        dbPath,
        fileSize: fileStats.size,
      },
      metadata: {
        totalUsers: 0,
        totalShops: 0,
        totalFavorites: 0,
        totalCircles: 0,
        totalComments: 0,
      },
      users: [],
      shops: [],
      favorites: [],
      circles: [],
      circle_members: [],
      circle_shares: [],
      import_batches: [],
      shop_comments: [],
      security: {
        excludedTables: ['sessions', 'agent_tokens'],
        sanitizedFields: ['phone'],
      },
    };

    // 导出各表
    console.log('📦 导出用户表...');
    exportData.users = exportUsers(db);
    exportData.metadata.totalUsers = exportData.users.length;
    console.log(`   ✓ ${exportData.users.length} 个用户`);

    console.log('📦 导出店铺表...');
    exportData.shops = exportShops(db);
    exportData.metadata.totalShops = exportData.shops.length;
    console.log(`   ✓ ${exportData.shops.length} 个店铺`);

    console.log('📦 导出收藏表...');
    exportData.favorites = exportFavorites(db);
    exportData.metadata.totalFavorites = exportData.favorites.length;
    console.log(`   ✓ ${exportData.favorites.length} 条收藏`);

    console.log('📦 导出圈子表...');
    exportData.circles = exportCircles(db);
    exportData.metadata.totalCircles = exportData.circles.length;
    console.log(`   ✓ ${exportData.circles.length} 个圈子`);

    console.log('📦 导出圈子成员表...');
    exportData.circle_members = exportCircleMembers(db);
    console.log(`   ✓ ${exportData.circle_members.length} 条成员关系`);

    console.log('📦 导出圈子分享表...');
    exportData.circle_shares = exportCircleShares(db);
    console.log(`   ✓ ${exportData.circle_shares.length} 条分享记录`);

    console.log('📦 导出导入批次表...');
    exportData.import_batches = exportImportBatches(db);
    console.log(`   ✓ ${exportData.import_batches.length} 个导入批次`);

    console.log('📦 导出评论表...');
    exportData.shop_comments = exportShopComments(db);
    exportData.metadata.totalComments = exportData.shop_comments.length;
    console.log(`   ✓ ${exportData.shop_comments.length} 条评论`);

    console.log('');
    console.log('写入文件...');
    
    // 确保输出目录存在
    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // 写入 JSON
    fs.writeFileSync(outputPath, JSON.stringify(exportData, null, 2), 'utf8');

    const outputSize = fs.statSync(outputPath).size;
    console.log(`✅ 导出成功: ${outputPath}`);
    console.log(`   文件大小: ${(outputSize / 1024).toFixed(2)} KB`);
    console.log('');
    console.log('───────────────────────────────────────────────────────────');
    console.log('  导出摘要');
    console.log('───────────────────────────────────────────────────────────');
    console.log(`👤 用户: ${exportData.metadata.totalUsers}`);
    console.log(`🏪 店铺: ${exportData.metadata.totalShops}`);
    console.log(`❤️  收藏: ${exportData.metadata.totalFavorites}`);
    console.log(`👥 圈子: ${exportData.metadata.totalCircles}`);
    console.log(`💬 评论: ${exportData.metadata.totalComments}`);
    console.log('');
    console.log('───────────────────────────────────────────────────────────');
    console.log('  安全提示');
    console.log('───────────────────────────────────────────────────────────');
    console.log('⚠️  导出文件包含敏感信息（openid、地址、坐标）');
    console.log('⚠️  请妥善保管，不要提交到公开仓库');
    console.log('⚠️  建议加密存储');
    console.log('✅ 已排除: sessions, agent_tokens');
    console.log('✅ 已脱敏: 手机号');
    console.log('');
    console.log('═══════════════════════════════════════════════════════════');

  } catch (err) {
    console.error('❌ 导出失败:', err);
    process.exit(1);
  } finally {
    if (db) {
      try {
        db.close();
      } catch {
        // ignore
      }
    }
  }
}

main().catch((err) => {
  console.error('导出失败:', err);
  process.exit(1);
});
