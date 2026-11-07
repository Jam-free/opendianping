#!/usr/bin/env tsx
/**
 * 本地诊断工具：检查持久化状态
 * 
 * 用于运维排查，只读本地命令，不暴露远程接口。
 * 
 * 用法：
 *   tsx scripts/diagnose-persistence.ts
 *   tsx scripts/diagnose-persistence.ts /data/miniprogram.db
 */

import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

interface PersistenceHealth {
  dbPath: string;
  dbExists: boolean;
  dbSize?: number;
  isCloudRunPath: boolean;
  looksEphemeral: boolean;
  userCount?: number;
  favoriteCount?: number;
  agentTokenCount?: number;
  shopCount?: number;
  warning?: string;
}

function isCloudRunDataPath(dbPath: string): boolean {
  return dbPath.startsWith('/data/');
}

function looksLikeEphemeralDataMount(dbPath: string): boolean {
  if (!dbPath.startsWith('/data/')) return false;
  
  const dataDir = path.dirname(dbPath);
  try {
    const stat = fs.statSync(dataDir);
    if (!stat.isDirectory()) return true;
    
    // 简单检查：空目录或只有 lost+found
    const entries = fs.readdirSync(dataDir);
    return entries.length === 0 || (entries.length === 1 && entries[0] === 'lost+found');
  } catch {
    return true;
  }
}

function diagnose(dbPath: string): PersistenceHealth {
  const result: PersistenceHealth = {
    dbPath,
    dbExists: fs.existsSync(dbPath),
    isCloudRunPath: isCloudRunDataPath(dbPath),
    looksEphemeral: looksLikeEphemeralDataMount(dbPath),
  };

  if (result.dbExists) {
    const stat = fs.statSync(dbPath);
    result.dbSize = stat.size;

    try {
      const db = new Database(dbPath, { readonly: true });
      
      try {
        result.userCount = db.prepare('SELECT COUNT(*) as count FROM users').get()?.count ?? 0;
        result.favoriteCount = db.prepare('SELECT COUNT(*) as count FROM favorites').get()?.count ?? 0;
        result.agentTokenCount = db.prepare('SELECT COUNT(*) as count FROM agent_tokens').get()?.count ?? 0;
        result.shopCount = db.prepare('SELECT COUNT(*) as count FROM shops').get()?.count ?? 0;
      } catch (err) {
        result.warning = `查询失败: ${err}`;
      }
      
      db.close();
    } catch (err) {
      result.warning = `无法打开数据库: ${err}`;
    }
  }

  if (!result.isCloudRunPath) {
    result.warning = '⚠️  数据库路径不在 /data/（非持久盘）';
  } else if (result.looksEphemeral) {
    result.warning = '⚠️  /data/ 目录疑似未挂载持久盘';
  }

  return result;
}

function printDiagnosis(health: PersistenceHealth) {
  console.log('');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('          持久化诊断');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('');
  
  console.log(`数据库路径: ${health.dbPath}`);
  console.log(`文件存在:   ${health.dbExists ? '✅' : '❌'}`);
  
  if (health.dbExists && health.dbSize !== undefined) {
    console.log(`文件大小:   ${(health.dbSize / 1024).toFixed(2)} KB`);
  }
  
  console.log(`云托管路径: ${health.isCloudRunPath ? '✅' : '❌'}`);
  console.log(`疑似临时盘: ${health.looksEphemeral ? '⚠️  是' : '✅ 否'}`);
  
  if (health.userCount !== undefined) {
    console.log('');
    console.log('数据统计:');
    console.log(`  用户数:   ${health.userCount}`);
    console.log(`  收藏数:   ${health.favoriteCount}`);
    console.log(`  Token数:  ${health.agentTokenCount}`);
    console.log(`  店铺数:   ${health.shopCount}`);
  }
  
  if (health.warning) {
    console.log('');
    console.log(health.warning);
  }
  
  console.log('');
  console.log('═══════════════════════════════════════════════════════════');
}

function main() {
  const args = process.argv.slice(2);
  const dbPath = args[0] || process.env.DB_PATH || './data/miniprogram.db';
  
  const resolvedPath = path.resolve(process.cwd(), dbPath);
  const health = diagnose(resolvedPath);
  printDiagnosis(health);
  
  // 退出码
  if (!health.dbExists) {
    process.exit(1);
  }
  if (health.warning) {
    process.exit(2);
  }
  process.exit(0);
}

main();
