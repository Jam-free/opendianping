# S5 冒烟验证（PR#2 合并后）

**结论：本地写入用例全部通过；云端「帮我记下这家店」接口还没上线。**

| 项 | 结果 |
|---|---|
| 本地 Jest | **22 通过 / 0 失败**（1 个测试套件） |
| 云端 `POST /api/agent/shops`（空 JSON） | **HTTP 404**（符合「部署前应 404」） |
| 是否开新 PR | 否（仅验证） |

---

## 验证范围

- 分支：`feat/miniprogram-import-circle`
- 提交：`949c57c0a7591330c70bb9cbea051aa64f984c32`
- 提交说明：`feat(agent): POST /api/agent/shops 写入本人收藏 (#2)`
- PR#2：已合并（https://github.com/Jam-free/opendianping/pull/2 ，合并时间 2026-10-30T14:19:26Z）
- 验证时间：2026-10-30 14:21 UTC
- Node：v22.23.4 / npm：10.9.9

这次只检查「Agent 把店写进本人收藏」这一条能力：本地用测试把各种情况跑一遍；线上用空请求探一下接口在不在。没有改业务代码，也没有开新的合并请求。

---

## 1. 本地 Jest

命令（在 `miniprogram/` 目录）：

```bash
NODE_OPTIONS=--experimental-vm-modules npx jest --config jest.config.cjs __tests__/agent-shops-write.test.ts --verbose
```

汇总：

```
Test Suites: 1 passed, 1 total
Tests:       22 passed, 22 total
Snapshots:   0 total
Time:        2.2 s
Ran all test suites matching __tests__/agent-shops-write.test.ts.
```

| 计数 | 数量 |
|---|---|
| PASS（通过） | **22** |
| FAIL（失败） | **0** |
| 跳过 / TODO | 0 |
| 测试套件 | 1 通过 / 0 失败 |

### 用例清单（全部 PASS）

| # | 用例 | 在测什么 | 结果 |
|---|---|---|---|
| 1 | S5-NEG-01/02/03/04：无效 Token 一律 401 | 没票、假票、登录票都不能写店 | PASS |
| 2 | E2E-A1 / S5-API-01/02/04：首写 201、pending、GET mine 可见、不编造 shopId | 第一次记下成功；只有店名城市时标「待确认」；不会伪造点评编号 | PASS |
| 3 | E2E-A2：wishlist=true 后 GET 可按心心念念筛到 | 点心形后能在「心心念念」里找到 | PASS |
| 4 | E2E-A3：重置 Token 后旧票 401，新票可写 | 用户重置密钥后，旧钥匙立刻失效 | PASS |
| 5 | E2E-A4 / S5-SEC-02：仅 name+city → pending，永不写 source_shop_id | 即使请求里塞了点评 ID 也不会入库 | PASS |
| 6 | E2E-A5 / H5 / H6：同名同城二次 POST 200，备注追加，wishlist=true | 同一家店再记一次会合并，备注叠上去 | PASS |
| 7 | S5-API-07：不同城同名是两家店 | 曼谷河粉和清迈河粉是两家 | PASS |
| 8 | S5-API-05/08：同 poiKey 合并；不同 poiKey 不误合并 | 同一地图点合并，不同点不误并 | PASS |
| 9 | H3：仅有未校验坐标仍 pending；合法 poiKey 才 confirmed | 只有坐标仍待确认；有合法地图钥匙才确认 | PASS |
| 10 | H2 / S5-API-13：展示名保留原文，去重只用 trim | 店名按用户原话保存 | PASS |
| 11 | H7 / S5-OUT-01：数组 body → 400，不落库 | 一次塞多家会被拒绝，库里不留脏数据 | PASS |
| 12 | S5-VAL：缺 name / 空白 / 超长 → 400 | 缺店名、空白、超长备注都拦下 | PASS |
| 13 | S5-NEG-05：body 里的 userId 不能写到别人名下 | 不能把店写到别人账上 | PASS |
| 14 | S5-NEG-07 / S5-OUT-02/03：Agent Token 不能冒充登录写接口；新店只出现在 mine | Agent 钥匙不能建圈/记打卡；新店只出现在「我的」 | PASS |
| 15 | S5-RL-01：每分钟超过 30 次 → 429（打桩分钟闸） | 写太快会限流 | PASS |
| 16 | S5-RL-02：限流按用户隔离 | A 超限不影响 B | PASS |
| 17 | S5-RL-03 P2：日限额 200 可打桩 429 | 日配额打满后拒绝 | PASS |
| 18 | S5-RL-01 辅助：tryConsumeAgentShopWrite 第 31 次失败 | 分钟闸第 31 次失败 | PASS |
| 19 | S5-NEG-08：写入 429 后 GET 仍可用 | 写被限流时，读清单仍然可用 | PASS |
| 20 | S5-SEC-05：note 含脚本按原文入库，JSON 回读不执行 | 备注里的脚本当普通文字存，不会执行 | PASS |
| 21 | S5-API-12：POST 响应字段集合与 GET mine 单项一致 | 写下后的返回字段与「我的店」一条对齐 | PASS |
| 22 | S5-DOC-01：skill 从只读改为可写本人店 | 对外说明已改成「可写本人店」 | PASS |

失败列表：**无。**

过程中有 ts-jest 的 `TS151002` 提示（混合模块设置建议开 `isolatedModules`），以及写入成功时的 `agent_shop_write` 日志。这些不影响通过/失败计数。

---

## 2. 云端探活（空 JSON POST）

请求（按任务要求：空 JSON，无 Token）：

```bash
curl -sS -D - -X POST \
  'https://feimaocat-api-311874-12-1485452020.sh.run.tcloudbase.com/api/agent/shops' \
  -H 'Content-Type: application/json' \
  -d '{}'
```

| 项 | 值 |
|---|---|
| HTTP 状态码 | **404** |
| 上游状态 | `x-cloudbase-upstream-status-code: 404` |
| 响应摘要 | `Cannot POST /api/agent/shops`（Express 默认 404 页） |
| 时刻 | 2026-10-30T14:20:55 GMT |

含义：线上还没有这版「帮我记下」写入接口。Skill 约定：遇到 404 要如实告诉用户「先记在对话里，接口上线后再写入」，**不要假装已经入库**。

对照（同一网关、同一路径的 GET，非本次必做，用于判断「读已上线、写未上线」）：

```bash
curl -sS -D - -X GET \
  'https://feimaocat-api-311874-12-1485452020.sh.run.tcloudbase.com/api/agent/shops'
```

| 项 | 值 |
|---|---|
| HTTP 状态码 | **401** |
| 响应 | `{"error":"无效的 Agent Token"}` |

GET 已在线上（没带钥匙会拒绝访问）；POST 仍是 404，说明云托管尚未发布 PR#2 这版。

---

## 3. 产品解读

- **本地**：Agent 写入本人店的规则已经齐——能记、能合并、能点心形、不能写别人、不能伪造点评编号、写太快会限流。
- **线上**：用户现在对云端说「帮我记下」还写不进去，需要等这次发布部署后，同样的空请求才会从 404 变成鉴权失败（401）或参数错误（400）。
- **下一步（非本次）**：部署云托管后再探一次 POST；部署成功后，空 JSON 不应再是 404。

本次**未开新 PR**，仅记录验证结果。
