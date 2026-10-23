---
name: opendianping
description: >
  开放大众点评（OpenDianping）：把用户主动分享的大众点评收藏专辑导入本地，
  供推荐、筛选、附近搜索与顺路路线规划。在用户提到点评收藏、专辑链接、
  albumid、美食推荐结合自己收藏、顺路探店时使用本 skill。
  核心能力不依赖任何第三方 API Key；若运行环境缺少 MCP，先引导安装再调用。
---

# OpenDianping Skill（开放大众点评）

把用户**主动分享**的点评收藏专辑变成可查询数据，再结合联网信息做推荐。

## 0. 调用前必做：密钥与前置检查

### API Key 清单（必须对用户说清楚）

| 密钥 / 凭证 | 是否必须 | 用途 | 本 skill 默认行为 |
|-------------|----------|------|-------------------|
| **无** | — | 核心流程（导入专辑、列店、附近、路线） | **不需要任何 API Key** |
| 大众点评账号 / Cookie / Token | ❌ 不要 | 登录态、写入收藏 | **禁止索要、禁止使用** |
| 高德 / 腾讯地图 Web Key | 可选 | 仅当用户想换官方地图 JS SDK 时 | 默认用公开瓦片，**不要主动要** |
| 其他 LLM / 搜索 Key | 由宿主 agent 自己管 | 联网补充评价、排队等 | 本 skill 不收集 |

**规则：**

1. 调用本 skill 时，先向用户声明：  
   >「开放大众点评核心功能不需要 API Key。只需你提供收藏专辑的分享链接。」
2. **禁止**向用户索要点评登录密码、Cookie、App 签名、验证码绕过手段。
3. 若用户环境里**没有** OpenDianping MCP，先完成「安装 / 连接」再导入数据；不要假装已经读到收藏。
4. 只有用户明确要接入「需要 Key 的地图 SDK」时，才询问对应 Key，并说明可跳过、继续用无 Key 方案。

### 前置检查清单（按顺序）

1. MCP 工具是否可用：`import_album` / `list_shops` / `get_shop` / `shops_near` / `plan_route`
2. 若不可用 → 按下方「安装与连接」引导用户，**停下来等用户装好**，不要编造店铺数据
3. 若可用 → 询问或使用用户给出的专辑分享链接（尚未导入时先 `import_album`）

## 1. 用户需要提供什么

| 用户提供 | 必须？ | 示例 |
|----------|--------|------|
| 收藏专辑分享链接（或 albumid） | ✅ 首次导入必须 | `https://h5.dianping.com/app/commonplatform-collection-static/album.html?albumid=12498807` |
| 起点坐标 / 区域（做附近或路线时） | 场景需要时 | 「五一广场附近」「22.63,114.06」 |
| 筛选条件 | 可选 | 人均、评分、品类 |
| API Key | ❌ 默认不要 | — |

说明给用户听：只能读**分享出来的专辑**，不能自动同步整个点评账号。

## 2. 工具怎么用（MCP）

工具名以实际 MCP 为准；语义如下：

### `import_album`
- 输入：`url`（分享链接）；可选 `use_fixtures=true`（离线演示）
- 何时用：用户新贴链接，或本地还没有该专辑
- 成功后再做推荐 / 列表

### `list_shops`
- 输入：可选 `album_id`、`min_price`、`max_price`、`min_score`、`category`
- 何时用：按条件筛「我的收藏」

### `get_shop`
- 输入：`shop_id`
- 何时用：单店详情、招牌菜、推荐理由

### `shops_near`
- 输入：`lat`、`lng`、可选 `radius_km`（默认 5）
- 坐标：GCJ-02（与点评一致）
- 何时用：「附近有哪些我收藏过的」

### `plan_route`
- 输入：`shop_ids` + `start_lat` + `start_lng`
- 何时用：顺路探店顺序（最近邻，非导航路况）

## 3. 推荐话术流程（产品语言）

1. **开场说明密钥**  
   「这个能力不需要点评或地图 API Key。请把专辑分享链接发我；没有的话教你在点评里：收藏 → 专辑 → 分享 → 复制链接。」

2. **导入**  
   调用 `import_album`。失败则说明原因（网络 / 链接无效），可建议离线样例仅用于演示，不要把样例当成用户真实收藏。

3. **结合联网（可选）**  
   用宿主 agent 自己的联网能力补充：最近评价、排队、营业状态等。  
   **以用户收藏库为候选池**，联网信息用来「验鲜 / 排序 / 避雷」，不要用联网结果偷偷替换成用户没收藏过的店（除非用户明确说可以推荐库外）。

4. **回答结构建议**  
   - 推荐哪几家（来自收藏）  
   - 为什么（评分 / 人均 / 推荐菜 / 距离）  
   - 顺路顺序（如需要）  
   - 不确定的实时信息要标注「来自联网，可能变化」

## 4. 硬性约束

- 只读；不登录点评；不写入收藏；不伪造签名；不批量爬取
- 不索要、不存储用户点评 Cookie
- 坐标按 GCJ-02 理解；不要假装已做 WGS-84 精密纠偏（除非另有转换）
- 完整地址 / 电话通常不可得（打码）——如实说明
- 没有导入成功前，禁止声称「已读取你的收藏」

## 5. 安装与连接（给用户的步骤）

本 skill 依赖同仓库的 MCP 服务。用户本机需要 Node.js 18+。

```bash
# 1) 拿到本项目后
cd <opendianping项目目录>
npm install

# 2) 启动 MCP（保持运行或交给客户端拉起）
npm run mcp
```

### Claude Desktop

配置文件：

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "opendianping": {
      "command": "npm",
      "args": ["run", "mcp"],
      "cwd": "/绝对路径/到/opendianping"
    }
  }
}
```

重启客户端后应看到工具：`import_album`、`list_shops`、`get_shop`、`shops_near`、`plan_route`。

### Cursor / 其他支持 MCP 的 Agent

在 MCP Servers 中新增同样配置：`command=npm`，`args=["run","mcp"]`，`cwd=项目绝对路径`。

### 可选：Web 界面

```bash
npm run dev
```

浏览器打开本地地址，可可视化导入与导出；与 MCP 共用本地数据目录。

## 6. 故障排查（简短）

| 现象 | 处理 |
|------|------|
| 没有 MCP 工具 | 检查配置 cwd、已 `npm install`、重启客户端 |
| 导入失败 | 确认链接含 `albumid=`；可先 `use_fixtures` 验证链路，再换真实链接 |
| 地图/坐标疑问 | 说明为 GCJ-02；无 Key 瓦片即可打点 |
| 用户要「同步全部收藏」 | 说明做不到；引导按专辑分享多次导入 |

## 7. 模块说明（给维护者）

- **本文件**：教 agent 何时用、问什么、禁做什么  
- **MCP 服务**（仓库 `mcp-server/`）：真正读写本地库  
- **不需要 Key**：点评公开专辑接口 + 本地 SQLite；地图默认公开瓦片  

分享给别人时：同时给出本 `skills/opendianping/` 目录 + 可运行的项目（或安装说明）。只发 SKILL.md 而对方没装 MCP，则只能完成引导，不能读收藏。
