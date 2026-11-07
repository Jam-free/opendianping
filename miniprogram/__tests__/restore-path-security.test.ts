/**
 * 恢复工具路径安全测试
 * 
 * 测试路径规范化、符号链接和安全检查
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TEST_DIR = '/tmp/path-security-test';
const RESTORE_SCRIPT = path.resolve(__dirname, '../scripts/restore-db-safe.ts');
const BACKUP_JSON = path.join(TEST_DIR, 'backup.json');

function setup() {
  if (fs.existsSync(TEST_DIR)) {
    fs.rmSync(TEST_DIR, { recursive: true });
  }
  fs.mkdirSync(TEST_DIR, { recursive: true });
  
  // 创建测试备份
  fs.writeFileSync(BACKUP_JSON, JSON.stringify({
    exportedAt: new Date().toISOString(),
    users: [],
    favorites: [],
  }));
}

describe('路径安全测试', () => {
  beforeAll(() => {
    setup();
  });

  afterAll(() => {
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true });
    }
  });

  test('拒绝/data/路径（生产路径）', () => {
    try {
      execSync(
        `npx tsx "${RESTORE_SCRIPT}" --backup "${BACKUP_JSON}" --target /data/test.db`,
        { encoding: 'utf8', stdio: 'pipe' }
      );
      fail('应该拒绝/data/路径');
    } catch (err: any) {
      expect(err.stdout).toContain('禁止写入 /data/ 路径');
    }
  });

  test('拒绝不安全路径（如/var/lib）', () => {
    try {
      execSync(
        `npx tsx "${RESTORE_SCRIPT}" --backup "${BACKUP_JSON}" --target /var/lib/test.db`,
        { encoding: 'utf8', stdio: 'pipe' }
      );
      fail('应该拒绝/var/lib路径');
    } catch (err: any) {
      expect(err.stdout).toContain('目标路径不安全');
    }
  });

  test('允许/tmp/路径', () => {
    const output = execSync(
      `npx tsx "${RESTORE_SCRIPT}" --backup "${BACKUP_JSON}" --target /tmp/test-safe.db`,
      { encoding: 'utf8', stdio: 'pipe' }
    );
    
    expect(output).toContain('DRY-RUN');
    expect(output).not.toContain('目标路径不安全');
  });

  test('允许./tmp/路径（相对路径）', () => {
    const output = execSync(
      `npx tsx "${RESTORE_SCRIPT}" --backup "${BACKUP_JSON}" --target ./tmp/test-safe.db`,
      { encoding: 'utf8', stdio: 'pipe', cwd: '/tmp' }
    );
    
    expect(output).toContain('DRY-RUN');
    expect(output).not.toContain('目标路径不安全');
  });

  test('路径规范化：拒绝通过..绕过安全检查', () => {
    try {
      execSync(
        `npx tsx "${RESTORE_SCRIPT}" --backup "${BACKUP_JSON}" --target /tmp/../data/test.db`,
        { encoding: 'utf8', stdio: 'pipe' }
      );
      fail('应该拒绝/tmp/../data/路径');
    } catch (err: any) {
      expect(err.stdout).toContain('禁止写入 /data/ 路径');
    }
  });

  test('符号链接：拒绝指向/data/的符号链接', () => {
    const linkPath = path.join(TEST_DIR, 'symlink-to-data');
    
    // 创建指向/data/的符号链接（如果/data/存在）
    // 注意：如果/data/不存在，符号链接仍然可以创建
    try {
      fs.symlinkSync('/data', linkPath);
    } catch (err) {
      // /data 可能不存在，跳过这个测试
      console.log('跳过符号链接测试：/data 目录不存在');
      return;
    }
    
    try {
      execSync(
        `npx tsx "${RESTORE_SCRIPT}" --backup "${BACKUP_JSON}" --target "${linkPath}/test.db"`,
        { encoding: 'utf8', stdio: 'pipe' }
      );
      fail('应该拒绝指向/data/的符号链接');
    } catch (err: any) {
      // 应该在路径规范化后检测到/data/
      expect(err.stdout).toContain('路径不安全');
    } finally {
      if (fs.existsSync(linkPath)) {
        fs.unlinkSync(linkPath);
      }
    }
  });

  test('realpath规范化：处理多个/../', () => {
    try {
      execSync(
        `npx tsx "${RESTORE_SCRIPT}" --backup "${BACKUP_JSON}" --target /tmp/../../data/test.db`,
        { encoding: 'utf8', stdio: 'pipe' }
      );
      fail('应该拒绝/tmp/../../data/路径');
    } catch (err: any) {
      expect(err.stdout).toContain('路径');
    }
  });

  test('NODE_ENV=production：拒绝运行', () => {
    try {
      execSync(
        `NODE_ENV=production npx tsx "${RESTORE_SCRIPT}" --backup "${BACKUP_JSON}" --target /tmp/test.db`,
        { encoding: 'utf8', stdio: 'pipe' }
      );
      fail('应该拒绝在生产环境运行');
    } catch (err: any) {
      expect(err.stdout).toContain('NODE_ENV=production');
    }
  });
});
