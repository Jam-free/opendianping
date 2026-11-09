# 美食肥猫 · SQLite → MySQL（Jam 控制台步骤）

> 这份说明给仓库主人 Jam。**本 PR 未合并、未改生产。** 合并/发版前请先在控制台把 MySQL 开好。

微信云托管官方说明：容器**不支持持久化存储**，扩缩容或重启后写在容器盘上的文件会被还原。所以生产不能再把店铺/收藏/Agent Token 放在 SQLite 文件里，要放到云托管 MySQL。

本地开发仍然默认 SQLite（`./data/miniprogram.db`）。

## 一、在控制台开通 MySQL

1. 打开微信云托管控制台 → 当前环境（`feimaocat`）→ **MySQL**。
2. 按提示开通。版本选 **8.0**（5.7 也能用）。密码自己设，**不要发到聊天/不要写进 GitHub**。
3. 等开通完成（几分钟）。记下：
   - **内网地址**（形如 `10.x.x.x:3306`）→ 填 `MYSQL_ADDRESS`
   - **用户名**（常见为 root 或你新建的账号）→ 填 `MYSQL_USERNAME`
   - **密码** → 填 `MYSQL_PASSWORD`
4. 点 **数据库管理**，登录后执行：

```sql
CREATE DATABASE IF NOT EXISTS feimaocat
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_unicode_ci;
```

完整表结构见 `miniprogram/sql/mysql-schema.sql`。应用第一次连上时也会自动建表，这条 `CREATE DATABASE` **必须先有**。

5. 建议在 MySQL 参数里 **关闭「自动暂停」**。否则 10 分钟没人用会休眠，下次请求可能报 `CynosDB ... resuming`（代码会重试，但用户会感到卡）。

官方文档：<https://developers.weixin.qq.com/miniprogram/dev/wxcloudservice/wxcloudrun/src/guide/mysql/>

## 二、给 feimaocat-api 注入环境变量

云托管 → 服务 `feimaocat-api` → 服务设置 / 环境变量。

| 变量 | 值 | 说明 |
|------|-----|------|
| `DB_BACKEND` | `mysql` | 生产走 MySQL，不要回退到容器盘 SQLite |
| `MYSQL_ADDRESS` | `HOST:PORT` | 控制台「内网地址」，不要用外网除非你清楚风险 |
| `MYSQL_USERNAME` | `<YOUR_MYSQL_USERNAME>` | 占位符，填控制台里的真实用户名 |
| `MYSQL_PASSWORD` | `<YOUR_MYSQL_PASSWORD>` | **只填控制台** |
| `MYSQL_DATABASE` | `feimaocat` | 必须和上面 CREATE DATABASE 一致 |
| `DEV_AUTH_BYPASS` | `false` | 生产关闭 |
| `EXPECTED_MIN_USERS` | 第一次切库用 `0`；导入成功后改成 `1` | 空库保护 |
| `PREVENT_EMPTY_DB_START` | `true` | 启动门禁 |

也可以只填一条（不要提交到仓库）：

```
DATABASE_URL=mysql://USER:PASSWORD@HOST:3306/feimaocat
```

模板部署有时会自动注入 `MYSQL_ADDRESS` / `MYSQL_USERNAME` / `MYSQL_PASSWORD`。若你是**手动开通** MySQL，这三个**不会自动出现**，必须自己贴进服务设置。

**不要**再依赖 `DB_PATH=/data/miniprogram.db` 当生产数据源。持久盘可以留着，但不是根治。

## 三、初始化表

发版后进程启动会 `CREATE TABLE IF NOT EXISTS`。也可以在「数据库管理」里粘贴 `miniprogram/sql/mysql-schema.sql`。

发版后立刻打开：`https://你的域名/health`

应看到类似：

```json
{
  "ok": true,
  "albumImport": true,
  "persistence": {
    "backend": "mysql",
    "dbPath": "mysql://USER@HOST:3306/feimaocat",
    "userCount": 0,
    "favoriteCount": 0,
    "agentTokenCount": 0
  }
}
```

`dbPath` 必须是 `mysql://...`，不能再是 `/data/miniprogram.db`。密码不会出现在 health 里。

若 `ok` 为 false 或业务接口 503：多半是还没注入连接串，或数据库名不存在，或 MySQL 还在冷启动。看容器日志搜 `[PERSISTENCE]`。

## 四、从快照导入（Jam 确认后再对生产写）

本机 2026-11-07 快照大约 59 家店（`fm_shops.json` / `inventory_fm_shops.csv`）。

在**能连到目标库**的机器上（本机 Docker MySQL，或你明确允许的环境）：

```bash
cd miniprogram

# 先看会写入什么（不改库）
npx tsx scripts/import-snapshot.ts --from /path/to/fm_shops.json

# 确认后再写。生产需要 Jam 点头后再加 --i-understand-production
npx tsx scripts/import-snapshot.ts --from /path/to/fm_shops.json --execute --user-id <登录后的用户ID>
```

备份 JSON（含 users/favorites 等整库）用：

```bash
npx tsx scripts/restore-db-safe.ts --from backup.json           # dry-run
npx tsx scripts/restore-db-safe.ts --from backup.json --target /tmp/check.db --execute
```

`restore-db-safe` 会拒绝 `/data/` 和 `NODE_ENV=production`。导出脱敏版：

```bash
npx tsx scripts/export-db-safe.ts --sqlite ./data/miniprogram.db --out /tmp/export.json
```

## 五、合并前检查清单

- [ ] 控制台已开通 MySQL 8.0，已 `CREATE DATABASE feimaocat`
- [ ] `feimaocat-api` 已配置 `DB_BACKEND=mysql` 和 `MYSQL_*`（密码只在控制台）
- [ ] 建议关闭 MySQL 自动暂停；`minNum` 最好为 1
- [ ] 本 PR 已审查；**Jam 明确说「合并/发版」之前不要 merge**
- [ ] 发版后 `/health` 的 `persistence.backend` 为 `mysql`
- [ ] 导入 59 家店：等 Jam 确认后再对生产 `--execute`
- [ ] 导入后把 `EXPECTED_MIN_USERS` 改为 `1`（或实际用户数）
- [ ] 旧 Agent Token 仍可能 401（库迁走后哈希不在新库里）；用户需在小程序里重新点「连接 AI」
- [ ] COS 备份（`BACKUP_BUCKET` 等）仍建议保留，作为 MySQL 之外的 JSON 快照

## 六、本地开发

```bash
cd miniprogram
# 不设 MYSQL_* 时默认 SQLite
npm run dev

# 可选：对本机 MySQL
# DATABASE_URL=mysql://feimaocat:password@127.0.0.1:3306/feimaocat npm run dev
```
