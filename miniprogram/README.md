# 微信小程序：导入收藏 + 共享收藏圈（v0.2）

把 OpenDianping 的**公开专辑导入**做成可点的 GUI，并在微信群里共享「收藏圈」。产品规格见 [`docs/miniprogram-spec-v0.2.md`](../docs/miniprogram-spec-v0.2.md)；视觉参考 [`docs/v3-swiss/index.html`](../docs/v3-swiss/index.html)（瑞士极简：白底、发丝线、距离大字、橙→品红渐变仅用于激活态与底栏）。

## 你能做什么

1. **首页 · 店铺 / 朋友**：圈内共享收藏按**离我距离**排序（后端 Haversine）；卡片展示最多 3 个推荐人头像 + `+N`，文案如「小王、阿云等 3 人推荐」；无坐标店排在最后。
2. **朋友页**：点圈友查看其共享收藏，同样按距离排序。
3. **店铺详情**：每位推荐人的**备注**单独展示；有 `headImg` 时显示头图（经后端代理）。
4. **底栏三按钮**：导入专辑、定位记美食（附近圈内店 + 备注）、邀请进群（`withShareTicket` + 邀请 token）。
5. **合规**：只读用户主动分享的公开专辑；不登录点评；导入限速；不编造 shopId；用户坐标**不入库**。

## 目录

```
miniprogram/
├── client/          # 微信原生小程序（TypeScript）
├── server/          # Express API + SQLite
├── __tests__/       # 单测（导入 / 权限 / 距离）
├── .env.example
└── package.json
```

## 运行步骤

### 1. 安装依赖

```bash
cd miniprogram
npm install
```

若使用方案 A（`opendianping` 适配器），仓库根目录也需安装依赖（复用 `lib/fetcher`）：

```bash
cd ..
npm install
```

### 2. 配置环境变量

```bash
cd miniprogram
cp .env.example .env
```

| 变量 | 说明 |
|------|------|
| `SOURCE_ADAPTER` | `opendianping`（默认）或 `text_amap` |
| `WECHAT_APPID` | 开发可用 `touristappid`（已在 `client/project.config.json` 配置） |
| `WECHAT_APP_SECRET` | 正式登录必填；本地可 `DEV_AUTH_BYPASS=true` |
| `AMAP_KEY` | 方案 B / 记美食 POI 兜底 |
| `IMPORT_RATE_LIMIT_PER_MIN` | 默认 `5` |

密钥只放 `.env`，勿提交。

### 3. 启动后端

```bash
cd miniprogram
npm run dev
```

默认 `http://127.0.0.1:8787`。

### 4. 打开小程序

1. 安装 [微信开发者工具](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html)
2. 导入目录：`miniprogram/client`
3. AppID 使用 `touristappid` 或测试号
4. 详情 → 本地设置：勾选「不校验合法域名」（连本地 API）
5. 真机调试：把 `client/utils/config.ts` 的 `API_BASE` 改为电脑局域网 IP（如 `http://192.168.x.x:8787`）

### 5. 店铺图片与 downloadFile 域名

点评 `headImg` 外链（如 `img.meituan.net`）在小程序里通过 **`GET /api/media/proxy?url=...`** 代理/缓存，前端 `<image>` 指向你的 API 域名。

上线前在微信公众平台 → 开发 → 开发管理 → 开发设置 → **downloadFile 合法域名** 中配置：

- 你的 API 域名（如 `https://api.example.com`）

代理层允许的图源 host 见 `server/services/media-proxy.ts`（`img.meituan.net` 等）。未配置合法域名时，开发者工具可开「不校验合法域名」调试。

### 6. 跑通一条链路

1. 首页创建收藏圈 → 底栏「邀请」分享到群（或复制 path 给测试号）
2. 底栏「导入」→ 粘贴公开专辑链接（开发可开「离线样本」）→ 勾选 → 保存为「共享到圈」
3. 首页「店铺」查看距离排序与推荐人；点进详情看备注
4. 底栏「记美食」→ 授权定位 → 选附近店 → 写备注

## 测试

```bash
cd miniprogram
npm test
```

覆盖：专辑解析与限流、圈内权限、Haversine 排序与推荐文案。

## 数据来源

- **A `opendianping`**：复用 `lib/fetcher`，`headImg` 随专辑写入 `shops.head_img`
- **B `text_amap`**：文本店名 + 可选高德；无 Key 不编造 poi_id

## 合规（实现已对齐）

- 只读用户主动分享的公开专辑；不绕验证
- 导入按用户限速；圈读校验成员；私密收藏不进圈视图
- 不编造 shopId；缺失字段隐藏
- 与大众点评无官方合作关系（导入页脚注）
