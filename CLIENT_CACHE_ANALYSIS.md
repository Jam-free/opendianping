# 📱 客户端缓存机制详细分析报告

**分析时间**：2026-11-06 23:59 UTC  
**代码版本**：feat/miniprogram-import-circle 分支  
**分析范围**：微信小程序客户端（miniprogram/client/）

---

## 📋 缓存 Keys 完整清单

### 已证实的 wx.Storage Keys

基于代码审查（`miniprogram/client/utils/` 目录）：

| Storage Key | 数据类型 | 写入文件 | 写入行号 | 读取行号 | 覆盖时机 |
|------------|---------|---------|---------|---------|---------|
| `session_token` | `string` | `utils/api.ts` | 186 | 26, 154 | 每次登录成功 |
| `session_user` | `{id, nickname, avatar}` | `utils/api.ts` | 51 | 35 | 每次登录成功 |
| `pending_join` | `{c: string, t: string}` | `utils/api.ts` | 93 | 118 | 完成加入圈子 |
| `pending_next` | `string` (页面路径) | `utils/api.ts` | 108 | 128 | 登录成功后 |
| `active_circle` | `string` (circleId) | `utils/circle.ts` | 8 | 4 | 每次切换圈子 |
| `last_location` | `{lat, lng, ...}` | `utils/location.ts` | 32 | 35 | 每次获取定位 |
| `locate_draft` | `{name, note, ...}` | `utils/locate-draft.ts` | 54 | 35 | 提交记美食 |
| `share_invite` | `{networkId, inviteToken}` | `pages/my-shops/my-shops.ts` | 221, 352 | 333 | 分享操作 |

---

## 🔍 详细代码分析

### 1. session_token（会话令牌）

**写入时机**（utils/api.ts 第186行）：
```typescript
// 在 ensureLogin() 函数中
wx.setStorageSync('session_token', data.token);
```

**读取时机**（utils/api.ts 第154行）：
```typescript
const cached = wx.getStorageSync('session_token') as string;
if (cached) {
  app.globalData.token = cached;
  return cached;
}
```

**覆盖风险**：
- ✅ **不会**被空响应覆盖
- ❌ 401错误时会被清除（第64行 `clearSession()`）
- ❌ 用户主动退出登录时清除（第220-226行）

**恢复价值**：
- ❌ Token已失效，无法用于恢复
- ❌ 服务端sessions表已空，token无法验证

---

### 2. session_user（用户基本信息）⭐

**数据结构**：
```typescript
type SessionUser = {
  id: string;        // 用户内部ID
  nickname?: string | null;  // 昵称
  avatar?: string | null;    // 头像URL
};
```

**写入时机**（utils/api.ts 第51行）：
```typescript
export function saveCachedUser(user: SessionUser): void {
  const app = getAppSafe();
  app.globalData.user = user;
  app.globalData.userId = user.id || '';
  try {
    wx.setStorageSync(USER_KEY, user);  // USER_KEY = 'session_user'
  } catch {
    /* ignore */
  }
}
```

**调用链**：
1. 用户登录成功 → `/api/auth/login` 返回 `{token, user}`
2. `ensureLogin()` 调用 `saveCachedUser(data.user)` (第185行)
3. 写入 `session_user` 缓存

**读取时机**（utils/api.ts 第35行）：
```typescript
export function peekCachedUser(): SessionUser | null {
  const app = getAppSafe();
  if (app.globalData.user) return app.globalData.user;
  try {
    const raw = wx.getStorageSync(USER_KEY) as SessionUser | '';
    if (raw && typeof raw === 'object') {
      app.globalData.user = raw;
      return raw;
    }
  } catch {
    /* ignore */
  }
  return null;
}
```

**覆盖风险**：
- ✅ **不会**被空响应覆盖（只在登录成功时写入）
- ❌ 用户重新登录时覆盖（第185行）
- ❌ 用户退出登录时清除（第65行）

**⭐ 恢复价值**：
- ✅ **可用于身份映射**！
- ✅ `user.id` 是服务端 `users.id` 的映射
- ✅ 可以通过 `user.id` 查询服务端数据库找到 `openid`
- ⚠️  前提：服务端数据库有该用户记录

**关键字段**：
- `id`: 用户唯一标识，对应服务端 `users.id`
- `nickname`: 仅展示用，不可靠（用户可修改）
- `avatar`: 仅展示用

---

### 3. pending_join（待加入圈子）

**写入时机**（utils/api.ts 第93行）：
```typescript
if (c && t) wx.setStorageSync('pending_join', { c, t });
```

**作用**：用户在未登录状态点击圈子邀请链接时，暂存参数，登录后自动完成加入。

**覆盖风险**：
- ✅ 临时数据，不重要
- ✅ 完成加入后自动清除（第122行）

**恢复价值**：
- ❌ 临时数据，无恢复价值

---

### 4. active_circle（当前选中圈子）

**写入时机**（utils/circle.ts 第8行）：
```typescript
export function saveActiveCircle(id: string): void {
  wx.setStorageSync(ACTIVE_CIRCLE_KEY, id);  // ACTIVE_CIRCLE_KEY = 'active_circle'
}
```

**读取时机**（utils/circle.ts 第4行）：
```typescript
export function getActiveCircle(): string {
  return (wx.getStorageSync(ACTIVE_CIRCLE_KEY) as string) || '';
}
```

**覆盖风险**：
- ✅ 仅存储当前选中的圈子ID
- ✅ 每次切换圈子时更新

**恢复价值**：
- ⚠️  仅保存最后选中的圈子ID，不是完整圈子列表
- ❌ 无法恢复用户所有圈子

---

### 5. last_location（最后位置）

**写入时机**（utils/location.ts 第32行）：
```typescript
wx.setStorageSync(LAST_KEY, loc);  // LAST_KEY = 'last_location'
```

**数据结构**：
```typescript
type UserLocation = {
  lat: number;
  lng: number;
  // 可能还有其他字段
};
```

**覆盖风险**：
- ✅ 每次获取定位时更新
- ✅ 仅保存最后一次位置

**恢复价值**：
- ❌ 仅最后位置，无恢复价值

---

### 6. locate_draft（记美食草稿）

**写入时机**（utils/locate-draft.ts 第54行）：
```typescript
wx.setStorageSync(KEY, next);  // KEY = 'locate_draft'
```

**作用**：用户在"记美食"页面输入内容时，暂存草稿，防止意外退出丢失。

**覆盖风险**：
- ✅ 提交成功后清除（第60行）
- ⚠️  未提交的草稿会保留

**恢复价值**：
- ⚠️  如果用户有未提交的草稿，可能包含店铺信息
- ❌ 但这不是已保存的收藏，恢复价值有限

---

## ❌ 客户端不缓存的业务数据

### 已证实：以下数据每次从服务端实时获取

#### 1. 收藏的店铺列表（favorites）

**代码位置**：`pages/my-shops/my-shops.ts`

**数据流**：
```typescript
// 第 220-232 行，onShow() 生命周期
async onShow() {
  // ...
  const res = await request<MyShopsResponse>('/api/me/shops', {
    method: 'GET',
    data: { lat, lng, userCity },
  });
  this.setData({ 
    shops: res.items,  // 直接从服务端获取，不缓存
    // ...
  });
}
```

**关键点**：
- ❌ **不使用** `wx.setStorageSync` 缓存店铺列表
- ❌ 每次进入"我的店"页面都重新请求
- ⚠️  如果服务端返回空数组，页面会显示空列表

**空响应风险**：
```typescript
// 场景：服务端 favorites 表为空
// 服务端响应: { items: [] }
// 页面显示: "还没有收藏"
this.setData({ shops: [] });  // 用户看到空列表
```

#### 2. 圈子列表（circles）

**代码位置**：`pages/circles/circles.ts`

**数据流**：
```typescript
// 每次进入页面调用
const res = await request<{ items: Circle[] }>('/api/circles');
this.setData({ circles: res.items });  // 不缓存
```

**关键点**：
- ❌ 不缓存圈子列表
- ❌ 每次从服务端获取

#### 3. 好友列表（network）

**代码位置**：`pages/friends/friends.ts`

**数据流**：
```typescript
const res = await request<{ items: Friend[] }>('/api/me/network');
this.setData({ friends: res.items });  // 不缓存
```

#### 4. 店铺详情（shop detail）

**代码位置**：`pages/shop-detail/shop-detail.ts`

**数据流**：
```typescript
const res = await request<{ shop: ShopDetail }>(`/api/circles/${circleId}/shops/${poiKey}`);
this.setData({ shop: res.shop });  // 不缓存
```

#### 5. 评论（shop_comments）

**代码位置**：相关页面调用评论接口

**数据流**：
```typescript
const res = await request<{ items: Comment[] }>(`/api/shops/${poiKey}/comments`);
// 不缓存
```

---

## 🛡️ 空响应覆盖保护机制

### 问题场景

如果服务端数据库为空（持久盘未挂载），用户打开小程序会发生：

1. **用户打开"我的店"页面**
   ```
   请求: GET /api/me/shops
   服务端: favorites 表为空
   响应: { items: [] }
   页面: 显示"还没有收藏"
   ```

2. **用户信息仍保留**
   ```
   本地缓存: session_user = { id: "xxx", nickname: "用户A", avatar: "..." }
   本地缓存: session_token = "ey..." (但已失效)
   ```

3. **用户可能的操作**
   - ✅ 看到空列表，以为数据丢失
   - ❌ 尝试重新导入（会产生新数据）
   - ❌ 尝试删除（删除空列表，无影响）

### 保护方案：启动门禁

**实施**：`miniprogram/server/index.ts` 启动保护

**效果**：
1. 容器启动时检测数据库
2. 如果发现空库 → **拒绝启动**（process.exit(1)）
3. 健康检查失败 → 云托管不切流量到新版本
4. 用户继续访问旧版本（如果旧版本还在运行）
5. **客户端缓存不被空响应覆盖**

**关键代码**：
```typescript
if (isEmpty) {
  console.error('[PERSISTENCE] 生产环境检测到空数据库，拒绝启动');
  process.exit(1);  // 容器启动失败
}
```

**云托管行为**：
- 新版本启动失败 → 不会切流量
- 旧版本继续服务（如果 minNum > 0）
- 运维收到告警 → 检查持久盘配置

---

## 📊 可恢复字段总结

### ✅ 可从客户端缓存恢复的数据

| 字段 | Storage Key | 恢复可行性 | 恢复价值 | 前提条件 |
|-----|-------------|----------|---------|---------|
| 用户ID | `session_user.id` | ✅ 高 | ⭐⭐⭐⭐⭐ | 服务端有该用户记录 |
| 昵称 | `session_user.nickname` | ⚠️  中 | ⭐⭐ | 仅展示用，不可靠 |
| 头像 | `session_user.avatar` | ⚠️  中 | ⭐ | 仅展示用 |
| 当前圈子 | `active_circle` | ⚠️  低 | ⭐ | 仅最后选中的 |
| 未提交草稿 | `locate_draft` | ⚠️  低 | ⭐ | 如果有的话 |

### ❌ 无法从客户端恢复的数据

| 数据类型 | 原因 | 恢复方式 |
|---------|------|---------|
| 收藏列表 | 客户端不缓存 | 必须从服务端数据库恢复 |
| 圈子列表 | 客户端不缓存 | 必须从服务端数据库恢复 |
| 好友关系 | 客户端不缓存 | 必须从服务端数据库恢复 |
| 店铺详情 | 客户端不缓存 | 必须从服务端数据库恢复 |
| 评论 | 客户端不缓存 | 必须从服务端数据库恢复 |
| Agent Token | 单向哈希 | 无法恢复，用户需重新生成 |
| 会话令牌 | 已失效 | 无法恢复，用户需重新登录 |

---

## 🔑 恢复流程建议

### 场景 A：服务端有备份数据库

1. **提取客户端 session_user**
   ```typescript
   // 用户在小程序中运行（开发者工具）
   const sessionUser = wx.getStorageSync('session_user');
   console.log('我的用户ID:', sessionUser.id);
   console.log('我的昵称:', sessionUser.nickname);
   ```

2. **服务端查询 openid**
   ```sql
   SELECT openid, nickname FROM users WHERE id = '用户ID';
   ```

3. **恢复该用户的收藏**
   ```sql
   -- 从备份数据库
   SELECT * FROM favorites WHERE user_id = '用户ID';
   ```

4. **验证恢复**
   ```sql
   -- 在新数据库中检查
   SELECT COUNT(*) FROM favorites WHERE user_id = '用户ID';
   ```

### 场景 B：服务端无备份，仅客户端缓存

**结论**：❌ **无法恢复业务数据**

**原因**：
- 客户端不缓存收藏、圈子等业务数据
- `session_user` 只包含用户基本信息，不包含收藏

**只能恢复**：
- 用户账号（通过 openid 重新建立）
- 昵称和头像（如果用户没有修改）

---

## 🚨 立即保全措施

### 用户侧（通知用户执行）

**重要**：在修复部署前，通知用户**不要做以下操作**：

1. ❌ **不要卸载小程序**
   - 会清除所有 Storage
   - `session_user` 会丢失

2. ❌ **不要清除微信缓存**
   - 设置 → 通用 → 微信存储空间 → 清理
   - 会清除 Storage

3. ❌ **不要退出登录**
   - 会调用 `clearSession()`
   - 清除 `session_user` 和 `session_token`

4. ❌ **不要重新登录**
   - 如果服务端是空库，会创建新账号
   - 新账号会覆盖 `session_user`

5. ✅ **可以继续浏览**
   - 不要做修改操作（添加、删除收藏）
   - 不要分享或邀请

### 开发者侧（获取缓存数据）

**方法1**：微信开发者工具

```javascript
// 在开发者工具控制台运行
const sessionUser = wx.getStorageSync('session_user');
const sessionToken = wx.getStorageSync('session_token');
const activeCircle = wx.getStorageSync('active_circle');
const draft = wx.getStorageSync('locate_draft');

console.log({
  sessionUser,
  sessionToken,
  activeCircle,
  draft,
});
```

**方法2**：小程序真机调试

```javascript
// 添加临时调试页面
Page({
  onLoad() {
    const allKeys = [
      'session_user',
      'session_token',
      'active_circle',
      'locate_draft',
      'pending_join',
      'pending_next',
      'last_location',
      'share_invite',
    ];
    
    const cache = {};
    allKeys.forEach(key => {
      cache[key] = wx.getStorageSync(key);
    });
    
    console.log('客户端缓存:', JSON.stringify(cache, null, 2));
    // 复制到剪贴板
    wx.setClipboardData({ data: JSON.stringify(cache) });
  }
});
```

---

## 📝 总结

### 关键发现

1. ✅ 客户端**只缓存**用户基本信息（`session_user`）和临时状态
2. ❌ 客户端**不缓存**业务数据（收藏、圈子、好友）
3. ⭐ `session_user.id` 是唯一有恢复价值的缓存字段
4. 🛡️ 启动保护可防止空响应覆盖客户端缓存

### 恢复可行性

| 场景 | 客户端缓存作用 | 恢复可行性 |
|------|---------------|----------|
| 有服务端备份 | 用于身份验证和映射 | ✅ 高 |
| 无服务端备份 | 仅能恢复用户账号 | ❌ 低 |

### 下一步

1. ⏳ 等待用户提供生产环境状态
2. ⏳ 等待用户提供10/24备份导出
3. ⏳ 根据实际情况选择恢复方案

---

**报告完成时间**：2026-11-06 23:59 UTC
