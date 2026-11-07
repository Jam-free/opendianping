#!/usr/bin/env tsx
/**
 * 部署前强制检查清单
 * 
 * 用途：
 * - 在部署前验证 container.config.json 配置
 * - 确保持久盘挂载配置存在
 * - 确保环境变量正确
 * - 可集成到 CI/CD 流程
 * 
 * 用法：
 *   npx tsx miniprogram/scripts/pre-deploy-check.ts
 * 
 * 退出码：
 *   0 - 所有检查通过
 *   1 - 检查失败，禁止部署
 */

import fs from 'node:fs';
import path from 'node:path';

interface ContainerConfig {
  volumeMounts?: Record<string, {
    sizeInGiB?: number;
    mountType?: string;
  }>;
  envParams?: {
    DB_PATH?: string;
    PREVENT_EMPTY_DB_START?: string;
    NODE_ENV?: string;
  };
  minNum?: number;
  dockerfilePath?: string;
}

interface CheckResult {
  name: string;
  passed: boolean;
  severity: 'error' | 'warning' | 'info';
  message: string;
  suggestion?: string;
}

function checkContainerConfig(): CheckResult[] {
  const results: CheckResult[] = [];
  const configPath = path.join(process.cwd(), 'miniprogram/container.config.json');
  
  if (!fs.existsSync(configPath)) {
    results.push({
      name: 'config_exists',
      passed: false,
      severity: 'error',
      message: '未找到 miniprogram/container.config.json',
      suggestion: '请确保在正确的目录运行此脚本',
    });
    return results;
  }

  let config: ContainerConfig;
  try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (err) {
    results.push({
      name: 'config_parse',
      passed: false,
      severity: 'error',
      message: `无法解析 container.config.json: ${err}`,
    });
    return results;
  }

  // 检查：SQLite 容器存储不可靠（官方证据）
  results.push({
    name: 'sqlite_unreliable',
    passed: false,
    severity: 'error',
    message: '❌ SQLite 容器存储不可靠（官方证据）',
    suggestion: `
微信云托管官方FAQ明确：
"容器不支持持久化存储……容器扩缩容/重启自愈时，这些写入的文件会被还原"

来源：https://developers.weixin.qq.com/miniprogram/dev/wxcloudservice/wxcloudrun/src/guide/service/faq.html
更新：2026-08-24

当前 SQLite 架构存在数据丢失风险：
❌ 扩缩容时数据丢失
❌ 重启自愈时数据丢失
❌ minNum=1 仅避免冷启动，不保证持久化

官方推荐方案：迁移到独立 MySQL
- VPC 内网连接
- 控制台创建
- 需要配置备份计划

详见：OFFICIAL_DOCS_VERIFIED.md

⚠️  在迁移到MySQL前，禁止部署到生产
`,
  });

  // 检查 2：DB_PATH 必须指向持久盘
  const dbPath = config.envParams?.DB_PATH;
  if (!dbPath) {
    results.push({
      name: 'db_path_exists',
      passed: false,
      severity: 'error',
      message: '环境变量缺少 DB_PATH',
      suggestion: '添加: "DB_PATH": "/data/miniprogram.db"',
    });
  } else if (dbPath !== '/data/miniprogram.db') {
    results.push({
      name: 'db_path_value',
      passed: false,
      severity: 'error',
      message: `DB_PATH 错误: ${dbPath}`,
      suggestion: '必须为: /data/miniprogram.db',
    });
  } else {
    results.push({
      name: 'db_path_value',
      passed: true,
      severity: 'info',
      message: '✅ DB_PATH 配置正确: /data/miniprogram.db',
    });
  }

  // 检查 3：PREVENT_EMPTY_DB_START 建议启用
  const preventEmpty = config.envParams?.PREVENT_EMPTY_DB_START;
  if (preventEmpty === 'false') {
    results.push({
      name: 'prevent_empty_start',
      passed: false,
      severity: 'warning',
      message: 'PREVENT_EMPTY_DB_START 已禁用',
      suggestion: '生产环境建议设置为 "true"，防止空库启动',
    });
  } else if (preventEmpty !== 'true') {
    results.push({
      name: 'prevent_empty_start',
      passed: false,
      severity: 'warning',
      message: 'PREVENT_EMPTY_DB_START 未设置（默认启用）',
      suggestion: '建议显式设置为 "true"',
    });
  } else {
    results.push({
      name: 'prevent_empty_start',
      passed: true,
      severity: 'info',
      message: '✅ 启动保护已启用',
    });
  }

  // 检查 4：minNum 建议 >= 1
  if (config.minNum === 0) {
    results.push({
      name: 'min_num',
      passed: false,
      severity: 'warning',
      message: 'minNum = 0，容器可能完全停止',
      suggestion: '建议设置为 1，保持至少一个实例运行',
    });
  } else {
    results.push({
      name: 'min_num',
      passed: true,
      severity: 'info',
      message: `✅ minNum = ${config.minNum}，保持实例运行`,
    });
  }

  // 检查 5：Dockerfile 路径
  if (config.dockerfilePath !== 'miniprogram/Dockerfile') {
    results.push({
      name: 'dockerfile_path',
      passed: false,
      severity: 'warning',
      message: `dockerfilePath 非标准: ${config.dockerfilePath}`,
      suggestion: '建议使用: miniprogram/Dockerfile',
    });
  }

  return results;
}

function checkDockerfile(): CheckResult[] {
  const results: CheckResult[] = [];
  const dockerfilePath = path.join(process.cwd(), 'miniprogram/Dockerfile');

  if (!fs.existsSync(dockerfilePath)) {
    results.push({
      name: 'dockerfile_exists',
      passed: false,
      severity: 'error',
      message: '未找到 miniprogram/Dockerfile',
    });
    return results;
  }

  const content = fs.readFileSync(dockerfilePath, 'utf8');

  // 检查是否设置了 DB_PATH 环境变量
  if (!/ENV\s+DB_PATH=\/data\/miniprogram\.db/i.test(content)) {
    results.push({
      name: 'dockerfile_db_path',
      passed: false,
      severity: 'warning',
      message: 'Dockerfile 中未设置 ENV DB_PATH=/data/miniprogram.db',
      suggestion: '建议在 Dockerfile 中设置默认值',
    });
  } else {
    results.push({
      name: 'dockerfile_db_path',
      passed: true,
      severity: 'info',
      message: '✅ Dockerfile DB_PATH 默认值正确',
    });
  }

  return results;
}

function printResults(results: CheckResult[]): void {
  const errors = results.filter((r) => r.severity === 'error' && !r.passed);
  const warnings = results.filter((r) => r.severity === 'warning' && !r.passed);
  const infos = results.filter((r) => r.severity === 'info' && r.passed);

  console.log('');
  
  // 打印成功项
  if (infos.length > 0) {
    for (const result of infos) {
      console.log(result.message);
    }
    console.log('');
  }

  // 打印警告
  if (warnings.length > 0) {
    console.log('⚠️  警告：');
    for (const result of warnings) {
      console.log(`   ${result.message}`);
      if (result.suggestion) {
        console.log(`   建议: ${result.suggestion}`);
      }
      console.log('');
    }
  }

  // 打印错误
  if (errors.length > 0) {
    console.log('❌ 错误：');
    for (const result of errors) {
      console.log(`   ${result.message}`);
      if (result.suggestion) {
        console.log(`   解决: ${result.suggestion}`);
      }
      console.log('');
    }
  }
}

function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('         部署前强制检查');
  console.log('═══════════════════════════════════════════════════════════');

  const allResults: CheckResult[] = [];

  console.log('\n检查 container.config.json...');
  allResults.push(...checkContainerConfig());

  console.log('检查 Dockerfile...');
  allResults.push(...checkDockerfile());

  printResults(allResults);

  const hasErrors = allResults.some((r) => r.severity === 'error' && !r.passed);
  const hasWarnings = allResults.some((r) => r.severity === 'warning' && !r.passed);

  console.log('───────────────────────────────────────────────────────────');
  
  if (hasErrors) {
    console.log('❌ 检查失败，禁止部署');
    console.log('   请修复上述错误后再部署');
    console.log('═══════════════════════════════════════════════════════════');
    process.exit(1);
  } else if (hasWarnings) {
    console.log('⚠️  检查通过但有警告');
    console.log('   建议修复警告项以获得最佳安全性');
    console.log('═══════════════════════════════════════════════════════════');
    process.exit(0);
  } else {
    console.log('✅ 所有检查通过，可以安全部署');
    console.log('═══════════════════════════════════════════════════════════');
    process.exit(0);
  }
}

main();
