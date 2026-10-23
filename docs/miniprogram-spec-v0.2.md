# 小程序规格 v0.2：导入收藏 + 微信群共享收藏圈
状态：v0.2（10/24）。决策：数据源采用 OpenDianping（Jam 已拍板），只读用户主动分享的公开专辑，不登录、不绕验证，请求限速。

## 0. 信息架构（v0.2 新增）
- 页1「圈子店铺」（首页）：圈内所有成员共享收藏的店，按离我从近到远排序；卡片显示「推荐人」头像+昵称（最多3个，余下显示 +N）。顶部可切换圈子、筛城市/品类。
- 页2「圈友」：圈内成员列表（头像、昵称、共享店数）；点进去看该朋友的共享收藏，同样按距离排序。
- 全局三个核心按钮（底部常驻）：①导入（粘贴点评专辑链接）②发定位记美食（取当前定位，从附近店中选一家收藏，可加备注/拍照）③邀请加入圈子（分享到微信群）。

## 0.1 定位与距离
- wx.getLocation(type=gcj02) 获取当前坐标；首次进入请求授权，拒绝时按「圈内城市→收藏时间」排序，并提示可开启定位。
- 店铺坐标：来自 OpenDianping 返回的经纬度；缺失时用高德 POI 实时取，不落库。坐标统一 GCJ-02。
- 距离：后端用 Haversine 计算直线距离，<1km 显示「xxx m」，否则「x.x km」，跨城显示城市名。分页 20 条，按距离升序；坐标缺失的店排在最后。
- 位置刷新：进入首页或下拉刷新时更新，移动超过 500m 重新排序；用户坐标不落库、不共享给圈友。

## 0.2 多人收藏同一家店的合并
- 归一键：优先 source_shop_id（点评店 id，来自专辑原文，不编造）；其次 amap_poi_id；都没有时用「规范化店名+坐标 100m 内」判定，并标「疑似同店」，由用户确认后再合并。
- 合并展示：圈视图一店一卡；推荐人按收藏时间排序；收藏人数=去重成员数；每人备注折叠展示，可展开。
- 单人删除/设私密/退圈只移除自己的推荐记录；最后一位推荐人移除后卡片消失。
- 店铺展示字段以最近一次刷新为准，不用某个成员的旧数据覆盖。


## 1. 功能一：导入收藏并渲染店铺卡片
US-1 作为用户，我点「导入收藏」，粘贴自己在点评**主动分享的专辑链接**（含 albumid），系统解析出店铺，渲染成卡片，我勾选后存入收藏。
流程：首页「导入收藏」→ 粘贴链接/文本 → 解析（调用来源适配器）→ 预览卡片列表（全选/单选）→ 保存 → 结果「成功 X / 重复 Y / 失败 Z」。
卡片信息布局（参考点评卡片层级，自有样式，不用点评 logo/图片）：店名（文字，主标题）｜人均｜品类·商圈｜地址（单行省略）｜距离（有定位时）｜来源标签（点评专辑/视频/拍照）｜操作：收藏、导航（打开高德/腾讯地图）。评分/图片仅当来源合规可展示时显示，否则隐藏该区块。
验收：
1. 专辑链接解析 ≤10s（P90，≤200 家），超出截断并提示。
2. 卡片字段全部来自适配器返回，缺失字段隐藏，不填占位假数据；不编造 shopId。
3. 同店去重（按 source_shop_id 或匹配到的 amap_poi_id），来源取并集。
4. 链接无效/私密专辑/解析失败给明确提示，可重试；部分成功可保存。
5. 用户可删除导入的任一条；可一键撤销整批导入。

## 2. 功能二：分享到微信群，共享收藏圈
US-2 作为圈主，我在小程序里「创建收藏圈」并分享到微信群，群友点卡片接受邀请后加入。
US-3 作为成员，我能看到圈内其他成员共享的店，按城市/成员/品类筛选，并看到「N 位圈友收藏」。
US-4 作为成员，我能选择哪些收藏共享到圈（默认：整批导入时询问；可单条设私密），随时退出圈。
流程：
1. 创建圈：填圈名 → 生成 circle_id + 邀请 token（有效 7 天，可重置）。
2. 分享：wx.showShareMenu({withShareTicket:true}) + onShareAppMessage，path=/pages/join?c=circle_id&t=token。
3. 加入：群友打开 → wx.login 换 openid → 展示圈信息和「加入」按钮（必须主动点，不自动加入）→ 校验 token → 写 member。
4. 可选群绑定：用 shareTicket + wx.getGroupEnterInfo 解出 opengid，圈可限定「仅本群成员可加入」。
5. 圈视图：合并成员共享收藏，按 poi 聚合，显示收藏人头像昵称（用户授权后）。
验收：
1. 未加入者访问圈数据返回 403；token 过期/重置后旧链接不能加入。
2. 私密收藏、非共享收藏绝不出现在圈视图（含聚合计数）。
3. 成员退出或被圈主移除后，其收藏 1 分钟内从圈视图消失，本人收藏不受影响。
4. 圈主可改名、重置邀请、移除成员、解散圈；成员上限 200。
5. 昵称/圈名/备注接入微信内容安全接口（msgSecCheck）。

## 3. 数据模型
- users(id, openid, unionid?, nickname?, avatar?, created_at)
- shops(id, source_type[dianping_album|amap|video|photo], source_shop_id?, amap_poi_id?, raw_name, adcode?, display_cache_policy) ——高德内容不落库；第三方字段是否可存由第 6 节决定
- favorites(id, user_id, shop_id, note≤200, visibility[private|circles], import_batch_id, created_at, UNIQUE(user_id, shop_id))
- import_batches(id, user_id, source_type, source_url, albumid?, status, counts, created_at)
- circles(id, name, owner_id, invite_token, token_expires_at, opengid?, member_limit, created_at)
- circle_members(circle_id, user_id, role[owner|member], joined_at, UNIQUE)
- circle_shares(circle_id, favorite_id) ——为空时按 visibility=circles 全量共享
## 4. 权限
所有写操作校验 user_id；圈读接口校验成员身份；聚合查询在 SQL 层过滤 visibility；邀请 token 一次性生成、可撤销；接口限流（导入 5 次/分钟/用户）。

## 5. 数据来源适配器（可替换）
接口：parse(input) -> [{name, address?, avg_price?, category?, district?, lat/lng?, source_shop_id?, source_url}]
- A（已定为默认）：OpenDianping（import_album / get_shop / list_shops / shops_near / plan_route，仓库 github.com/Jam-free/opendianping）
- B（降级兜底）：只从用户粘贴的文本中识别店名 → 高德匹配，只存 poi_id
- C：用户手动添加 / 拍照「记住这家店」
配置开关切换，前端卡片只依赖统一字段。

## 6. 风险与决策
R1 合规（Jam 10/24 已拍板）：采用 OpenDianping，只读用户主动分享的公开专辑，不登录、不绕验证码、不批量爬取；限速（建议全局 ≤1 次/秒，每用户 ≤5 次导入/分钟，失败指数退避，遇到验证页立即停止并降级到方案 B）。剩余风险：点评条款和反爬策略的变化，需要监控失败率。
R2 平台审核：小程序展示第三方平台评分、图片、品牌可能被微信审核驳回或被投诉；卡片默认不显示评分图片。
R3 数据存储：点评字段落库有版权/条款风险，建议只存 source_shop_id + 用户备注，展示实时取。
R4 隐私：共享圈暴露成员饮食与位置偏好，默认私密，需明确授权文案；opengid 仅用于校验不展示。
R5 依赖：小程序主体资质、AppID、服务器域名备案；高德 key 与 LLM key 仍待 Jam 提供。
R6 链路稳定性：点评页结构变化导致适配器失效，需降级到 B 并告警。

## 7. 排期建议
S2：功能一（适配器 B 先上，A 视拍板接入）+ 卡片；S3：共享圈（创建/邀请/加入/圈视图）；S4：群绑定、聚合榜单。
