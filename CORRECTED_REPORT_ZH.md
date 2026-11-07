# 🚨 数据丢失事故调查与修复报告（已修正）

**报告时间**：2026-11-07 00:08 UTC  
**报告人**：Cursor Agent  
**状态**：⚠️ 高风险假设已识别，修复需官方验证

---

## ⚠️ 重要声明

### 1. 不能确诊生产环境无持久盘

**已识别风险**：
- ⚠️  `container.config.json` 缺少 `volumeMounts` **不能确诊**控制台没有手动配置挂载
- ⚠️  仅仅是配置文件缺失，可能控制台已配置但未写入文件
- ⚠️  `minNum=1` **不是持久性保障**，实例重启仍可能丢数据

**修正**：
- ❌ 删除"已证实"、"确诊"等表述
- ✅ 改为"高风险假设"、"疑似原因"
- ✅ 需要生产环境 `/health` 接口和日志证据才能确诊

### 2. volumeMounts 配置需官方文档验证

**未验证的配置**：
```json
{
  "volumeMounts": {
    "/data": {
      "sizeInGiB": 1,
      "mountType": "CloudStorage"
    }
  }
}
```

**严重问题**：
- ❌ **未找到官方文档**支持此 schema
- ❌ 不确定 `CloudStorage` 是否是微信云托管支持的类型
- ❌ 不确定是否支持 SQLite POSIX 锁和 WAL 模式
- ❌ 多实例并发写入 SQLite 可能导致数据库损坏

**需要验证**：
1. 微信云托管官方文档中 `container.config.json` 的 volumeMounts schema
2. 持久存储类型（CloudStorage / NFS / 其他？）
3. SQLite 并发访问支持（POSIX 锁、WAL 模式）
4. 扩缩容时文件锁行为
5. 多实例同时写入同一 SQLite 文件的安全性

**⚠️  在官方验证前，不能声称配置安全**

### 3. session_user.id 不可信

**已测试证实**：

```typescript
// 服务端：miniprogram/server/auth.ts 第22-28行
user = {
  id: uuidv4(),        // ❌ 内部UUID，不是 openid
  openid,              // ✅ 真实微信身份（仅服务端）
  nickname,
  avatar,
};

// 客户端：miniprogram/client/utils/api.ts
type SessionUser = {
  id: string,          // ❌ 内部UUID，客户端可篡改
  nickname: string,    // ❌ 可修改
  avatar: string       // ❌ 可修改
};
// ❌ 客户端没有 openid！
```

**篡改风险**：
- ❌ 客户端 `session_user.id` 是内部UUID，不是 openid
- ❌ 客户端可以篡改 Storage 中的任何值
- ❌ 恶意用户可以伪造他人 id 窃取数据
- ❌ 如果旧库映射丢失（id ↔ openid），无法验证真实微信身份

**正确的身份验证**：
1. ✅ 用户通过微信登录（`wx.login` → code）
2. ✅ 服务端从微信网关获取 openid（可信）或 code 换票
3. ✅ 服务端根据 openid 查找或创建用户
4. ✅ 服务端返回 `session_token`（可验证）
5. ❌ 客户端 `session_user.id` 仅供展示，**不可信**

**恢复数据的正确流程**：
- ❌ 不能凭客户端 `session_user.id` 认领数据
- ❌ 不能凭昵称匹配（可重名、可修改）
- ✅ **必须**用户通过微信重新登录，服务端获取可信 openid
- ✅ **必须**用 openid 在备份数据库中查找该用户的数据
- ✅ **必须**验证备份中有该 openid 的记录

**如果备份中 openid 映射丢失**：
- ❌ 无法证明客户端用户的真实微信身份
- ❌ 无法安全恢复数据
- ⚠️  只能让用户重新登录（创建新账号），不恢复旧数据

---

## ✅ 已完成的测试

### 测试 1：空库保护逻辑（发现漏洞）

**测试代码**：`miniprogram/test-empty-db-protection.ts`

**测试结果**：
```
测试场景 1：完全空库
  用户数: 0
  收藏数: 0
  Token数: 0
  ✅ 保护触发（正确）

测试场景 2：有用户但无收藏
  用户数: 1
  收藏数: 0
  Token数: 0
  ❌ 保护不触发（漏洞！）
```

**发现的问题**：

当前逻辑：
```typescript
if (userCount === 0 && favoriteCount === 0 && agentTokenCount === 0) {
  // 拒绝启动
}
```

**漏洞**：使用 `AND` 逻辑
- ✅ 完全空库 → 拒绝启动（正确）
- ❌ 有用户但收藏丢失 → 允许启动（漏检！）
- ❌ 有收藏但用户丢失 → 允许启动（漏检！）

**问题影响**：
- 如果只有 `favorites` 表丢失（部分数据丢失）
- 启动保护不会触发
- 用户看到空列表，数据看起来丢失

**需要改进**：
- 考虑改为更严格的检查逻辑
- 或者分别检查各表的完整性
- 或者记录历史最大值，检测异常下降

### 测试 2：健康端点信息泄露（已确认）

**当前返回**：
```json
{
  "ok": true,
  "persistence": {
    "dbPath": "/data/miniprogram.db",    // ⚠️ 泄露路径
    "userCount": 123,                     // ⚠️ 泄露统计
    "favoriteCount": 456,                 // ⚠️ 泄露统计
    "agentTokenCount": 12                 // ⚠️ 泄露统计
  }
}
```

**安全问题**：
- ⚠️  公开端点暴露数据库路径
- ⚠️  公开端点暴露用户统计信息
- ⚠️  攻击者可以通过统计推断业务规模
- ⚠️  攻击者可以监控统计变化探测系统状态

**建议改进**：
1. 生产环境只返回 `{ "ok": true/false }`
2. 详细信息需要认证或内网访问
3. 或者添加查询参数 `?debug=secret_key` 才返回详情

### 测试 3：session_user 篡改风险（已确认）

**测试代码**：`miniprogram/test-session-user-tampering.ts`

**结论**：
- ❌ 客户端 `session_user.id` 不是 openid
- ❌ 客户端 Storage 可以被篡改
- ❌ 不能用于可信身份验证
- ❌ 不能用于数据恢复的身份匹配

---

## 🛡️ 修复方案（需要进一步验证）

### 第 1 层：配置修复（⚠️ 需官方文档验证）

**修改的配置**：
```json
{
  "minNum": 1,
  "volumeMounts": {
    "/data": {
      "sizeInGiB": 1,
      "mountType": "CloudStorage"  // ⚠️ 未验证是否官方支持
    }
  }
}
```

**需要验证**：
1. ✅ 查找微信云托管官方文档
2. ✅ 确认 `volumeMounts` 的正确 schema
3. ✅ 确认 `CloudStorage` 是否支持
4. ✅ 确认 SQLite 并发访问安全性
5. ✅ 确认多实例扩缩容行为

**⚠️  在验证前不能部署此配置**

### 第 2 层：启动保护（存在漏洞）

**当前代码**：
```typescript
if (userCount === 0 && favoriteCount === 0 && agentTokenCount === 0) {
  process.exit(1);  // 拒绝启动
}
```

**已知问题**：
- ❌ 使用 AND 逻辑会漏检部分数据丢失
- ❌ 在建表/迁移/seed 之前会误触发
- ❌ 破坏新环境 bootstrap

**需要改进**：
1. 区分"首次部署"和"数据丢失"
2. 记录历史最大值或预期值
3. 更精确的检测逻辑

### 第 3 层：健康端点（需要改进）

**建议修改**：
```typescript
app.get('/health', (req, res) => {
  // 生产环境不暴露详细信息
  if (config.nodeEnv === 'production') {
    const health = getPersistenceHealth();
    const ok = !health.warning && health.userCount !== null;
    res.json({ ok });  // 仅返回状态
    return;
  }
  
  // 开发环境返回详情
  const persistence = getPersistenceHealth();
  res.json({ ok: true, persistence });
});
```

---

## 📊 保全数据现场补充

### Mac 10/24 备份（不能用于生产恢复）

**已明确**：
- ❌ 全是 `dev_` 前缀的调试用户
- ❌ 不是真实生产数据
- ❌ **禁止恢复到生产环境**
- ❌ **禁止索要开发环境凭证**

### 59家店铺 JSON（无归属信息）

**已明确**：
- ❌ 没有用户归属信息（user_id / openid）
- ❌ 不能确定是哪个用户的收藏
- ❌ **禁止灌入生产环境**

### 徐涵 7 店铺（仅线索）

**已明确**：
- ⚠️  仅有历史聊天记录提到
- ❌ 缺少原始关系（user_id / openid）
- ❌ **不能恢复到徐涵名下**（无法验证身份）

---

## ❌ 客户端缓存保护的错误说法（已修正）

### 之前的错误说法

> "启动门禁防止空响应覆盖客户端缓存"

### 为什么错误

1. **客户端不缓存业务数据**（已证实）
   - ❌ 不缓存收藏列表
   - ❌ 不缓存圈子列表
   - ❌ 不缓存好友关系
   - ✅ 只缓存用户基本信息（`session_user`）

2. **空响应不会覆盖 session_user**
   - `GET /api/me/shops` 返回 `{ items: [] }`
   - 页面显示空列表
   - 但 `session_user` 不受影响（不同的 Storage Key）

3. **启动门禁的真正作用**
   - ✅ 防止新数据写入临时层后再次丢失
   - ✅ 防止用户看到空列表后误操作（如重新导入）
   - ✅ 强制运维检查持久盘配置
   - ❌ 不是"保护客户端业务缓存"（本来就不存在）

### 修正后的说法

**启动门禁的作用**：
1. ✅ 检测到空库时拒绝启动
2. ✅ 健康检查失败，云托管不切流量
3. ✅ 用户继续访问旧版本（如果还在运行）
4. ✅ 防止用户看到空列表后产生新数据
5. ✅ 强制运维检查并修复持久盘配置

**不是为了保护客户端缓存**（客户端本来就不缓存业务数据）

### 登录失败是否清除 session_user？

**需要测试**：
```typescript
// miniprogram/client/utils/api.ts
export function goLoginGate(): void {
  clearSession();  // 第97行
  wx.reLaunch({ url: '/pages/login/login' });
}

export function clearSession(): void {
  // 第58-68行
  wx.removeStorageSync('session_token');
  wx.removeStorageSync(USER_KEY);  // USER_KEY = 'session_user'
}
```

**结论**：
- ✅ 401 错误会调用 `goLoginGate()`
- ✅ `goLoginGate()` 会调用 `clearSession()`
- ✅ `clearSession()` 会删除 `session_user`
- ❌ 所以服务端返回 401 时，客户端的 `session_user` 会被清除

**影响**：
- 如果空库启动，所有请求返回 401
- 客户端 `session_user` 被清除
- 即使后来恢复数据，客户端也没有旧的 `session_user.id`
- 所以 `session_user.id` 不能用于恢复验证

---

## 🧪 已完成的实际测试

### 1. 空库保护逻辑测试 ✅

**文件**：`miniprogram/test-empty-db-protection.ts`

**测试内容**：
- ✅ 创建空数据库（仅表结构）
- ✅ 模拟生产环境（NODE_ENV=production）
- ✅ 测试完全空库场景
- ✅ 测试部分数据丢失场景

**发现问题**：
- ❌ AND 逻辑漏检部分数据丢失
- ⚠️  健康端点泄露敏感信息

### 2. session_user 篡改测试 ✅

**文件**：`miniprogram/test-session-user-tampering.ts`

**测试内容**：
- ✅ 分析 session_user 数据结构
- ✅ 验证 id 是内部UUID而非 openid
- ✅ 确认客户端可篡改
- ✅ 说明恢复时的身份验证问题

**结论**：
- ❌ session_user.id 不可信
- ❌ 不能用于数据恢复的身份验证

### 3. 部署前配置检查 ✅

**文件**：`miniprogram/scripts/pre-deploy-check.ts`

**测试内容**：
- ✅ 检查 volumeMounts 配置存在
- ✅ 检查 DB_PATH 正确
- ✅ 检查启动保护启用

**结果**：
```
✅ 所有检查通过
```

**但注意**：
- ⚠️  这只是检查配置文件自洽性
- ⚠️  不能验证配置是否符合官方 schema
- ⚠️  不能验证 SQLite 并发安全性

### 4. 数据库完整性检查工具 ✅

**文件**：`miniprogram/scripts/check-db-integrity.ts`

**功能**：
- ✅ 只读检查数据库
- ✅ 统计各表记录数
- ✅ 检查外键完整性
- ✅ 检查持久化状态

**测试**：在演示数据库上运行通过

### 5. 安全数据导出工具 ✅

**文件**：`miniprogram/scripts/export-db-safe.ts`

**功能**：
- ✅ 导出业务数据到 JSON
- ✅ 排除 sessions.token
- ✅ 排除 agent_tokens.token_hash
- ✅ 手机号脱敏

**测试**：在演示数据库上运行通过

### ❌ 未完成的测试

以下测试需要但尚未完成：

1. **覆盖真实部署配置验证**
   - ❌ 未在实际云托管环境测试 volumeMounts
   - ❌ 未验证 SQLite WAL 模式在持久盘上的行为
   - ❌ 未验证多实例并发写入安全性

2. **恢复副本演练**
   - ❌ 未创建测试环境
   - ❌ 未演练从备份恢复流程
   - ❌ 未验证 openid 匹配逻辑
   - ❌ 未创建 restore-db-safe.ts 工具

3. **新环境 bootstrap 测试**
   - ❌ 未测试空库保护是否破坏首次部署
   - ❌ 未测试数据库迁移是否会触发保护

---

## 📋 剩余上线条件（严格要求）

### 阶段 1：官方文档验证（阻塞）⏳

**必须完成**：
1. ⏳ 查找微信云托管官方文档
2. ⏳ 确认 `container.config.json` 的 `volumeMounts` schema
3. ⏳ 确认持久存储类型和限制
4. ⏳ 确认 SQLite POSIX 锁和 WAL 支持
5. ⏳ 确认多实例并发安全性
6. ⏳ 确认扩缩容时的文件锁行为

**如果官方不支持**：
- ❌ 当前配置不能使用
- ❌ 需要寻找替代方案（如外部数据库）

### 阶段 2：生产环境证据（等待用户）⏳

**需要用户提供**：

1. **生产 /health 接口状态**
   ```bash
   curl https://生产域名/health
   ```

2. **容器日志**（搜索 `[PERSISTENCE]`）

3. **云托管控制台截图**
   - 持久盘配置（如果有）
   - 当前版本运行状态

**只有这些证据才能确诊是否无持久盘**

### 阶段 3：改进和补充测试 ⏳

**需要完成**：
1. ⏳ 修复空库保护逻辑（AND → 更严格的检查）
2. ⏳ 修复健康端点信息泄露
3. ⏳ 创建恢复工具（restore-db-safe.ts）
4. ⏳ 新环境 bootstrap 测试
5. ⏳ 恢复副本演练

### 阶段 4：部署（严格禁止）❌

**在完成阶段 1-3 前，严格禁止**：
- ❌ 合并 PR
- ❌ 部署到生产
- ❌ 连接生产数据库
- ❌ 修改生产数据
- ❌ 通知用户操作

---

## 🚨 数据恢复的正确要求

### ✅ 必须满足的条件

1. **服务端可信微信登录身份**
   - ✅ 用户通过微信登录（wx.login）
   - ✅ 服务端从微信网关获取 openid（X-WX-FROM-OPENID）
   - ✅ 或服务端用 code 换票获取 openid
   - ❌ 不能信任客户端提供的任何身份信息

2. **备份中可信的 openid 映射**
   - ✅ 备份数据库中有 users 表
   - ✅ users 表中有 openid 字段
   - ✅ openid 字段完整无损
   - ❌ 如果 openid 映射丢失，无法恢复

3. **严格的身份验证**
   - ✅ 用户登录后，服务端获取 openid
   - ✅ 在备份中查找该 openid 的记录
   - ✅ 确认备份中有该用户的数据
   - ✅ 将备份数据关联到新库中该 openid 的用户
   - ❌ 绝对不能凭昵称匹配
   - ❌ 绝对不能凭客户端 session_user.id 匹配

### ❌ 禁止的操作

1. **禁止恢复开发数据到生产**
   - ❌ Mac 10/24 备份全是 `dev_` 调试用户
   - ❌ 不能恢复到生产环境
   - ❌ 不能索要开发环境凭证

2. **禁止灌入无归属数据**
   - ❌ 59家店铺 JSON 没有 user_id / openid
   - ❌ 不能随意分配给任何用户
   - ❌ 不能灌入生产环境

3. **禁止凭线索认领数据**
   - ❌ 徐涵 7 店铺缺少原始关系
   - ❌ 不能凭聊天记录恢复数据
   - ❌ 必须有可信的 openid 映射

---

## 📝 修正摘要

### 重大修正

1. **降低确诊程度**
   - ❌ 删除"已证实"、"确诊"
   - ✅ 改为"高风险假设"、"疑似"
   - ✅ 等待生产证据才能确诊

2. **volumeMounts 配置存疑**
   - ⚠️  未找到官方文档支持
   - ⚠️  SQLite 并发安全性未验证
   - ⚠️  不能声称配置安全

3. **session_user.id 不可信**
   - ❌ 是内部UUID，不是 openid
   - ❌ 客户端可篡改
   - ❌ 不能用于身份验证和数据恢复

4. **空库保护有漏洞**
   - ❌ AND 逻辑漏检部分数据丢失
   - ⚠️  可能破坏新环境 bootstrap
   - ⚠️  需要改进

5. **健康端点泄露信息**
   - ⚠️  暴露数据库路径和用户统计
   - ⚠️  需要改进

6. **客户端缓存保护说法错误**
   - ❌ 客户端不缓存业务数据
   - ❌ 启动门禁不是为了保护客户端缓存
   - ✅ 是为了防止新数据写入临时层

### 已完成的测试

- ✅ 空库保护逻辑测试
- ✅ session_user 篡改测试
- ✅ 部署前配置检查
- ✅ 数据库完整性检查工具
- ✅ 安全数据导出工具

### 未完成的测试

- ❌ 官方文档验证
- ❌ 覆盖真实部署配置验证
- ❌ 恢复副本演练
- ❌ 新环境 bootstrap 测试

---

## 🎯 下一步行动

### 立即需要（阻塞）

1. **查找官方文档**
   - 微信云托管持久存储文档
   - container.config.json schema 文档
   - SQLite 支持说明

2. **等待生产证据**
   - `/health` 接口状态
   - 容器日志
   - 控制台配置截图

### 后续改进

1. 修复空库保护逻辑
2. 修复健康端点信息泄露
3. 创建恢复工具
4. 完成剩余测试

---

**当前状态**：⏳ 等待官方文档验证和生产证据  
**不能部署**：❌ 配置未经官方验证  
**不能恢复**：❌ 开发数据不能用于生产

**PR 地址**：https://github.com/Jam-free/opendianping/pull/9  
**分支**：`cursor/urgent-data-recovery-investigation-2396`
