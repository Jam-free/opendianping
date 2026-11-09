#!/usr/bin/env tsx
/**
 * 发版前静态检查：生产必须走 MySQL，仓库里不能出现真实密码。
 * 用法（仓库根或 miniprogram/ 下）： npx tsx miniprogram/scripts/pre-deploy-check.ts
 */
import fs from 'node:fs';
import path from 'node:path';

type Severity = 'error' | 'warning' | 'info';

type CheckResult = {
  name: string;
  passed: boolean;
  severity: Severity;
  message: string;
  suggestion?: string;
};

function repoRoot(): string {
  const cwd = process.cwd();
  if (fs.existsSync(path.join(cwd, 'miniprogram/container.config.json'))) return cwd;
  if (fs.existsSync(path.join(cwd, 'container.config.json'))) {
    return path.resolve(cwd, '..');
  }
  return cwd;
}

function readJson(file: string): Record<string, unknown> | null {
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
}

function looksLikeSecret(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  if (!value) return false;
  if (/PASSWORD|SECRET|TOKEN|passwd/i.test(value) && value.length > 8) return true;
  if (value.startsWith('mysql://') && /:.+@/.test(value)) return true;
  return false;
}

function run(): CheckResult[] {
  const root = repoRoot();
  const results: CheckResult[] = [];
  const configPath = path.join(root, 'miniprogram/container.config.json');
  const envExample = path.join(root, 'miniprogram/.env.example');
  const dockerfile = path.join(root, 'Dockerfile');
  const mpDockerfile = path.join(root, 'miniprogram/Dockerfile');

  const config = readJson(configPath);
  if (!config) {
    results.push({
      name: 'container_config',
      passed: false,
      severity: 'error',
      message: '未找到 miniprogram/container.config.json',
    });
    return results;
  }

  const envParams = (config.envParams || {}) as Record<string, string>;

  if ((envParams.DB_BACKEND || '').toLowerCase() !== 'mysql') {
    results.push({
      name: 'db_backend_mysql',
      passed: false,
      severity: 'error',
      message: `container.config.json 未声明 DB_BACKEND=mysql（当前 ${envParams.DB_BACKEND || '(空)'}）`,
      suggestion:
        '微信云托管容器盘不能持久化 SQLite。生产必须 DB_BACKEND=mysql，并在控制台注入 MYSQL_ADDRESS / MYSQL_USERNAME / MYSQL_PASSWORD。',
    });
  } else {
    results.push({
      name: 'db_backend_mysql',
      passed: true,
      severity: 'info',
      message: '✅ 已声明 DB_BACKEND=mysql',
    });
  }

  if (!envParams.MYSQL_DATABASE) {
    results.push({
      name: 'mysql_database',
      passed: false,
      severity: 'error',
      message: '缺少 MYSQL_DATABASE',
      suggestion: '填写 feimaocat（需在云托管 MySQL 里先 CREATE DATABASE）',
    });
  } else {
    results.push({
      name: 'mysql_database',
      passed: true,
      severity: 'info',
      message: `✅ MYSQL_DATABASE=${envParams.MYSQL_DATABASE}`,
    });
  }

  for (const key of [
    'MYSQL_PASSWORD',
    'MYSQL_USERNAME',
    'MYSQL_ADDRESS',
    'DATABASE_URL',
    'WECHAT_APP_SECRET',
  ]) {
    if (envParams[key]) {
      results.push({
        name: `no_secret_${key}`,
        passed: false,
        severity: 'error',
        message: `container.config.json 里出现了 ${key}。真实连接信息只能填控制台，不能进仓库。`,
      });
    }
  }

  if (envParams.DEV_AUTH_BYPASS === 'true') {
    results.push({
      name: 'dev_auth',
      passed: false,
      severity: 'error',
      message: 'DEV_AUTH_BYPASS=true 不能用于生产',
    });
  } else {
    results.push({
      name: 'dev_auth',
      passed: true,
      severity: 'info',
      message: '✅ DEV_AUTH_BYPASS 已关闭',
    });
  }

  if (!fs.existsSync(envExample) || !fs.readFileSync(envExample, 'utf8').includes('MYSQL_ADDRESS')) {
    results.push({
      name: 'env_example',
      passed: false,
      severity: 'error',
      message: '.env.example 未文档化 MYSQL_* / DATABASE_URL',
    });
  } else {
    results.push({
      name: 'env_example',
      passed: true,
      severity: 'info',
      message: '✅ .env.example 已说明 MySQL 变量（占位符）',
    });
  }

  for (const file of [dockerfile, mpDockerfile, configPath, envExample]) {
    if (!fs.existsSync(file)) continue;
    const text = fs.readFileSync(file, 'utf8');
    if (/mysql:\/\/[^:]+:[^@]+@/.test(text) || /MYSQL_PASSWORD=\s*[^<\s#]+/.test(text)) {
      const lineHasPlaceholder = /MYSQL_PASSWORD=.*(<YOUR_|changeme|placeholder)/i.test(text);
      if (!lineHasPlaceholder && looksLikeSecret(text)) {
        results.push({
          name: `secret_in_${path.basename(file)}`,
          passed: false,
          severity: 'error',
          message: `${path.relative(root, file)} 疑似含真实数据库密码，请改成占位符`,
        });
      }
    }
  }

  if (config.minNum === 0) {
    results.push({
      name: 'min_num',
      passed: false,
      severity: 'warning',
      message: 'minNum=0：实例缩到 0 后，云托管 Serverless MySQL 可能暂停，下次请求会遇到 resuming',
      suggestion: '建议 minNum=1，并在 MySQL 控制台关闭「自动暂停」',
    });
  }

  results.push({
    name: 'sqlite_not_production',
    passed: true,
    severity: 'info',
    message:
      '官方 FAQ：容器不支持持久化存储。生产根治方案是 MySQL，而不是再挂一块盘给 SQLite。',
  });

  return results;
}

export function runPreDeployCheck(): CheckResult[] {
  return run();
}

export function formatPreDeployResults(results: CheckResult[]): {
  text: string;
  failed: number;
  warnings: number;
} {
  const lines: string[] = [];
  for (const r of results) {
    const mark = r.passed ? '✅' : r.severity === 'warning' ? '⚠️ ' : '❌';
    lines.push(`${mark} [${r.name}] ${r.message}`);
    if (r.suggestion) lines.push(`   → ${r.suggestion}`);
  }
  const failed = results.filter((r) => !r.passed && r.severity === 'error').length;
  const warnings = results.filter((r) => !r.passed && r.severity === 'warning').length;
  if (failed) {
    lines.push(
      `\n检查失败：${failed} 个错误，${warnings} 个警告。禁止把 SQLite 当生产持久化。`
    );
  } else {
    lines.push(
      `\n检查通过（${warnings} 个警告）。合并前请确认控制台已开通 MySQL 并注入连接串。`
    );
  }
  return { text: lines.join('\n'), failed, warnings };
}

function isDirectRun(): boolean {
  const argv1 = process.argv[1];
  if (!argv1) return false;
  return path.basename(argv1).includes('pre-deploy-check');
}

if (isDirectRun()) {
  const results = run();
  const formatted = formatPreDeployResults(results);
  console.log(formatted.text);
  process.exit(formatted.failed ? 1 : 0);
}
