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
- `PATCH $FEIMAOCAT_API_BASE/api/agent/shops/:poiKey` — 改**本人**已有的店（只能改 Token 主人自己的店）

写店字段与小程序「我的店」对齐（一次一家；**不要编造**点评 shopId）：

| 请求字段 | 必填 | 说明 |
|----------|------|------|
| `name` | POST 必填 | 店名，用用户原话，≤80 字 |
| `city` | 否 | 城市，≤40 字 |
| `district` | 否 | 片区/商圈，≤80 字 |
| `address` | 否 | 详细地址，≤200 字；**不要**把片区写进地址 |
| `category` | 否 | 品类，≤80 字 |
| `phone` | 否 | 电话，≤40 字 |
| `lat` / `lng` | 否 | 必须成对；仅有坐标仍可能是 `pending` |
| `note` | 否 | 备注，≤200 字 |
| `wishlist` | 否 | `true` = 心心念念 |
| `poiKey` | 否 | 地图 POI id（高德），有则 `status=confirmed` |
| `sourceShopId` / `source_shop_id` | 否 | **真实**点评数字店 id（6–15 位数字） |
| `dianpingUrl` / `sourceUrl` | 否 | 点评公开页，如 `https://m.dianping.com/shop/1908397290`；服务端从中取出店 id |

`shopId` 只有本身是点评数字 id 才会收下；像 `fake-dianping-id` 这种字符串会被丢掉。服务端**不会**自己生成点评 id。

同店再次 POST：空字段用新值补上，已有值不覆盖。`note` 追加。

```bash
curl -sS -X POST "$FEIMAOCAT_API_BASE/api/agent/shops" \
  -H "Authorization: Bearer $FEIMAOCAT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"泰式河粉","city":"曼谷","district":"素坤逸","address":"Sukhumvit Soi 11","category":"泰餐","phone":"02-000-0000","note":"酒店天桥下那家","wishlist":true,"sourceShopId":"1908397290"}'
```

改已有店（`poiKey` 用 GET/POST 返回的值；也可以是点评数字 id）：

```bash
curl -sS -X PATCH "$FEIMAOCAT_API_BASE/api/agent/shops/$POI_KEY" \
  -H "Authorization: Bearer $FEIMAOCAT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"address":"Sukhumvit Soi 11","category":"泰餐","wishlist":true}'
```

成功：新店 **201**，同店合并 / PATCH **200**。响应字段与 GET `mine` 单项一致：`poiKey, name, category, district, city, address, lat, lng, note, origin, wishlist, phone, status, sourceShopId`。

点评定位：服务端**没有**可靠的单店经纬度接口（专辑导入才能从官方专辑接口拿到坐标；`m.dianping.com/shop/{id}` 公开页地址打码、坐标为 0）。因此只存了点评 id、本地又没有同 id 的专辑导入记录时，`status` 仍为 `pending`。若本库已通过专辑导入过同一家店，会回填地址/坐标，并标 `confirmed`。

## 字段语义（做规划时必读）

| 字段 | 含义 |
|------|------|
| `wishlist: true` | **心心念念**——用户很想去的店。筛「想去哪」时优先用这些；熄灭不等于删店 |
| `origin: imported` | 从大众点评专辑导入 |
| `origin: checkin` | 用户自己「记美食」落下的店 |
| `origin: from_friend` | 从好友清单加到自己名下 |
| `origin: agent` | Agent 记下（小程序来源文案「Agent 记下」） |
| `status: pending` | 只有店名/城市，或仅有未校验坐标；还不能当精确地点 |
| `status: confirmed` | 有合法 `poiKey`（地图 POI），或点评 id 已在专辑导入里核验过 |
| `sourceShopId` | 真实点评数字店 id；没有则为 `null`。不要编造 |
| `address` / `category` / `phone` | 与小程序「我的店」同一套字段 |
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
- 不要编造 shopId / 大众点评 `sourceShopId`；没有真实点评链接或数字 id 就留空。只存了未核验的点评 id、又没有 `poiKey` 时，`status=pending`
- `name` 必填且用用户原话（≤80 字），`note` ≤200 字；一次只写一家
- Token 可被用户随时重置，失败时提示重新打开「连接 AI」页
- 「心心念念」≠ 收藏夹清空：用户取消心形后店仍可能在 `mine` 里，只是 `wishlist` 为 false
- 若 `POST /api/agent/shops` 返回 **404**，说明云端还未发这版接口：如实告诉用户「先记在对话里，接口上线后再写入」，**不要假装已经入库**
