# 美食肥猫 · 云端 Agent Skill

把用户在「我和我爱吃的朋友们」小程序里导入 / 记下 / 好友共享的店，开放给你的 AI（可读可写**本人**店），用于出行规划、美食筛选，以及在对话里「帮我记下这家店」。

## 安装（任选一种）

### A. 用户粘贴「一键复制」内容（推荐，Grok / 任意 Bot 都适用）

小程序「连接 AI」→ **一键复制完整指令** → 粘贴给你。  
里面已有 `FEIMAOCAT_API_BASE`、真实 `FEIMAOCAT_TOKEN` 和接口说明；**不必再装 npm 包，也不必能访问 GitHub 才开始工作**。

### B. 从公开仓库读取本说明

仓库公开：https://github.com/Jam-free/opendianping  
本文件在 **默认分支 main**：

- 目录：https://github.com/Jam-free/opendianping/tree/main/skills/feimaocat-cloud  
- 原文：https://raw.githubusercontent.com/Jam-free/opendianping/main/skills/feimaocat-cloud/SKILL.md  

```bash
export FEIMAOCAT_API_BASE="https://feimaocat-api-311874-12-1485452020.sh.run.tcloudbase.com"
export FEIMAOCAT_TOKEN="fm_……"   # 以用户粘贴为准
```

不要使用 `npx skills add feimaocat/food-network`——该包不存在。

## 调用

所有请求带 Header：`Authorization: Bearer $FEIMAOCAT_TOKEN`

- `GET $FEIMAOCAT_API_BASE/api/agent/shops` — 我的店 + 好友共享店
- `GET $FEIMAOCAT_API_BASE/api/agent/friends` — 美食好友列表
- `POST $FEIMAOCAT_API_BASE/api/agent/shops` — 写入**本人**「我的店」/ 心心念念（`origin=agent`）

写店示例（一次一家；不要编造点评 shopId）：

```bash
curl -sS -X POST "$FEIMAOCAT_API_BASE/api/agent/shops" \
  -H "Authorization: Bearer $FEIMAOCAT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"泰式河粉","city":"曼谷","district":"都市酒店天桥下","note":"酒店天桥下那家","wishlist":false}'
```

成功：新店 **201**，同店合并 **200**。响应字段与 GET `mine` 单项一致，含 `status`（`pending` | `confirmed`）。

## 字段语义（做规划时必读）

| 字段 | 含义 |
|------|------|
| `wishlist: true` | **心心念念**——用户很想去的店。筛「想去哪」时优先用这些；熄灭不等于删店 |
| `origin: imported` | 从大众点评专辑导入 |
| `origin: checkin` | 用户自己「记美食」落下的店 |
| `origin: from_friend` | 从好友清单加到自己名下 |
| `origin: agent` | Agent 记下（小程序来源文案「Agent 记下」） |
| `status: pending` | 只有店名/城市，或仅有未校验坐标；还不能当精确地点 |
| `status: confirmed` | 请求带了合法 `poiKey`（存为地图 POI，**不是**点评 shopId） |
| `note` | 用户或导入时留下的短备注 |
| `friendsShared` | 美食网里朋友共享、但未必在自己列表里的店 |

**推荐用法**

1. 先问清楚场景（今晚附近 / 周末片区 / 带父母…）
2. 用 `wishlist === true` 做「很想去」主候选；不够再扩到全部 `mine`
3. 可用 `friendsShared` 与好友口味交叉，但说清楚哪些是朋友的
4. 结合公开联网信息补营业、排队、季节菜；不要编造 shopId
5. 用户说「帮我记下」时：先**复述店名**，并确认要不要标「心心念念」，得到明确同意后再 POST

## 能力

- 查看我的店、心心念念清单、附近推荐、好友口味、导出清单、路线建议、搜索店铺
- 在用户确认后，把对话里提到的店写入本人「我的店」（可同时点心形）
  （基于上述 JSON，由你本地推理完成；本网关不跑模型）

## 约束

- 可写**本人**店；写前向用户确认店名与是否心心念念。不要写朋友的店、不要代建圈子、不要代导入点评专辑
- 不要编造 shopId / 大众点评 `source_shop_id`；没有 `poiKey` 时允许 `status=pending`
- `name` 必填且用用户原话（≤80 字），`note` ≤200 字；一次只写一家
- Token 可被用户随时重置，失败时提示重新打开「连接 AI」页
- 「心心念念」≠ 收藏夹清空：用户取消心形后店仍可能在 `mine` 里，只是 `wishlist` 为 false
- 若 `POST /api/agent/shops` 返回 **404**，说明云端还未发这版接口：如实告诉用户「先记在对话里，接口上线后再写入」，**不要假装已经入库**
