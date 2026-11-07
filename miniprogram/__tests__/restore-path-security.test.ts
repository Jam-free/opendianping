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
      expect(err.status).toBe(1);
      const output = err.stderr || err.stdout || '';
      expect(output).toContain('/data/');
    }
    
    // 验证目标文件未创建
    expect(fs.existsSync('/data/test.db')).toBe(false);
  });

  test('拒绝不安全路径（如/var/lib）', () => {
    try {
      execSync(
        `npx tsx "${RESTORE_SCRIPT}" --backup "${BACKUP_JSON}" --target /var/lib/test.db`,
        { encoding: 'utf8', stdio: 'pipe' }
      );
      fail('应该拒绝/var/lib路径');
    } catch (err: any) {
      expect(err.status).toBe(1);
      const output = err.stderr || err.stdout || '';
      expect(output).toContain('目标路径不安全');
    }
    
    // 验证目标文件未创建
    expect(fs.existsSync('/var/lib/test.db')).toBe(false);
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
      expect(err.status).toBe(1);
      const output = err.stderr || err.stdout || '';
      expect(output).toContain('/data/');
    }
    
    // 验证通过路径遍历无法绕过
    expect(fs.existsSync('/data/test.db')).toBe(false);
  });

  test('符号链接：拒绝指向/data/的符号链接', () => {
    const linkPath = path.join(TEST_DIR, 'symlink-to-data');
    
    // 创建指向/data/的符号链接（即使/data/不存在也可以创建）
    try {
      fs.symlinkSync('/data', linkPath, 'dir');
    } catch (err) {
      console.log('跳过符号链接测试：无法创建符号链接');
      return;
    }
    
    try {
      execSync(
        `npx tsx "${RESTORE_SCRIPT}" --backup "${BACKUP_JSON}" --target "${linkPath}/test.db"`,
        { encoding: 'utf8', stdio: 'pipe' }
      );
      fail('应该拒绝指向/data/的符号链接');
    } catch (err: any) {
      expect(err.status).toBe(1);
      // realpath会解析符号链接，检测到/data/
      const output = err.stderr || err.stdout || '';
      expect(output).toMatch(/data|路径不安全|无法解析/);
    } finally {
      if (fs.existsSync(linkPath)) {
        fs.unlinkSync(linkPath);
      }
    }
    
    // 验证目标文件未创建
    expect(fs.existsSync('/data/test.db')).toBe(false);
  });

  test('realpath规范化：处理多个/../', () => {
    try {
      execSync(
        `npx tsx "${RESTORE_SCRIPT}" --backup "${BACKUP_JSON}" --target /tmp/../../data/test.db`,
        { encoding: 'utf8', stdio: 'pipe' }
      );
      fail('应该拒绝/tmp/../../data/路径');
    } catch (err: any) {
      expect(err.status).toBe(1);
      const output = err.stderr || err.stdout || '';
      expect(output).toMatch(/data|路径不安全/);
    }
    
    // 验证路径遍历无法绕过安全检查
    expect(fs.existsSync('/data/test.db')).toBe(false);
  });

  test('NODE_ENV=production：拒绝运行', () => {
    try {
      execSync(
        `NODE_ENV=production npx tsx "${RESTORE_SCRIPT}" --backup "${BACKUP_JSON}" --target /tmp/test-prod.db`,
        { encoding: 'utf8', stdio: 'pipe' }
      );
      fail('应该拒绝在生产环境运行');
    } catch (err: any) {
      expect(err.status).toBe(1);
      const output = err.stderr || err.stdout || '';
      expect(output).toContain('NODE_ENV=production');
    }
    
    // 验证目标文件未创建
    expect(fs.existsSync('/tmp/test-prod.db')).toBe(false);
  });

  test('不存在的父目录：正确处理', () => {
    const nonExistentPath = '/tmp/nonexistent-dir-12345/subdir/test.db';
    
    // 确保父目录不存在
    const parentDir = path.dirname(nonExistentPath);
    if (fs.existsSync(parentDir)) {
      fs.rmSync(parentDir, { recursive: true });
    }
    
    // 应该因为父目录不存在而使用path.resolve，仍然允许/tmp/下的路径
    const output = execSync(
      `npx tsx "${RESTORE_SCRIPT}" --backup "${BACKUP_JSON}" --target "${nonExistentPath}"`,
      { encoding: 'utf8', stdio: 'pipe' }
    );
    
    // Dry-run应该成功（因为在/tmp/下）
    expect(output).toContain('DRY-RUN');
  });
});
