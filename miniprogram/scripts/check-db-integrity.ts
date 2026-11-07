#!/usr/bin/env tsx
/**
 * 数据库完整性检查工具（只读）
 * 
 * 用途：
 * - 检查数据库文件是否存在和可访问
 * - 统计各表记录数
 * - 检查外键一致性
 * - 检查持久化状态
 * - 生成诊断报告
 * 
 * 用法：
 *   tsx scripts/check-db-integrity.ts [数据库路径]
 *   tsx scripts/check-db-integrity.ts /data/miniprogram.db
 *   tsx scripts/check-db-integrity.ts ./data/miniprogram.db
 * 
 * 安全性：
 * - 只读操作，不修改数据
 * - 不导出敏感信息（token、密码哈希）
 * - 可安全在生产环境运行
 */

import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import {
  isCloudRunDataPath,
  looksLikeEphemeralDataMount,
  CLOUD_DATA_VOLUME_ROOT,
} from '../server/persistence.js';

interface TableCounts {
  users: number;
  sessions: number;
  shops: number;
  favorites: number;
  circles: number;
  circle_members: number;
  circle_shares: number;
  agent_tokens: number;
  import_batches: number;
  shop_comments: number;
}

interface IntegrityIssue {
  severity: 'error' | 'warning' | 'info';
  table: string;
  issue: string;
  details?: string;
}

interface DiagnosticReport {
  timestamp: string;
  dbPath: string;
  fileExists: boolean;
  fileSize?: number;
  isCloudDataPath: boolean;
  isEphemeralMount?: boolean;
  tableCounts: Partial<TableCounts>;
  integrityIssues: IntegrityIssue[];
  foreignKeyChecks: {
    table: string;
    valid: boolean;
    orphanedCount?: number;
  }[];
  summary: {
    totalUsers: number;
    totalFavorites: number;
    totalCircles: number;
    totalAgentTokens: number;
    hasData: boolean;
    healthStatus: 'healthy' | 'warning' | 'error';
  };
}

function checkFileSystem(dbPath: string): Pick<DiagnosticReport, 'fileExists' | 'fileSize'> {
  try {
    if (!fs.existsSync(dbPath)) {
      return { fileExists: false };
    }
    const stats = fs.statSync(dbPath);
    return {
      fileExists: true,
      fileSize: stats.size,
    };
  } catch (err) {
    console.error(`文件系统检查失败: ${err}`);
    return { fileExists: false };
  }
}

function countRecords(db: Database.Database, table: string): number {
  try {
    const result = db.prepare(`SELECT COUNT(*) as count FROM ${table}`).get() as { count: number };
    return result.count;
  } catch (err) {
    console.warn(`无法统计表 ${table}: ${err}`);
    return -1;
  }
}

function getAllTableCounts(db: Database.Database): Partial<TableCounts> {
  const tables = [
    'users',
    'sessions',
    'shops',
    'favorites',
    'circles',
    'circle_members',
    'circle_shares',
    'agent_tokens',
    'import_batches',
    'shop_comments',
  ];

  const counts: Partial<TableCounts> = {};
  for (const table of tables) {
    const count = countRecords(db, table);
    if (count >= 0) {
      counts[table as keyof TableCounts] = count;
    }
  }
  return counts;
}

function checkForeignKeys(db: Database.Database): DiagnosticReport['foreignKeyChecks'] {
  const checks: DiagnosticReport['foreignKeyChecks'] = [];

  // 检查 sessions.user_id -> users.id
  try {
    const orphanedSessions = db.prepare(`
      SELECT COUNT(*) as count FROM sessions
      WHERE user_id NOT IN (SELECT id FROM users)
    `).get() as { count: number };
    
    checks.push({
      table: 'sessions',
      valid: orphanedSessions.count === 0,
      orphanedCount: orphanedSessions.count,
    });
  } catch (err) {
    checks.push({
      table: 'sessions',
      valid: false,
    });
  }

  // 检查 favorites.user_id -> users.id
  try {
    const orphanedFavorites = db.prepare(`
      SELECT COUNT(*) as count FROM favorites
      WHERE user_id NOT IN (SELECT id FROM users)
    `).get() as { count: number };
    
    checks.push({
      table: 'favorites',
      valid: orphanedFavorites.count === 0,
      orphanedCount: orphanedFavorites.count,
    });
  } catch (err) {
    checks.push({
      table: 'favorites',
      valid: false,
    });
  }

  // 检查 favorites.shop_id -> shops.id
  try {
    const orphanedShops = db.prepare(`
      SELECT COUNT(*) as count FROM favorites
      WHERE shop_id NOT IN (SELECT id FROM shops)
    `).get() as { count: number };
    
    checks.push({
      table: 'favorites (shop_id)',
      valid: orphanedShops.count === 0,
      orphanedCount: orphanedShops.count,
    });
  } catch (err) {
    checks.push({
      table: 'favorites (shop_id)',
      valid: false,
    });
  }

  // 检查 agent_tokens.user_id -> users.id
  try {
    const orphanedTokens = db.prepare(`
      SELECT COUNT(*) as count FROM agent_tokens
      WHERE user_id NOT IN (SELECT id FROM users)
    `).get() as { count: number };
    
    checks.push({
      table: 'agent_tokens',
      valid: orphanedTokens.count === 0,
      orphanedCount: orphanedTokens.count,
    });
  } catch (err) {
    checks.push({
      table: 'agent_tokens',
      valid: false,
    });
  }

  return checks;
}

function collectIntegrityIssues(
  dbPath: string,
  fileInfo: { fileExists: boolean; fileSize?: number },
  counts: Partial<TableCounts>,
  fkChecks: DiagnosticReport['foreignKeyChecks']
): IntegrityIssue[] {
  const issues: IntegrityIssue[] = [];

  // 检查文件存在性
  if (!fileInfo.fileExists) {
    issues.push({
      severity: 'error',
      table: 'filesystem',
      issue: '数据库文件不存在',
      details: `路径: ${dbPath}`,
    });
    return issues;
  }

  // 检查文件大小
  if (fileInfo.fileSize === 0) {
    issues.push({
      severity: 'error',
      table: 'filesystem',
      issue: '数据库文件为空（0 字节）',
      details: '可能是新建的空库',
    });
  } else if (fileInfo.fileSize && fileInfo.fileSize < 50000) {
    issues.push({
      severity: 'warning',
      table: 'filesystem',
      issue: `数据库文件很小（${fileInfo.fileSize} 字节）`,
      details: '可能只有表结构，没有实际数据',
    });
  }

  // 检查是否为云托管路径
  const isCloudPath = isCloudRunDataPath(dbPath);
  if (isCloudPath) {
    const isEphemeral = looksLikeEphemeralDataMount(CLOUD_DATA_VOLUME_ROOT);
    if (isEphemeral) {
      issues.push({
        severity: 'error',
        table: 'persistence',
        issue: '/data 看起来像容器临时盘',
        details: '未挂载持久卷，或 /data 在镜像可写层。重新部署会丢失数据。',
      });
    }
  }

  // 检查空表
  if (counts.users === 0) {
    issues.push({
      severity: isCloudPath ? 'error' : 'warning',
      table: 'users',
      issue: '用户表为空',
      details: isCloudPath ? '生产环境不应该有空用户表' : '本地开发环境可能正常',
    });
  }

  if (counts.favorites === 0 && counts.users && counts.users > 0) {
    issues.push({
      severity: 'warning',
      table: 'favorites',
      issue: '有用户但没有收藏',
      details: '用户可能还没有添加收藏',
    });
  }

  if (counts.agent_tokens === 0 && counts.users && counts.users > 0) {
    issues.push({
      severity: 'info',
      table: 'agent_tokens',
      issue: '有用户但没有 Agent Token',
      details: '用户可能还没有点击"连接 AI"',
    });
  }

  // 检查外键完整性
  for (const check of fkChecks) {
    if (!check.valid && check.orphanedCount && check.orphanedCount > 0) {
      issues.push({
        severity: 'error',
        table: check.table,
        issue: `外键约束违反：发现 ${check.orphanedCount} 条孤儿记录`,
        details: '引用的父记录不存在',
      });
    }
  }

  // 检查会话数量异常
  if (counts.sessions && counts.users && counts.sessions > counts.users * 10) {
    issues.push({
      severity: 'warning',
      table: 'sessions',
      issue: `会话数量异常多（${counts.sessions} 会话 vs ${counts.users} 用户）`,
      details: '可能需要清理过期会话',
    });
  }

  return issues;
}

function generateSummary(
  counts: Partial<TableCounts>,
  issues: IntegrityIssue[]
): DiagnosticReport['summary'] {
  const hasErrors = issues.some((i) => i.severity === 'error');
  const hasWarnings = issues.some((i) => i.severity === 'warning');

  return {
    totalUsers: counts.users || 0,
    totalFavorites: counts.favorites || 0,
    totalCircles: counts.circles || 0,
    totalAgentTokens: counts.agent_tokens || 0,
    hasData: (counts.users || 0) > 0 || (counts.favorites || 0) > 0,
    healthStatus: hasErrors ? 'error' : hasWarnings ? 'warning' : 'healthy',
  };
}

function formatReport(report: DiagnosticReport): string {
  const lines: string[] = [];
  
  lines.push('═══════════════════════════════════════════════════════════');
  lines.push('          数据库完整性检查报告');
  lines.push('═══════════════════════════════════════════════════════════');
  lines.push('');
  lines.push(`检查时间: ${report.timestamp}`);
  lines.push(`数据库路径: ${report.dbPath}`);
  lines.push(`文件存在: ${report.fileExists ? '✓ 是' : '✗ 否'}`);
  if (report.fileSize !== undefined) {
    lines.push(`文件大小: ${(report.fileSize / 1024).toFixed(2)} KB`);
  }
  lines.push(`云托管路径: ${report.isCloudDataPath ? '✓ 是' : '✗ 否'}`);
  if (report.isEphemeralMount !== undefined) {
    lines.push(`临时盘挂载: ${report.isEphemeralMount ? '✗ 是（危险）' : '✓ 否'}`);
  }
  lines.push('');

  lines.push('───────────────────────────────────────────────────────────');
  lines.push('  数据统计');
  lines.push('───────────────────────────────────────────────────────────');
  const counts = report.tableCounts;
  lines.push(`👤 用户数 (users):               ${counts.users ?? 'N/A'}`);
  lines.push(`🔑 会话数 (sessions):            ${counts.sessions ?? 'N/A'}`);
  lines.push(`🏪 店铺数 (shops):               ${counts.shops ?? 'N/A'}`);
  lines.push(`❤️  收藏数 (favorites):          ${counts.favorites ?? 'N/A'}`);
  lines.push(`👥 圈子数 (circles):             ${counts.circles ?? 'N/A'}`);
  lines.push(`🔗 圈子成员 (circle_members):    ${counts.circle_members ?? 'N/A'}`);
  lines.push(`📤 圈子分享 (circle_shares):     ${counts.circle_shares ?? 'N/A'}`);
  lines.push(`🤖 Agent Token (agent_tokens):   ${counts.agent_tokens ?? 'N/A'}`);
  lines.push(`📥 导入批次 (import_batches):    ${counts.import_batches ?? 'N/A'}`);
  lines.push(`💬 评论数 (shop_comments):       ${counts.shop_comments ?? 'N/A'}`);
  lines.push('');

  if (report.foreignKeyChecks.length > 0) {
    lines.push('───────────────────────────────────────────────────────────');
    lines.push('  外键完整性检查');
    lines.push('───────────────────────────────────────────────────────────');
    for (const check of report.foreignKeyChecks) {
      const status = check.valid ? '✓' : '✗';
      const detail = check.orphanedCount !== undefined && check.orphanedCount > 0
        ? ` (${check.orphanedCount} 条孤儿记录)`
        : '';
      lines.push(`${status} ${check.table}${detail}`);
    }
    lines.push('');
  }

  if (report.integrityIssues.length > 0) {
    lines.push('───────────────────────────────────────────────────────────');
    lines.push('  发现的问题');
    lines.push('───────────────────────────────────────────────────────────');
    for (const issue of report.integrityIssues) {
      const icon = issue.severity === 'error' ? '❌' : issue.severity === 'warning' ? '⚠️ ' : 'ℹ️ ';
      lines.push(`${icon} [${issue.severity.toUpperCase()}] ${issue.table}`);
      lines.push(`   ${issue.issue}`);
      if (issue.details) {
        lines.push(`   详情: ${issue.details}`);
      }
      lines.push('');
    }
  } else {
    lines.push('✅ 未发现完整性问题');
    lines.push('');
  }

  lines.push('───────────────────────────────────────────────────────────');
  lines.push('  总结');
  lines.push('───────────────────────────────────────────────────────────');
  lines.push(`总用户数: ${report.summary.totalUsers}`);
  lines.push(`总收藏数: ${report.summary.totalFavorites}`);
  lines.push(`总圈子数: ${report.summary.totalCircles}`);
  lines.push(`AI Token 数: ${report.summary.totalAgentTokens}`);
  lines.push(`有实际数据: ${report.summary.hasData ? '✓ 是' : '✗ 否'}`);
  
  const statusIcon = 
    report.summary.healthStatus === 'healthy' ? '✅' :
    report.summary.healthStatus === 'warning' ? '⚠️' : '❌';
  lines.push(`健康状态: ${statusIcon} ${report.summary.healthStatus.toUpperCase()}`);
  lines.push('');
  lines.push('═══════════════════════════════════════════════════════════');

  return lines.join('\n');
}

async function main() {
  const args = process.argv.slice(2);
  const dbPath = args[0] || path.join(process.cwd(), 'data', 'miniprogram.db');

  console.log('数据库完整性检查工具（只读）');
  console.log(`目标数据库: ${dbPath}`);
  console.log('');

  const report: DiagnosticReport = {
    timestamp: new Date().toISOString(),
    dbPath,
    fileExists: false,
    isCloudDataPath: isCloudRunDataPath(dbPath),
    tableCounts: {},
    integrityIssues: [],
    foreignKeyChecks: [],
    summary: {
      totalUsers: 0,
      totalFavorites: 0,
      totalCircles: 0,
      totalAgentTokens: 0,
      hasData: false,
      healthStatus: 'error',
    },
  };

  // 检查文件系统
  const fileInfo = checkFileSystem(dbPath);
  report.fileExists = fileInfo.fileExists;
  report.fileSize = fileInfo.fileSize;

  if (!fileInfo.fileExists) {
    report.integrityIssues.push({
      severity: 'error',
      table: 'filesystem',
      issue: '数据库文件不存在',
      details: `路径: ${dbPath}`,
    });
    
    console.log(formatReport(report));
    process.exit(1);
  }

  // 检查是否为临时盘
  if (report.isCloudDataPath) {
    report.isEphemeralMount = looksLikeEphemeralDataMount(CLOUD_DATA_VOLUME_ROOT);
  }

  // 打开数据库（只读）
  let db: Database.Database | null = null;
  try {
    db = new Database(dbPath, { readonly: true });
    
    // 统计记录数
    report.tableCounts = getAllTableCounts(db);
    
    // 检查外键
    report.foreignKeyChecks = checkForeignKeys(db);
    
    // 收集问题
    report.integrityIssues = collectIntegrityIssues(
      dbPath,
      fileInfo,
      report.tableCounts,
      report.foreignKeyChecks
    );
    
    // 生成摘要
    report.summary = generateSummary(report.tableCounts, report.integrityIssues);
    
  } catch (err) {
    console.error(`打开数据库失败: ${err}`);
    report.integrityIssues.push({
      severity: 'error',
      table: 'database',
      issue: '无法打开数据库',
      details: String(err),
    });
  } finally {
    if (db) {
      try {
        db.close();
      } catch {
        // ignore
      }
    }
  }

  // 输出报告
  console.log(formatReport(report));

  // 保存 JSON 报告
  const jsonPath = dbPath.replace(/\.db$/, '_integrity_report.json');
  try {
    fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf8');
    console.log(`\n详细报告已保存到: ${jsonPath}`);
  } catch (err) {
    console.warn(`无法保存 JSON 报告: ${err}`);
  }

  // 退出码
  if (report.summary.healthStatus === 'error') {
    process.exit(1);
  } else if (report.summary.healthStatus === 'warning') {
    process.exit(2);
  } else {
    process.exit(0);
  }
}

main().catch((err) => {
  console.error('检查失败:', err);
  process.exit(1);
});
