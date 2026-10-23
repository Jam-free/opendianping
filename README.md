# OpenDianping（开放大众点评）

把散落在大众点评收藏专辑里的店铺数据"放出来"，让你自己的 AI 能用。

## 功能特性

### ✅ Web 应用
- 📎 粘贴大众点评收藏专辑分享链接，一键导入店铺数据
- 🗺️ 地图展示所有店铺位置（国内常用坐标系，开箱可看打点）
- 🔍 筛选和排序：按价格、评分、类目筛选，支持多种排序方式
- 📥 导出 CSV / JSON 格式数据
- 💾 本地 SQLite 数据库持久化存储
- 🔌 离线模式：使用本地 fixtures，无需网络即可演示

### 🤖 MCP 服务器
提供 5 个 AI 工具，让 Claude Desktop、Cursor 等 AI 助手能直接操作你的点评数据：

1. **import_album** - 导入专辑
2. **list_shops** - 列出店铺（支持筛选）
3. **get_shop** - 获取店铺详情
4. **shops_near** - 附近店铺搜索
5. **plan_route** - 规划顺路探店路线（最近邻算法）

### 📦 可分享 Skill
目录：[`skills/opendianping/`](./skills/opendianping/)

| 文件 | 作用 |
|------|------|
| `SKILL.md` | 给 agent 的完整用法（对用户只谈分享链接） |
| `INSTALL.md` | 别人如何安装 Skill + 连接 MCP |
| `AGENT_NOTES.md` | 维护者备注（勿对终端用户复述技术细节） |

分享给龙虾 / Grokbot / Muse / Claude 时：把该目录 + 本仓库（MCP）一起给对方；只发 Skill 读不到收藏。

## 快速开始

### 安装依赖

```bash
npm install
```

### 启动 Web 应用

```bash
npm run dev
```

然后在浏览器打开 http://localhost:3000

**默认示例**：页面会预填测试专辑链接 `albumid=12498807`（6 家深圳坂田美食店铺）

#### 离线演示模式
勾选"使用离线数据"，无需网络即可看到 6 家店铺和地图标点。

### 连接 MCP 服务器到 AI 工具

#### 方式 1：Claude Desktop

编辑 Claude Desktop 配置文件：

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`  
**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

添加以下配置：

```json
{
  "mcpServers": {
    "opendianping": {
      "command": "npm",
      "args": ["run", "mcp"],
      "cwd": "/workspace"
    }
  }
}
```

将 `/workspace` 替换为本项目的实际路径。

重启 Claude Desktop，在工具列表中就能看到 OpenDianping 的 5 个工具。

#### 方式 2：Cursor IDE

在 Cursor 设置中添加 MCP 服务器：

1. 打开 Cursor 设置
2. 找到 "Features" → "MCP Servers"
3. 添加新服务器，配置同上

#### 方式 3：直接运行（测试用）

```bash
npm run mcp
```

这会启动 stdio 模式的 MCP 服务器，适合调试。

## 使用示例

### Web 界面操作

1. 访问 http://localhost:3000
2. 粘贴大众点评收藏专辑链接（或使用默认示例）
3. 点击"导入专辑"
4. 查看店铺列表、地图标点
5. 使用筛选器和排序功能
6. 点击"导出 CSV"或"导出 JSON"下载数据

### AI 助手使用 MCP 工具

连接 MCP 后，你可以这样问 Claude/Cursor：

```
"帮我导入这个点评专辑：https://h5.dianping.com/app/commonplatform-collection-static/album.html?albumid=12498807"

"给我列出人均 50 元以下、评分 4 分以上的咖啡店"

"我现在在坐标 22.63, 114.06，附近 2 公里内有哪些店？"

"从坐标 22.62, 114.08 出发，帮我规划一条顺路路线，依次吃遍店铺 1908397290、931452608、1321112760"
```

AI 会自动调用对应的 MCP 工具获取数据并回答。

## 数据来源

**只读公开数据**：使用大众点评专辑分享页自身调用的公开接口（无需登录、cookie、验证码）

- 专辑元信息（标题、店铺数、作者）
- 店铺基础信息（名称、shopId、城市、类目、商圈）
- 评分、星级、人均价格、评论数
- 推荐理由、标签
- 经纬度坐标（GCJ-02 火星坐标系）
- 推荐菜列表（从店铺页补充）

**限制**：
- 只能导入用户主动分享的专辑链接
- 无法获取完整地址、电话（打码）、精确营业时间
- 不支持登录态操作（不写入点评收藏）

## 技术栈

- **前端**: Next.js 15 + TypeScript + Tailwind CSS + Leaflet
- **后端**: Next.js API Routes
- **数据库**: SQLite (better-sqlite3)
- **地图**: Leaflet + 公开地图瓦片（与点评坐标一致）
- **MCP**: @modelcontextprotocol/sdk
- **数据解析**: node-html-parser (店铺页推荐菜)

## 项目结构

```
/workspace
├── app/
│   ├── api/
│   │   ├── import/route.ts      # 导入专辑 API
│   │   ├── shops/route.ts       # 查询店铺 API
│   │   └── export/route.ts      # 导出数据 API
│   └── page.tsx                 # 主页面
├── components/
│   └── Map.tsx                  # 地图组件（Leaflet）
├── lib/
│   ├── db.ts                    # SQLite 数据库操作
│   ├── fetcher.ts               # 大众点评 API 调用和解析
│   ├── fixtures.ts              # 离线数据加载
│   └── types.ts                 # TypeScript 类型定义
├── mcp-server/
│   └── index.ts                 # MCP 服务器主文件
├── uploads/                     # 上传的样本数据
│   ├── r0_8c06.json            # 专辑接口响应（带 version）
│   ├── ep_noversion_1494.json  # 专辑接口响应（不带 version，含坐标）
│   ├── shop_1908397290_2380.html # 店铺页样本
│   └── shops_2dbf.csv          # 预期输出 CSV
└── data/
    └── opendianping.db         # SQLite 数据库（运行后自动创建）
```

## 开发

### 构建生产版本

```bash
npm run build
npm run start
```

### 代码检查

```bash
npm run lint
```

## 注意事项

### 坐标系统
大众点评使用 **GCJ-02（火星坐标系）**，本项目地图也使用 GCJ-02 瓦片，坐标直接匹配。

如需转换为 WGS-84（GPS 标准），需要使用坐标转换库（未包含）。

### 速率限制
- 专辑接口：公开接口，较宽松
- 店铺页抓取：每个店铺间隔 1-2 秒，避免触发限制
- 推荐使用离线模式测试

### 合规性
- ✅ 只读公开分享数据
- ✅ 用户主动提供链接
- ✅ 本地存储，不公开分发
- ❌ 不登录、不伪造签名、不批量爬取

## 致谢

产品提案来自「美食肥猫」项目（华为小艺 PM · Jam）

## License

MIT
