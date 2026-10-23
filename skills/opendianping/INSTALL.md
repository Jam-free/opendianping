# 安装 OpenDianping Skill（可分享给其他人）

别人拿到后，需要两样东西：

1. **本 Skill 目录**（`skills/opendianping/`，含 `SKILL.md`）
2. **可运行的 OpenDianping 项目**（提供 MCP）

只拷贝 Skill、不装 MCP → agent 只能念说明书，读不到收藏。

## A. 安装 MCP（必做）

```bash
git clone <你的仓库地址> opendianping
cd opendianping
npm install
```

确认 MCP 能启动：

```bash
npm run mcp
```

（stdio 模式；由 Claude Desktop / Cursor / 支持 MCP 的 agent 拉起时，一般不用手动常驻。）

把下面配置里的路径改成对方机器上的**绝对路径**：

```json
{
  "mcpServers": {
    "opendianping": {
      "command": "npm",
      "args": ["run", "mcp"],
      "cwd": "/绝对路径/opendianping"
    }
  }
}
```

- Claude Desktop：写入对应 `claude_desktop_config.json` 后重启  
- Cursor：Settings → MCP Servers 添加同上  
- 龙虾 / Grokbot / Muse：按其「自定义 MCP」入口粘贴同等配置  

## B. 安装 Skill（教 agent 怎么用）

把整个目录拷到对方 agent 的 skills 位置，例如：

```text
skills/opendianping/
  SKILL.md      ← 主文件（agent 必读）
  KEYS.md       ← 密钥说明
  INSTALL.md    ← 本说明
```

常见做法：

- **Cursor**：放入项目 `.cursor/skills/opendianping/` 或用户 skills 目录  
- **其他 agent**：按其「导入 Skill / 自定义技能」上传本目录或仅 `SKILL.md`  

## C. 第一次使用

1. Agent 应声明：**不需要 API Key**（见 `KEYS.md`）  
2. 用户粘贴专辑分享链接  
3. Agent 调用 `import_album`  
4. 之后可用 `list_shops` / `get_shop` / `shops_near` / `plan_route`，并结合联网信息推荐  

## D. 密钥

见同目录 [`KEYS.md`](./KEYS.md)。**默认零 Key。**
