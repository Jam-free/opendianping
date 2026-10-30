# 美食肥猫 · 云端 Agent Skill

把用户在「我和我爱吃的朋友们」小程序里导入 / 记下 / 好友共享的店，开放给你的 AI（只读），用于出行规划与美食筛选。

## 安装

1. 用户在小程序「连接 AI」页生成并复制 Token（`fm_…`）
2. 把本目录 `skills/feimaocat-cloud/` 放到 agent 的 skills 位置（或克隆仓库后指向该目录）
3. 配置环境变量（域名以小程序「连接 AI」页复制内容为准）：

```bash
export FEIMAOCAT_API_BASE="https://feimaocat-api-311874-12-1485452020.sh.run.tcloudbase.com"
export FEIMAOCAT_TOKEN="fm_……"
```

不要使用 `npx skills add feimaocat/food-network`——该包不存在。

## 调用

所有请求带 Header：`Authorization: Bearer $FEIMAOCAT_TOKEN`

- `GET $FEIMAOCAT_API_BASE/api/agent/shops` — 我的店 + 好友共享店
- `GET $FEIMAOCAT_API_BASE/api/agent/friends` — 美食好友列表

## 字段语义（做规划时必读）

| 字段 | 含义 |
|------|------|
| `wishlist: true` | **心心念念**——用户很想去的店。筛「想去哪」时优先用这些；熄灭不等于删店 |
| `origin: imported` | 从大众点评专辑导入 |
| `origin: checkin` | 用户自己「记美食」落下的店 |
| `origin: from_friend` | 从好友清单加到自己名下 |
| `note` | 用户或导入时留下的短备注（评论流另有多条，当前网关以 note / 列表为主） |
| `friendsShared` | 美食网里朋友共享、但未必在自己列表里的店 |

**推荐用法**

1. 先问清楚场景（今晚附近 / 周末片区 / 带父母…）
2. 用 `wishlist === true` 做「很想去」主候选；不够再扩到全部 `mine`
3. 可用 `friendsShared` 与好友口味交叉，但说清楚哪些是朋友的
4. 结合公开联网信息补营业、排队、季节菜；不要编造 shopId

## 能力

- 查看我的店、心心念念清单、附近推荐、好友口味、导出清单、路线建议、搜索店铺  
  （基于上述 JSON，由你本地推理完成；本网关不跑模型）

## 约束

- 只读；不要编造 shopId；不要索要点评账号密码
- Token 可被用户随时重置，失败时提示重新打开「连接 AI」页
- 「心心念念」≠ 收藏夹清空：用户取消心形后店仍可能在 `mine` 里，只是 `wishlist` 为 false
