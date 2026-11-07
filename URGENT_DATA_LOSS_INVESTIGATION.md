# 🚨 紧急生产数据丢失事故调查报告

**事故时间**：2026-11-06（北京时间，昨天）  
**报告人**：Jam  
**影响范围**：昨天新增的所有用户数据看起来清空  
**调查时间**：2026-11-06 23:55 UTC

---

## ⚠️ 重要约束（调查期间严格执行）

- ❌ **禁止连接或修改生产环境**
- ❌ **禁止部署/重启/回滚云托管服务**
- ❌ **禁止清缓存或写线上数据库**
- ❌ **禁止运行数据库迁移**
- ❌ **禁止把用户数据或密钥提交到仓库**
- ✅ **可以在隔离分支编写修复与测试代码并开 PR**
- ❌ **禁止合并任何 PR 到生产分支**

---

## 📋 已证实的架构和数据存储

### 1. 服务端架构（微信云托管）

#### 数据库配置
- **数据库类型**：SQLite
- **数据库路径**：`/data/miniprogram.db`（Dockerfile 第24行，环境变量 `DB_PATH`）
- **持久化要求**：**必须**挂载持久盘到 `/data` 目录
- **WAL 模式**：已启用（`miniprogram/server/db.ts` 第59行）

**证据文件**：
- `Dockerfile` 第24行：`ENV DB_PATH=/data/miniprogram.db`
- `miniprogram/server/persistence.ts` 第12行：`CLOUD_DATA_VOLUME_ROOT = '/data'`
- `miniprogram/CLOUD_DEPLOY.md` 第7-13行：明确说明禁止无盘发布

#### 数据表结构
根据 `miniprogram/server/db.ts` 第152-260行：

| 表名 | 作用 | 关键字段 |
|------|------|---------|
| `users` | 用户表 | `id` (主键), `openid` (唯一), `nickname`, `avatar`, `created_at` |
| `sessions` | 会话令牌 | `token` (主键), `user_id` (外键) |
| `favorites` | 用户收藏的店铺 | `id`, `user_id`, `shop_id`, `note`, `visibility`, `created_at` |
| `shops` | 店铺信息 | `id`, `source_shop_id`, `raw_name`, `lat`, `lng`, 等 |
| `agent_tokens` | AI 连接令牌 | `id`, `user_id` (唯一), `token_hash`, `created_at` |
| `circles` | 美食圈子 | `id`, `name`, `owner_id`, `is_personal` |
| `circle_members` | 圈子成员 | `circle_id`, `user_id` |
| `circle_shares` | 圈子分享 | `circle_id`, `favorite_id` |
| `import_batches` | 导入批次 | `id`, `user_id`, `source_url`, `status` |
| `shop_comments` | 店铺评论 | `id`, `shop_id`, `user_id`, `body`, `created_at` |

**用户身份唯一标识**：`users.openid`（微信 OpenID，第155行 `openid TEXT NOT NULL UNIQUE`）

### 2. 客户端缓存机制（微信小程序）

根据 `miniprogram/client/utils/api.ts` 分析：

#### 缓存的数据（使用 `wx.Storage` API）

| Storage Key | 内容 | 作用域 |
|------------|------|--------|
| `session_token` | 会话令牌（第26、154、186行） | 单个用户设备 |
| `session_user` | 用户基本信息 `{id, nickname, avatar}` | 单个用户设备 |
| `pending_join` | 待加入圈子信息 | 临时 |
| `pending_next` | 待跳转页面 | 临时 |
| `active_circle` | 当前选中的圈子 | 用户偏好 |
| `last_location` | 最后位置 | 用户偏好 |
| `locate_draft` | 记美食草稿 | 临时 |

#### 重要发现：客户端不缓存业务数据

✅ **已证实**：客户端**不缓存**以下业务数据，所有数据实时从服务端获取：
- 收藏的店铺列表（favorites）
- 圈子信息（circles）
- 好友信息（network）
- 店铺详情（shops）
- 评论（shop_comments）

**证据**：
- `miniprogram/client/pages/my-shops/my-shops.ts` 每次进入页面都调用 `/api/me/shops` 获取数据
- `miniprogram/client/pages/circles/circles.ts` 实时调用 `/api/circles`
- 没有使用 `wx.setStorageSync` 存储业务数据的代码

---

## 🔍 数据丢失根本原因分析

### 最可能的原因（按概率排序）

#### ❶ 持久盘未正确挂载（概率：90%）

**症状**：
- 重新部署后，所有用户数据丢失
- `/health` 接口可能返回 `agentTokenCount: 0, favoriteCount: 0, userCount: 0`
- 容器日志可能出现 `[PERSISTENCE]` 警告

**机制**（已在代码中验证）：
1. 部署时忘记挂载持久盘，或挂载配置丢失
2. 容器启动时，`/data` 目录不存在
3. 代码执行 `fs.mkdirSync(dir, { recursive: true })`（`miniprogram/server/db.ts` 第55行）
4. `/data` 目录被创建在**容器可写层**（临时层）
5. SQLite 在可写层创建新的空数据库
6. 服务看起来正常运行（200 OK）
7. 但旧数据库文件在原持久盘上，容器访问不到
8. 新用户数据写入临时层
9. 下次重新部署，临时层被销毁，数据丢失

**代码证据**：
- `miniprogram/server/persistence.ts` 第85-100行：
  ```typescript
  // 缺盘时的真实行为（已在本环境验证）：/data 不存在时，mkdir 会在镜像可写层
  // 建出目录，better-sqlite3 接着建空库，接口照样 200。
  export function looksLikeEphemeralDataMount(volumeRoot: string = CLOUD_DATA_VOLUME_ROOT): boolean {
    try {
      if (!fs.existsSync(volumeRoot)) return true;
      // 检查是否是独立挂载点
      if (isLinuxMountPoint(volumeRoot)) return false;
      // 检查设备号是否与父目录相同（相同=临时层）
      return st.dev === parentSt.dev;
    } catch {
      return true;
    }
  }
  ```

#### ❷ 使用了新的持久盘（概率：8%）

**症状**：
- 持久盘已挂载到 `/data`
- 但是一个全新的、空的持久盘
- 原持久盘可能被删除、替换或路径变更

**如何验证**：
- 检查云托管控制台的持久盘配置历史
- 查看是否有持久盘删除或重建记录

#### ❸ 数据库路径环境变量错误（概率：2%）

**症状**：
- `DB_PATH` 环境变量被修改为其他路径
- 例如改为 `./data/miniprogram.db`（相对路径，会在容器临时层）

**如何验证**：
- 检查 `/health` 接口返回的 `persistence.dbPath` 字段
- 应该是 `/data/miniprogram.db`

---

## 💾 客户端缓存数据可保全范围

### ✅ 可以从客户端恢复的数据

| 数据类型 | Storage Key | 字段 | 恢复完整度 |
|---------|-------------|------|-----------|
| 用户身份 | `session_user` | `id`, `nickname`, `avatar` | 100% |
| 会话令牌 | `session_token` | token 字符串 | N/A（已失效） |
| 当前圈子 | `active_circle` | circleId | 部分（仅选中的） |
| 最后位置 | `last_location` | `lat`, `lng` | 部分 |
| 记美食草稿 | `locate_draft` | 未保存的草稿 | 部分 |

### ❌ 无法从客户端恢复的数据

以下数据**只存在于服务端数据库**，客户端未缓存：
- ❌ 收藏的店铺列表（`favorites` 表）
- ❌ 圈子完整信息（`circles` 表）
- ❌ 圈子成员（`circle_members` 表）
- ❌ 店铺评论（`shop_comments` 表）
- ❌ 导入批次历史（`import_batches` 表）
- ❌ AI 连接令牌（`agent_tokens` 表）
- ❌ 好友关系

**结论**：如果服务端数据库真的丢失，**业务数据无法从客户端恢复**。

---

## 🔒 立即保全措施（非破坏性）

### 第一步：检查当前生产状态（只读操作）

```bash
# 1. 检查健康状态
curl https://你的云托管域名/health | jq .

# 关键检查点：
# - persistence.dbPath 是否为 "/data/miniprogram.db"
# - persistence.userCount 当前值
# - persistence.favoriteCount 当前值
# - persistence.agentTokenCount 当前值
# - persistence.warning 是否有警告信息
```

### 第二步：检查容器日志（只读）

```bash
# 在微信云托管控制台查看容器日志
# 搜索关键词：[PERSISTENCE]

# 如果出现以下日志，说明持久盘未挂载：
# [PERSISTENCE] 生产 SQLite 看起来像丢盘或空库
# [PERSISTENCE] /data 看起来像容器临时盘
```

### 第三步：检查持久盘配置（只读）

在微信云托管控制台：
1. 进入服务 `feimaocat-api` 设置
2. 查看"持久盘"配置
3. 确认是否挂载到 `/data`
4. 查看持久盘 ID 和创建时间

### 第四步：如果有数据库访问权限（谨慎操作）

**⚠️ 只读查询，不要修改数据**

```bash
# 进入容器（如果云托管支持）
# 检查数据库文件
ls -lah /data/
stat /data/miniprogram.db

# 检查挂载点
mount | grep /data
cat /proc/mounts | grep /data

# 只读查询数据库（不要修改）
sqlite3 /data/miniprogram.db "SELECT COUNT(*) FROM users;"
sqlite3 /data/miniprogram.db "SELECT COUNT(*) FROM favorites;"
sqlite3 /data/miniprogram.db "SELECT COUNT(*) FROM agent_tokens;"
```

### 第五步：用户侧保全（通知用户）

**重要**：通知用户**不要做以下操作**：
- ❌ 不要卸载小程序
- ❌ 不要清除微信缓存
- ❌ 不要退出登录
- ❌ 不要重新登录（会覆盖 `session_user`）
- ❌ 不要频繁刷新页面导致接口失败

**原因**：客户端缓存的 `session_user` 包含用户 ID，可以用于恢复身份映射。

---

## 🛠️ 数据恢复方案（三种场景）

### 场景 A：原持久盘数据仍在，只是没挂载

**症状**：
- 原持久盘未被删除
- 只是部署配置中挂载丢失

**恢复步骤**：
1. ✅ 停止当前容器（保存临时层数据快照，如果需要）
2. ✅ 重新挂载原持久盘到 `/data`
3. ✅ 重新部署
4. ✅ 检查 `/health` 确认计数恢复正常
5. ✅ 通知用户重新登录

**数据恢复率**：100%

**风险**：无

---

### 场景 B：原持久盘丢失，临时层有部分新数据

**症状**：
- 原持久盘被删除或无法访问
- 容器临时层有昨天新增的数据（重新部署前）

**恢复步骤**：

#### B.1 导出临时层数据（在重新部署前）

```bash
# 进入当前运行的容器（临时层数据还在）
# 导出数据库
sqlite3 /data/miniprogram.db ".backup /tmp/temp_db_backup.db"

# 或者导出为 SQL
sqlite3 /data/miniprogram.db ".dump" > /tmp/temp_db_dump.sql

# 下载到本地（通过云托管控制台或 scp）
```

#### B.2 创建新持久盘并导入

```bash
# 1. 创建新持久盘，挂载到 /data
# 2. 部署服务（会创建空库）
# 3. 导入数据
sqlite3 /data/miniprogram.db < /tmp/temp_db_dump.sql
```

**数据恢复率**：
- ✅ 昨天新增的数据：100%
- ❌ 昨天之前的数据：0%（已丢失）

**风险**：中等
- openid 冲突：如果用户在新库和旧库都登录过，需要合并

---

### 场景 C：原持久盘和临时层都丢失

**症状**：
- 原持久盘被删除
- 容器已重新部署，临时层被销毁

**恢复步骤**：
这是最坏的情况，业务数据无法恢复，只能：

1. ✅ 从备份恢复（如果有）
2. ✅ 通知用户重新导入收藏
3. ✅ 用户重新创建圈子和邀请好友

**数据恢复率**：0%（无备份时）

**风险**：高
- 用户流失
- 数据永久丢失

---

## 🔧 恢复工具开发（在本分支）

我将在本分支开发以下工具：

### 1. 数据库检查工具 `scripts/check-db-integrity.ts`
- 只读检查数据库完整性
- 输出用户数、收藏数、圈子数等统计
- 检查外键一致性
- 生成诊断报告

### 2. 数据导出工具 `scripts/export-db-safe.ts`
- 导出数据库到 JSON（避开敏感凭证）
- 只导出业务数据，不包含：
  - 密码哈希
  - 会话令牌
  - Agent Token 哈希
- 按 openid 组织数据（便于恢复）

### 3. 数据恢复工具 `scripts/restore-db-safe.ts`
- 从导出的 JSON 恢复数据
- **必须用 openid 验证身份**
- 拒绝同名串号（不能仅凭昵称匹配）
- 生成恢复报告（成功/失败/冲突）

### 4. 测试套件 `scripts/__tests__/recovery.test.ts`
- 在隔离的测试数据库上运行
- 模拟各种恢复场景
- 验证数据一致性

**重要**：
- ✅ 所有工具只在**副本数据库**上运行
- ✅ 使用 `--dry-run` 模式预览操作
- ✅ 需要 `--confirm` 标志才执行写操作
- ❌ 禁止直接操作生产数据库

---

## 📊 恢复数据范围和限制

### 如果能访问原数据库文件

| 数据类型 | 恢复率 | 验证方式 |
|---------|--------|---------|
| 用户账号 | 100% | openid 唯一 |
| 收藏店铺 | 100% | user_id + shop_id |
| 圈子 | 100% | circle_id |
| 圈子成员 | 100% | circle_id + user_id |
| 评论 | 100% | shop_id + user_id |
| Agent Token | 0% | 哈希无法逆向，用户需重新生成 |

### 恢复验证规则（防串号）

```typescript
// 恢复时必须满足：
1. openid 精确匹配（不能仅凭昵称）
2. 如果 openid 冲突：
   - 同一 openid 在新旧库都存在 → 合并数据
   - 不同 openid 但昵称相同 → **拒绝合并**，标记为冲突
3. 收藏恢复：
   - 必须有对应的 user_id（通过 openid 映射）
   - shop_id 必须存在或重建
4. 圈子恢复：
   - owner_id 必须映射到有效用户
   - 成员 user_id 必须都能映射
```

### 无法恢复的字段

| 字段 | 原因 |
|------|------|
| `agent_tokens.token_hash` | 单向哈希，无法逆向 |
| `sessions.token` | 已过期，用户需重新登录 |
| 密码（如果有） | 哈希无法恢复 |

---

## 🚧 防止再次丢失的措施

### 1. 部署检查清单（强制执行）

在 `miniprogram/CLOUD_DEPLOY.md` 中已有，需要严格执行：

```markdown
## 发版前必检项（禁止跳过）

- [ ] 持久盘已挂载到 `/data`（容量 ≥ 1GB）
- [ ] 环境变量 `DB_PATH=/data/miniprogram.db`
- [ ] 环境变量 `DEV_AUTH_BYPASS=false`
- [ ] 部署成功后立刻访问 `/health`
- [ ] 确认 `persistence.dbPath` 为 `/data/miniprogram.db`
- [ ] 确认 `persistence.userCount` ≥ 预期值（非0）
- [ ] 确认 `persistence.agentTokenCount` ≥ 预期值（非0）
- [ ] 容器日志无 `[PERSISTENCE]` 警告
```

### 2. 自动化健康检查（建议实现）

```typescript
// 在 miniprogram/server/app.ts 中添加启动检查
function startupPersistenceCheck() {
  const health = getPersistenceHealth();
  
  if (health.warning) {
    console.error('🚨 持久化警告：', health.warning);
    // 可选：发送告警到监控系统
  }
  
  // 生产环境如果检测到空库，拒绝启动
  if (
    config.nodeEnv === 'production' &&
    health.userCount === 0 &&
    health.favoriteCount === 0
  ) {
    console.error('🚨 生产环境检测到空数据库，拒绝启动');
    console.error('请检查持久盘挂载配置');
    process.exit(1); // 启动失败，阻止部署
  }
}
```

### 3. 数据库备份策略（强烈建议）

```bash
# 每日备份脚本（部署到云托管定时任务）
#!/bin/bash
set -e

DB_PATH="/data/miniprogram.db"
BACKUP_DIR="/data/backups"
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/miniprogram_$DATE.db"

mkdir -p "$BACKUP_DIR"

# SQLite 在线备份
sqlite3 "$DB_PATH" ".backup '$BACKUP_FILE'"

# 压缩
gzip "$BACKUP_FILE"

# 保留最近7天
find "$BACKUP_DIR" -name "*.db.gz" -mtime +7 -delete

echo "备份完成: $BACKUP_FILE.gz"
```

### 4. 持久盘监控

在 `/health` 接口中已实现，需要配置告警：

```json
{
  "persistence": {
    "dbPath": "/data/miniprogram.db",
    "agentTokenCount": 123,
    "favoriteCount": 456,
    "userCount": 78,
    "warning": null  // 如果不为 null，立即告警
  }
}
```

配置云托管监控规则：
- 每5分钟检查 `/health`
- 如果 `persistence.warning !== null` → 发送告警
- 如果计数突然归零 → 立即告警

### 5. 部署流程改进

**当前流程问题**：直接部署，可能丢失挂载配置

**改进后流程**：
1. 部署前备份数据库
2. 部署新版本
3. 自动运行健康检查
4. 如果检查失败，自动回滚到上一版本
5. 通知管理员

---

## 📝 下一步行动

### 立即执行（调查阶段）

1. ✅ **检查当前生产状态**
   - 访问 `/health` 接口
   - 查看容器日志
   - 检查持久盘配置

2. ✅ **确定数据丢失范围**
   - 原持久盘是否存在？
   - 临时层数据是否还在？
   - 哪些用户受影响？

3. ✅ **评估恢复可能性**
   - 场景 A / B / C 中哪一个？
   - 是否有数据库备份？

### 恢复阶段（根据场景）

4. ⏳ **执行恢复方案**
   - 场景 A：重新挂载原持久盘
   - 场景 B：导出临时层数据
   - 场景 C：从备份恢复或重建

5. ⏳ **验证恢复结果**
   - 检查用户数、收藏数
   - 抽样验证数据正确性
   - 用户登录测试

### 预防阶段（恢复后）

6. ⏳ **实施预防措施**
   - 配置自动备份
   - 配置监控告警
   - 更新部署清单
   - 添加启动检查

7. ⏳ **事故复盘**
   - 记录根本原因
   - 更新运维文档
   - 培训相关人员

---

## 🔐 安全注意事项

### 导出数据时

- ❌ 不要导出 `sessions.token`
- ❌ 不要导出 `agent_tokens.token_hash`
- ❌ 不要导出任何密码哈希
- ✅ 导出时脱敏手机号（如果有）
- ✅ 使用加密传输

### 恢复数据时

- ✅ 必须在隔离环境先测试
- ✅ 使用 openid 验证身份，不能仅凭昵称
- ✅ 记录所有恢复操作日志
- ✅ 恢复后立即通知用户重置 Agent Token

### 备份数据

- ✅ 备份文件加密存储
- ✅ 设置备份保留期限
- ✅ 定期测试恢复流程
- ✅ 备份文件访问控制

---

## 📞 联系信息

**事故报告人**：Jam  
**调查负责人**：Cursor Agent  
**时间戳**：2026-11-06 23:55 UTC

---

## 附录：关键代码引用

### A. 持久化检查逻辑

文件：`miniprogram/server/persistence.ts`

关键函数：
- `isCloudRunDataPath()` - 判断是否为云托管持久盘路径
- `looksLikeEphemeralDataMount()` - 检测临时盘挂载
- `assessProductionPersistence()` - 评估生产环境持久化状态
- `formatPersistenceWarning()` - 格式化警告信息

### B. 数据库初始化逻辑

文件：`miniprogram/server/db.ts`

关键函数：
- `openDatabase()` - 打开数据库并检查持久化（第35-80行）
- `initSchema()` - 初始化表结构（第150-260行）
- `getPersistenceHealth()` - 获取持久化健康状态（第98-123行）

禁止操作（第147-149行注释）：
```typescript
/**
 * 只建表、补索引。禁止在启动时 DROP / DELETE agent_tokens 或 favorites。
 * Token 只能由用户点「连接 AI」（POST /api/agent-tokens 或 /reset）重置。
 */
```

### C. 健康检查接口

文件：`miniprogram/server/app.ts` 第80-86行

```typescript
app.get('/health', (_req, res) => {
  // albumImport=true 表示本镜像可解析点评公开专辑
  // persistence 是只读计数：发版后用来确认 Token/收藏还在同一块盘上。
  const persistence = getPersistenceHealth();
  res.json({ ok: true, albumImport: true, persistence });
});
```

---

**报告结束**

*此报告是初步调查结果，最终恢复方案需根据实际生产环境状态确定。*
