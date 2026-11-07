# 持久化防御加固 — 交付报告

日期：2026-11-07

## 改动文件清单

| 文件 | 说明 |
|------|------|
| `miniprogram/server/persistence.ts` | 降级文案、`ALLOW_EPHEMERAL_WRITES` 判定 |
| `miniprogram/server/backup.ts` | **新增** COS 备份/恢复、写库 dirty 挂钩、debounce |
| `miniprogram/server/db.ts` | 降级模式、`startupDatabase`、COS 自愈启动序 |
| `miniprogram/server/app.ts` | 全局 503 中间件；`/health` 降级时 `ok:false` |
| `miniprogram/server/index.ts` | 异步启动、`SIGTERM`/`SIGINT` 触发备份 |
| `miniprogram/server/config.ts` | `DB_PATH=:memory:` 不再被 `path.resolve` 污染 |
| `miniprogram/__tests__/persistence-hardening.test.ts` | **新增** 三层防御测试 |
| `miniprogram/package.json` / `package-lock.json` | 依赖 `cos-nodejs-sdk-v5` |

未触碰 `miniprogram/client/`。

## 业务表清单（备份 `tables` 全集）

与 `initSchema` + `migrateSchema` 一致（`BACKUP_SCHEMA_VERSION=1`）：

1. `users`
2. `shops`
3. `sessions`
4. `import_batches`
5. `circles`
6. `favorites`
7. `circle_members`
8. `circle_shares`
9. `agent_tokens`
10. `shop_comments`

## 新增 / 相关环境变量

| 变量 | 必需 | 默认 | 用途 |
|------|------|------|------|
| `ALLOW_EPHEMERAL_WRITES` | 否 | `false` | `true` 时跳过临时盘降级（本地开发） |
| `TENCENTCLOUD_SECRETID` | 备份时必需 | — | COS SecretId |
| `TENCENTCLOUD_SECRETKEY` | 备份时必需 | — | COS SecretKey |
| `BACKUP_BUCKET` | 备份时必需 | — | 存储桶名称 |
| `BACKUP_REGION` | 否 | `ap-guangzhou` | COS 地域 |
| `BACKUP_PREFIX` | 否 | `backups` | 对象键前缀 |

凭证缺失时启动打 `[BACKUP] COS 备份未配置——实例替换时数据仍会丢失`，主流程继续。

## 本地冒烟

```bash
cd miniprogram
ALLOW_EPHEMERAL_WRITES=true DB_PATH=:memory: PORT=18787 npx tsx server/index.ts
# 另开终端：
curl -s http://127.0.0.1:18787/health
```

示例响应：

```json
{"ok":true,"albumImport":true,"persistence":{"dbPath":":memory:","agentTokenCount":0,"favoriteCount":0,"userCount":0,"warning":null}}
```

未配置 COS 时可见 `[BACKUP] COS 备份未配置...` 启动日志（符合预期）。

## 测试结果（`cd miniprogram && npm test` 原文）

```
> opendianping-miniprogram@0.1.0 test
> NODE_OPTIONS=--experimental-vm-modules jest --config jest.config.cjs

Test Suites: 1 failed, 9 passed, 10 total
Tests:       2 failed, 87 passed, 89 total
Snapshots:   0 total
Time:        9.087 s
Ran all test suites.
```

**本轮新增** `persistence-hardening.test.ts` 共 6 例全部通过。

**仍失败 2 例**（`__tests__/agent-shops-write.test.ts`，与本次改动无关：`miniprogram/server/services/network.ts` 未修改；单独跑该文件同样失败）：

- `E2E-A4 / S5-SEC-02`：`source_shop_id` 期望 `null`，实际为点评 id 字符串
- `朋友已分享的店…`：`sourceTag` 期望 `吴双推荐`，实际 `来自吴双`

建议合入前在分支上对齐 Agent 文案/POI 规则与用例，或另 PR 修复。

`cos-nodejs-sdk-v5` 已在本地 `npm install` 成功；Jest 在 stub 存储下运行，未连外网 COS。

## 三层防御行为摘要

1. **临时盘拒写**：云路径 + `looksLikeEphemeralDataMount()` → 除 `/health` 外一律 **503** + 固定 JSON；请求日志 `[PERSISTENCE] 拒绝业务请求 path=...`。
2. **COS 备份**：`database.prepare` 层对 `INSERT/UPDATE/DELETE/REPLACE` 挂钩 `markBackupDirty`；**60s debounce** 全库 JSON 上传；保留 **20** 份；`SIGTERM` **强制 dump**。
3. **启动自愈**：真卷 + 新库/三表皆空 → 拉最新备份；`schemaVersion` 不匹配则 **ERROR 并跳过**；临时盘 **不恢复**。

## 已知限制与后续建议

- 备份通过 hook `Statement.run` 实现，不经 `database.exec` 的写入不会标 dirty（当前业务路径均走 `prepare().run`）。
- COS 客户端动态 `import`，仅在实际启用备份时加载。
- 恢复为 **全表替换式**（`DELETE` + `INSERT`），大库时需关注 brief 锁表窗口；当前数据量 KB 级可接受。
- 建议在云托管配置中补齐 COS 三要素，并监控 `[BACKUP]` / `[PERSISTENCE]` 日志告警。
- `.env.example` 尚未写入新变量（可 follow-up 文档 PR）。

## Git

按任务要求：**未** `git add` / `commit` / `push`。工作区仍含既有 `client/` 未提交改动（另一条线），与本次无关。
