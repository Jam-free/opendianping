---
name: feimaocat-cloud
description: >-
  用户想找地方吃饭、问吃点啥/带谁去吃，或提到美食肥猫、「我和我爱吃的朋友们」、好友共享店、「记个美食/帮我记下这家店」（文字、图文、链接）时使用：先理解这顿饭的真实需求，把云端收藏当口味线索与新店一起挑；或把店写入本人收藏。
---
# 美食肥猫 · 云端读写接口

用户在小程序「我和我爱吃的朋友们」里导入、记下或好友共享的店，通过 Agent Token 开放给 AI：可读可写（只写本人数据）。

## 何时用
- **读**：帮用户决定吃什么、带谁吃、规划路线时，作为了解其口味的线索之一。
- **写（记个美食）**：用户说「记一下」「收藏」「心心念念」「加进肥猫」等，并给出纯文字、图片+文字、或美食链接。

## 凭证
- 本机 `~/.config/feimaocat/env`（`FEIMAOCAT_API_BASE`、`FEIMAOCAT_TOKEN`），`source` 读入；也可从同目录 `token` 文件读 Token。
- **绝不**在聊天、日志、截图说明里输出完整 Token。
- 401/403：请用户打开小程序「连接 AI」页重新一键复制指令 / 重置 Token 后再粘贴给你。

## 接口
Header 一律：`Authorization: Bearer $FEIMAOCAT_TOKEN`，`Content-Type: application/json`（写时）。

### 读
- `GET $FEIMAOCAT_API_BASE/api/agent/shops` → `mine`（我的店）+ `friendsShared`（好友共享）
- `GET $FEIMAOCAT_API_BASE/api/agent/friends` → 美食好友

### 写（与小程序「我的店」对齐）
- `POST $FEIMAOCAT_API_BASE/api/agent/shops` — 写入本人店（`origin=agent`）
- `PATCH $FEIMAOCAT_API_BASE/api/agent/shops/:poiKey` — 改本人已有的店（只能改 Token 主人自己的店）
- Body（POST 一次一家；PATCH 只传要改的字段）：
```json
{
  "name": "店名原文",
  "city": "城市",
  "district": "片区或地标",
  "address": "详细地址",
  "category": "品类",
  "phone": "电话",
  "lat": null,
  "lng": null,
  "poiKey": null,
  "note": "≤200字备注",
  "wishlist": false,
  "sourceShopId": "1908397290",
  "dianpingUrl": "https://m.dianping.com/shop/1908397290"
}
```
- `name` 必填（POST）且必须来自用户/链接/图里的原文，禁止臆造。PATCH 可省略。
- `address` ≤200 字，不要把片区写进地址。`category` ≤80 字，`phone` ≤40 字。`lat`/`lng` 必须成对。
- `wishlist: true` = 心心念念；用户没说「很想去/心心念念」时默认 `false`。
- `sourceShopId` / `source_shop_id`：真实点评数字店 id（6–15 位）。`dianpingUrl` / `sourceUrl`：点评公开页，服务端从中取出店 id。`shopId` 只有本身是数字 id 才收下。不编造 shopId。
- 点评定位：服务端**没有**可靠的单店经纬度接口（专辑导入才能从官方专辑接口拿到坐标；`m.dianping.com/shop/{id}` 公开页地址打码、坐标为 0）。只存了点评 id、本地又没有同 id 的专辑导入记录时，`status` 仍为 `pending`。若本库已通过专辑导入过同一家店，会回填地址/坐标，并标 `confirmed`。
- 写入前先尝试找到这家店的大众点评公开链接（搜索后用 `https://m.dianping.com/shop/{id}` 核验店名和城市），有则传 `sourceShopId` 或 `dianpingUrl`，有坐标就传 `lat`/`lng`；找不到就照写，并说明没找到。
- 期望：201 新建；同名同城命中则 200 合并（只补空字段，备注追加，wishlist 覆盖）。PATCH **200**。
- 响应与 GET `mine` 单项一致：`poiKey, name, category, district, city, address, lat, lng, note, origin, wishlist, phone, status, sourceShopId`。
- 限频约 ≤30 次/分钟、≤200 次/天；超限 429 后告知稍后再试。
- 若返回 **404 / Cannot POST**：不要假装已入库，说明接口没上线。

## 字段（读结果）
- `wishlist: true`：用户很想去；为 false 不代表不喜欢。
- `origin`：`imported` 点评专辑 / `checkin` 小程序自己记 / `from_friend` 好友 / `agent` Agent 记下。
- `note`、`poiKey`、`lat`/`lng`、`address`、`category`、`phone`、`status`（`confirmed` / `pending`）、`sourceShopId`（真实点评数字店 id，没有则为 null）。

---

## 记个美食：三种输入怎么抽字段

一次只处理用户本轮明确要记的店；多店时逐家确认。

### A. 纯文字
从原文抽出 `name`、`city`、`district`/地标、`note`、是否 wishlist。店名不确定时用用户原称呼，不要猜成另一家。

### B. 图片 + 文字
1. 看图里可见的店名、地址、菜名。
2. 结合配文；冲突时以配文为准，图上多出的信息放进 `note`。
3. 看不清店名就先问一句。
4. 接口不传图片；要带图入库请用户在小程序「记美食」里拍。

### C. 美食链接
1. 只取页面上真实出现的店名、地址、城市、坐标。
2. 打不开或有登录墙：用用户文字 + 公开标题；仍不够再问店名与城市。
3. 一个链接多家店：列候选让用户选。

### 写前确认（必做）
一两句复述店名、位置、备注要点、是否心心念念，用户点头再 POST（用户说「直接记」可跳过）。写完 GET 核对。`address` / `category` / `phone` / `sourceShopId` 会按正式字段入库，不要再塞进 `note`。

---

## 读：筛店与推荐（先懂人，再用收藏）
核心：收藏是了解用户口味的线索，不是推荐范围。目标是这一顿吃得对，不是把收藏清单念一遍。

1. **先读需求再碰数据**：谁吃（一个人/朋友/外地同学/家人）、几点、在哪、怎么去（开车/步行/顺路）、想要什么感觉（随便填饱/体面招待/想吃某样东西）、时间限制（到得晚就要营业到够晚）。只有缺了会明显改变结果的那一项才问，问一句；其余自己合理假设并说明。
2. **收藏和新店同台竞争**：先按需求定标准，再从收藏和联网新店里一起挑，谁合适谁上。收藏里没有真正合适的就推新店，不要硬塞收藏凑数。
3. **wishlist 只是加分项**：同等合适时优先，但压不过距离、营业时间、人数、场合这些硬条件。
4. **说话自然，像懂吃的朋友**：
   - 回复里不要反复出现「心心念念」「收藏」「清单」这些词；一次回复最多自然提一次，而且只在能帮用户做决定时提（如「你之前就想去这家，正好顺路」）。
   - 不给每家贴来源标签，不分「收藏组/新店组」。
   - 理由围绕这次需求写：为什么适合今天、这些人、这个时间，而不是复述店铺属性。
5. **少而准**：默认一个首选加一两个备选，各有清楚的取舍；用户要更多再加。
6. 联网补营业时间、排队、评分、图片；每家尽量配图，评分写出处；查不到明说，不编。
7. 用 `friendsShared` 时说清是哪位朋友推荐的，熟人口碑可以自然带出。

**发出前自查**：这份推荐换个人、换个场景是不是也一样？是的话说明没贴合需求，重来。

## 约束
- 只读写当前 Token 对应用户的数据；不写朋友的店。
- 不编造 shopId、坐标、店名；不索要点评账号密码；Token 不进聊天。
- `name`≤80 字、`note`≤200 字；批量一次不超过约 20 家。
- 可与 `opendianping`（点评收藏专辑 MCP）并用。
