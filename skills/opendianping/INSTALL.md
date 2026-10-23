# 安装 OpenDianping Skill

别人拿到后需要两样：

1. **本 Skill 目录**（`skills/opendianping/`）
2. **可运行的 OpenDianping 项目**（提供 MCP）

只拷贝 Skill、不装项目 → AI 只能按说明书引导，读不到收藏。

## A. 安装项目（必做）

```bash
git clone https://github.com/Jam-free/opendianping.git
cd opendianping
npm install
```

把下面配置里的路径改成对方机器上的**绝对路径**，写入 Claude Desktop / Cursor / 龙虾 / Grokbot / Muse 等支持 MCP 的配置：

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

重启客户端后即可使用。

## B. 安装 Skill

把整个目录放到对方 agent 的 skills 位置，例如：

```text
skills/opendianping/
  SKILL.md
  INSTALL.md
  AGENT_NOTES.md
```

- **Cursor**：项目 `.cursor/skills/opendianping/` 或用户 skills 目录  
- **其他 agent**：按其「导入 Skill」入口上传本目录或 `SKILL.md`

## C. 第一次使用（对用户怎么说）

> 把大众点评收藏专辑的分享链接发给我。  
> 路径：收藏 → 打开专辑 → 分享 → 复制链接。

不要对用户提开发者密钥类说法。详见 `SKILL.md` 第 0 节。
