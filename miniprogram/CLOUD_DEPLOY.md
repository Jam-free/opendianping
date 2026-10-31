# 美食肥猫 · 微信云开发 / 云托管上线清单

AppID：`wx219e6044fdb7a6cd`

> ## 禁止无盘发布（必读）
>
> `feimaocat-api` **每一次**发布都必须同时满足：
> 1. 服务挂载**持久盘**到 **`/data`**
> 2. 环境变量 **`DB_PATH=/data/miniprogram.db`**（换版本也不许改这条路径）
>
> Agent Token（`agent_tokens`）和收藏（`favorites`）在**同一个 SQLite 文件、同一块盘**上。镜像本身是空的：没挂盘时进程会在容器临时层 `mkdir /data` 并建一个空库，接口看起来正常，但旧 Token 会全部变成 401「无效的 Agent Token」，「我的店」也会空。
>
> 发版 / 启动 **不得**清 Token 表或收藏表。用户只能在小程序里点「连接 AI」走 `POST /api/agent-tokens` 或 `/api/agent-tokens/reset` 主动重置。

## A. 开通云开发（你正在看的页）

按下面填，然后点 **¥19.9 开通**：

| 项 | 建议 |
|----|------|
| 环境名称 | `feimaocat`（小写字母开头，可含数字、连字符，≤24） |
| 套餐 | 个人版 · ¥19.9/月 |
| 超限设置 | 今日先保持开启也可；怕意外扣费可关掉（超配额会限流而不是继续计费） |
| 协议 | 勾选同意 |

开通成功后记下：**环境 ID**（形如 `feimaocat-xxxxx`）。

> 云开发开通 ≠ 接口已上线。美食肥猫后端是 Express，还要在同一环境里开 **云托管** 部署容器。

---

## B. 开通并部署云托管

1. 微信开发者工具 → 云开发控制台 → **云托管**（或公众平台 → 云服务 → 云托管）
2. 按提示开通云托管（若尚未开通）
3. **新建服务**，名称：`feimaocat-api`
4. 部署方式选 **Dockerfile**
5. GitHub 部署填写（专辑解析已内置在小程序服务里，两种上下文均可）：
   - 分支：`feat/miniprogram-import-circle`
   - 目标目录：**留空** + Dockerfile 填 **`Dockerfile`**（推荐），或目标目录填 `miniprogram` + 用 `miniprogram/Dockerfile`
   - 端口：`80`
6. **环境变量**（控制台填写，勿提交仓库）：

| 变量 | 值 |
|------|-----|
| `PORT` | `80` |
| `DB_PATH` | `/data/miniprogram.db`（**跨版本保持不变**） |
| `DEV_AUTH_BYPASS` | `false` |
| `WECHAT_APPID` | `wx219e6044fdb7a6cd` |
| `WECHAT_APP_SECRET` | 公众平台 → 开发管理 → 开发设置里的 AppSecret |
| `SOURCE_ADAPTER` | `opendianping`（贴专辑链接时也会自动走专辑解析） |
| `TENCENT_MAP_KEY` | 腾讯位置服务 Key（推荐；记美食逆地理） |
| `AMAP_KEY` | 高德 Key（可选；与腾讯二选一即可） |
| `AGENT_SHOP_WRITE_PER_MIN` | 可选，默认 `30`（Agent 写店每用户每分钟） |
| `AGENT_SHOP_WRITE_PER_DAY` | 可选，默认 `200`（Agent 写店每用户每天） |

7. **持久盘（禁止无盘发布）**：
   - 必须挂载，挂载路径 **`/data`**，容量 1GB 即可（存 SQLite）
   - 没有这块盘就不要点发布。新版本不会把旧 Token「迁移」到空库里
   - Token 表与 favorites **同库同盘**；发版不得清表

8. 监听端口：`80`
9. 发布版本，等变绿

部署成功后复制 **公网域名**，例如：

`https://feimaocat-api-xxxxx.ap-shanghai.wxcloudrun.com`

### 发版变绿后立刻检查（不要跳过）

浏览器或 curl 打开：`https://你的域名/health`

1. 应有 `"ok":true` 和 `"albumImport":true`（说明新镜像已生效）
2. 看 `persistence`：
   - `dbPath` 必须是 `/data/miniprogram.db`
   - 若生产里**本来就有**用户 / 收藏 / Agent Token：`agentTokenCount` 和 `favoriteCount` **必须不是 0**
   - 若计数是 0，或日志出现 `[PERSISTENCE]`：先查挂盘和 `DB_PATH`，**不要**让用户重新点「连接 AI」——除非已经确认旧盘数据没了，只能重发 Token
3. 容器日志搜 `[PERSISTENCE]`。生产路径下空库会打大字警告，不是「第一次开机很健康」

### 登录依赖（必读）

小程序客户端走微信云托管 **`callContainer`**（见 `client/utils/api.ts`），不是用公网域名直打登录。

正式环境（`DEV_AUTH_BYPASS=false`）登录顺序：

1. **优先认网关身份（不出网）**  
   `callContainer` 到达容器时，微信会注入用户身份头（官方保证，可信任）：
   - 肥猫是 **资源复用**（云在美食探索账号下）：读 `X-WX-FROM-OPENID`（以及可能的 `X-WX-FROM-UNIONID`）
   - 普通直属环境：读 `X-WX-OPENID` / `X-WX-UNIONID`  
   有这些头就直接建会话、发 token，**容器不必访问** `api.weixin.qq.com`。
2. **没有这些头时才 code 换票（要出网）**  
   例如用公网域名 `curl` 调试。此时需要：
   - 环境变量 `WECHAT_APPID` / `WECHAT_APP_SECRET`（控制台填写，**不要写进仓库**）
   - 云托管允许容器访问 `https://api.weixin.qq.com/sns/jscode2session`  
   若出网失败，接口返回可读中文（如「无法连接微信登录服务…」），不再把 Node 的 `fetch failed` 原样丢给用户。

生产不要开 `DEV_AUTH_BYPASS`（`container.config.json` 已是 `false`）。不要编造 openid。

### 部署后如何验证登录

**Jam / 云托管发布后（1–2 步）：**

1. 用本分支重新发布 `feimaocat-api`，等版本变绿；浏览器打开 `/health` 应含 `"ok":true,"albumImport":true`，并核对上面的 `persistence` 计数。
2. 手机打开小程序体验版：选头像 + 选昵称后应进入「我的店」，**不应**再出现红字「登录请求失败，请检查网络后重试」。

说明：公网 `curl -X POST …/api/auth/login` **没有**微信注入头，会走 code 换票；容器若仍不能出网，这条公网调试路径可能继续失败——**不代表小程序登录失败**。要测正式路径，必须从微信里 `callContainer`。

---

## C. 小程序连上云

1. 公众平台 → 开发管理 → 开发设置 → **服务器域名**  
   - request 合法域名：填云托管域名（只填主机名或按后台格式）  
   - downloadFile 合法域名：同上  
2. 把 `client/utils/config.ts`（及已编译的 `config.js`）里 `API_BASE` 改成该 `https://…`（无尾斜杠）
3. 在 `miniprogram` 目录执行：`npm run build:mp`
4. 开发者工具打开 `miniprogram/client` → 上传 → 设为**体验版** → 加体验成员  
5. 手机微信打开体验

---

## D. 今日验收

- [ ] `/health` 公网可访问，且 `persistence.dbPath` 为 `/data/miniprogram.db`
- [ ] 生产已有数据时：`persistence.agentTokenCount` / `favoriteCount` 非空（不是 0）
- [ ] 体验版能登录，朋友圈 / 我的店能开
- [ ] 邀请分享、导入或记美食、连接 AI 出 Token（Token **只**在用户主动点「连接 AI」时重置，发版不会清）

## 本地对照

```bash
cd miniprogram && npm run dev   # http://127.0.0.1:8787
cd miniprogram && npm test      # 含登录：网关头 / mock 微信 / 出网失败中文
```

本地 `DB_PATH=./data/miniprogram.db` 首次创建空库是正常的，不会打生产那种 `[PERSISTENCE]` 警告。
