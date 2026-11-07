#!/usr/bin/env tsx
/**
 * 安全数据恢复工具（仅 dry-run 默认）
 * 
 * 严格要求：
 * 1. 默认 dry-run，仅预览操作
 * 2. 校验可靠 openid 与备份关系
 * 3. 拒绝 dev_ 前缀账号
 * 4. 拒绝无归属收藏（无 user_id / openid）
 * 5. 不写生产环境
 * 6. 需要 --confirm 才执行实际写入
 * 
 * 用法：
 *   # Dry-run（默认）
 *   tsx scripts/restore-db-safe.ts \
 *     --backup ./backup.json \
 *     --target /tmp/test.db
 * 
 *   # 确认执行
 *   tsx scripts/restore-db-safe.ts \
 *     --backup ./backup.json \
 *     --target /tmp/test.db \
 *     --confirm
 * 
 * 禁止：
 *   - 不能在生产环境运行（NODE_ENV=production 拒绝）
 *   - 不能恢复 dev_ 账号
 *   - 不能恢复无归属收藏
 *   - 不能凭昵称匹配
 */

import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

interface BackupUser {
  id: string;
  openid: string;
  unionid?: string | null;
  nickname?: string | null;
  avatar?: string | null;
  created_at: string;
}

interface BackupFavorite {
  id: string;
  user_id: string;
  shop_id: string;
  note?: string | null;
  visibility: string;
  wishlist: number;
  created_at: string;
}

interface BackupShop {
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
  display_cache_policy?: string | null;
  head_img?: string | null;
  phone?: string | null;
}

interface BackupData {
  exportedAt: string;
  users: BackupUser[];
  shops?: BackupShop[];
  favorites: BackupFavorite[];
  circles?: any[];
  circle_members?: any[];
  circle_shares?: any[];
  comments?: any[];
}

interface RestoreResult {
  dryRun: boolean;
  users: {
    total: number;
    skipped: number;
    restored: number;
    rejected: Array<{ openid: string; reason: string }>;
  };
  favorites: {
    total: number;
    skipped: number;
    restored: number;
    rejected: Array<{ id: string; reason: string }>;
  };
}

function parseArgs() {
  const args = process.argv.slice(2);
  const result: {
    backup?: string;
    target?: string;
    confirm: boolean;
  } = {
    confirm: false,
  };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--backup' && args[i + 1]) {
      result.backup = args[i + 1];
      i++;
    } else if (args[i] === '--target' && args[i + 1]) {
      result.target = args[i + 1];
      i++;
    } else if (args[i] === '--confirm') {
      result.confirm = true;
    }
  }

  return result;
}

function loadBackup(backupPath: string): BackupData {
  if (!fs.existsSync(backupPath)) {
    throw new Error(`备份文件不存在: ${backupPath}`);
  }

  const content = fs.readFileSync(backupPath, 'utf8');
  return JSON.parse(content);
}

function restoreData(
  backup: BackupData,
  targetPath: string,
  dryRun: boolean
): RestoreResult {
  const result: RestoreResult = {
    dryRun,
    users: {
      total: backup.users.length,
      skipped: 0,
      restored: 0,
      rejected: [],
    },
    favorites: {
      total: backup.favorites.length,
      skipped: 0,
      restored: 0,
      rejected: [],
    },
  };

  let db: Database.Database | null = null;

  try {
    if (!dryRun) {
      db = new Database(targetPath);
    }

    // 1. 恢复shops（favorites依赖shops）
    if (backup.shops && !dryRun && db) {
      for (const shop of backup.shops) {
        const existing = db.prepare('SELECT id FROM shops WHERE id = ?').get(shop.id);
        if (!existing) {
          db.prepare(`
            INSERT INTO shops (
              id, source_type, source_shop_id, amap_poi_id, raw_name,
              adcode, category, district, city, address, avg_price,
              lat, lng, source_url, display_cache_policy, head_img, phone
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            shop.id,
            shop.source_type,
            shop.source_shop_id,
            shop.amap_poi_id,
            shop.raw_name,
            shop.adcode,
            shop.category,
            shop.district,
            shop.city,
            shop.address,
            shop.avg_price,
            shop.lat,
            shop.lng,
            shop.source_url,
            shop.display_cache_policy || 'minimal',
            shop.head_img,
            shop.phone
          );
        }
      }
    }

    // 2. 恢复用户
    for (const user of backup.users) {
      // 拒绝 dev_ 账号
      if (user.openid.startsWith('dev_')) {
        result.users.rejected.push({
          openid: user.openid,
          reason: 'dev_ 调试账号，禁止恢复',
        });
        continue;
      }

      // 验证 openid 存在
      if (!user.openid || user.openid.trim() === '') {
        result.users.rejected.push({
          openid: user.openid || '(空)',
          reason: '缺少 openid',
        });
        continue;
      }

      if (!dryRun && db) {
        // 检查是否已存在
        const existing = db
          .prepare('SELECT id FROM users WHERE openid = ?')
          .get(user.openid);

        if (existing) {
          result.users.skipped++;
          continue;
        }

        // 插入用户
        db.prepare(
          `INSERT INTO users (id, openid, unionid, nickname, avatar, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`
        ).run(
          user.id,
          user.openid,
          user.unionid,
          user.nickname,
          user.avatar,
          user.created_at
        );
      }

      result.users.restored++;
    }

    // 恢复收藏
    for (const favorite of backup.favorites) {
      // 验证归属
      if (!favorite.user_id) {
        result.favorites.rejected.push({
          id: favorite.id,
          reason: '无 user_id 归属',
        });
        continue;
      }

      // 验证用户存在
      const user = backup.users.find((u) => u.id === favorite.user_id);
      if (!user) {
        result.favorites.rejected.push({
          id: favorite.id,
          reason: '用户不存在于备份中',
        });
        continue;
      }

      // 拒绝 dev_ 用户的收藏
      if (user.openid.startsWith('dev_')) {
        result.favorites.rejected.push({
          id: favorite.id,
          reason: `属于 dev_ 账号 ${user.openid}`,
        });
        continue;
      }

      if (!dryRun && db) {
        // 检查是否已存在
        const existing = db
          .prepare('SELECT id FROM favorites WHERE id = ?')
          .get(favorite.id);

        if (existing) {
          result.favorites.skipped++;
          continue;
        }

        // 插入收藏
        db.prepare(
          `INSERT INTO favorites (id, user_id, shop_id, note, visibility, wishlist, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        ).run(
          favorite.id,
          favorite.user_id,
          favorite.shop_id,
          favorite.note,
          favorite.visibility,
          favorite.wishlist,
          favorite.created_at
        );
      }

      result.favorites.restored++;
    }
  } finally {
    if (db) {
      db.close();
    }
  }

  return result;
}

function printResult(result: RestoreResult) {
  console.log('');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('          恢复结果');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('');

  if (result.dryRun) {
    console.log('⚠️  DRY-RUN 模式（未实际写入）');
    console.log('');
  }

  console.log('用户恢复：');
  console.log(`  总数: ${result.users.total}`);
  console.log(`  恢复: ${result.users.restored}`);
  console.log(`  跳过: ${result.users.skipped}`);
  console.log(`  拒绝: ${result.users.rejected.length}`);

  if (result.users.rejected.length > 0) {
    console.log('');
    console.log('  拒绝的用户：');
    for (const rejected of result.users.rejected.slice(0, 10)) {
      console.log(`    - ${rejected.openid}: ${rejected.reason}`);
    }
    if (result.users.rejected.length > 10) {
      console.log(`    ... 还有 ${result.users.rejected.length - 10} 个`);
    }
  }

  console.log('');
  console.log('收藏恢复：');
  console.log(`  总数: ${result.favorites.total}`);
  console.log(`  恢复: ${result.favorites.restored}`);
  console.log(`  跳过: ${result.favorites.skipped}`);
  console.log(`  拒绝: ${result.favorites.rejected.length}`);

  if (result.favorites.rejected.length > 0) {
    console.log('');
    console.log('  拒绝的收藏：');
    for (const rejected of result.favorites.rejected.slice(0, 10)) {
      console.log(`    - ${rejected.id}: ${rejected.reason}`);
    }
    if (result.favorites.rejected.length > 10) {
      console.log(`    ... 还有 ${result.favorites.rejected.length - 10} 个`);
    }
  }

  console.log('');
  console.log('═══════════════════════════════════════════════════════════');
}

function main() {
  console.log('安全数据恢复工具');
  console.log('');

  const args = parseArgs();

  if (!args.backup) {
    console.error('❌ 缺少 --backup 参数');
    console.error('用法: tsx scripts/restore-db-safe.ts --backup ./backup.json --target /tmp/test.db');
    process.exit(1);
  }

  if (!args.target) {
    console.error('❌ 缺少 --target 参数');
    console.error('用法: tsx scripts/restore-db-safe.ts --backup ./backup.json --target /tmp/test.db');
    process.exit(1);
  }

  // 安全检查：目标路径必须是明确的隔离临时路径
  const resolvedTarget = path.resolve(args.target);
  const safePrefixes = ['/tmp/', '/var/tmp/', path.resolve(process.cwd(), 'tmp/'), path.resolve(process.cwd(), 'test/')];
  const isSafePath = safePrefixes.some(prefix => resolvedTarget.startsWith(prefix));
  
  if (!isSafePath) {
    console.error('❌ 目标路径不安全，仅允许写入隔离临时路径：');
    console.error('   - /tmp/');
    console.error('   - /var/tmp/');
    console.error('   - ./tmp/');
    console.error('   - ./test/');
    console.error('');
    console.error(`当前目标: ${resolvedTarget}`);
    console.error('');
    console.error('拒绝写入可能的生产路径，防止误操作');
    process.exit(1);
  }
  
  // 额外检查：拒绝 /data/ 路径（生产持久盘路径）
  if (resolvedTarget.startsWith('/data/')) {
    console.error('❌ 禁止写入 /data/ 路径（生产持久盘）');
    process.exit(1);
  }
  
  // 生产环境多重拒绝（NODE_ENV 可能被绕过，所以还要检查路径）
  if (process.env.NODE_ENV === 'production') {
    console.error('❌ NODE_ENV=production，禁止运行恢复工具');
    process.exit(1);
  }

  console.log(`备份文件: ${args.backup}`);
  console.log(`目标数据库: ${args.target}`);
  console.log(`模式: ${args.confirm ? '✅ 确认执行' : '⚠️  DRY-RUN（预览）'}`);
  console.log('');

  // 加载备份
  console.log('加载备份...');
  const backup = loadBackup(args.backup);
  console.log(`✅ 备份加载成功`);
  console.log(`   导出时间: ${backup.exportedAt}`);
  console.log(`   用户数: ${backup.users.length}`);
  console.log(`   收藏数: ${backup.favorites.length}`);
  console.log('');

  // 恢复数据
  console.log(args.confirm ? '执行恢复...' : '预览恢复（不写入）...');
  const result = restoreData(backup, args.target, !args.confirm);

  // 输出结果
  printResult(result);

  if (result.dryRun) {
    console.log('');
    console.log('要实际执行恢复，请添加 --confirm 参数');
  }
}

main();
