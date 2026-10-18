# 大众点评公开专辑接口字段调研（albumid=12498807）
测试时间 2026-10-18（UTC+8）。全部请求：iPhone Safari UA + Referer，无 cookie、无登录、无签名，约 10 次请求。原始响应在 `12498807/`（r0.json、ep_*.json、shop_*.html、fieldtree.txt 为全量字段树）。

## 1. 接口
| 接口 | 参数 | 免登录 | 结果 |
|---|---|---|---|
| `mapi.dianping.com/mapi/collect/getfavoralbumdetail.bin`（页面 JS 实际调用） | albumid, type(0=首屏, 1=商户翻页, 内容 tab 推测为 2), nextstart, albumencryptid（可空）, favorVersion=3.0 | ✅ 200 | 新版结构 `favorList`：评分、推荐理由、tracingInfo，**没有经纬度** |
| 同上，**不带 favorVersion**（旧版格式） | albumid, type=0 | ✅ 200 | 旧版结构 `collectItemList`：**带经纬度 lat/lng**、location（商圈+品类）、argPrice |
| 同上，type=1&nextstart=0 | | ✅ 200 | 翻页可用；本专辑只有 6 家，isEnd=true（nextStart=20，推测每页 20 条） |
| 同上，type=2 | | ✅ 200 | 内容 tab，本专辑为空（contentCount=0） |
| `mapi.dianping.com/mapi/share/getsharelist.bin` | schemaid, biztype=10001, mapi_cacheType=0（对应 collectionlist 分享页） | ⚠️ 200 但正文为空 | 用 albumid 当 schemaid 不对；schemaid 要另一种分享链接才拿得到（推测） |
| `/mapi/collect/getfavoralbumlist.bin?userid=`（**我猜的接口名，JS 里没有**） | | ❌ 450「协议无效」code 45014 | 推测要 App 签名协议；我没有伪造签名 |
| `m.dianping.com/shop/{shopId}`（手机版商详页 HTML） | | ✅ 200 | 店名、商圈、**推荐菜名单**、营业状态；地址和电话**打码** |
| JS 中引用的其他页面（未测） | m.dianping.com/guide/、mixguide?guideid=、ugcdetail/ | – | 榜单/笔记页面 |

**按 userId 列出这个人的其他公开专辑：做不到。** 页面 JS 只引用了上面两个 mapi 接口，没有专辑列表接口；我猜的接口名被协议校验拒绝。

## 2. 字段（每家店）
| 字段 | 含义 | 示例 | 打码? |
|---|---|---|---|
| favorList[].title / collectItemList[].title | 店名 | 懂爱小面·鸡公煲（竹村店） | 否 |
| favorInfo.bizId / tracingInfo.poi_id | shopId | 1908397290 | 否 |
| favorInfo.bizUuid / tracingInfo.shopUuid | shopuuid | las9lH3v3YIqcicO | 否 |
| tracingInfo.shopIdEncrypt | 加密 shopId（推测给 App 跳转用） | qB4r17… | 否 |
| tracingInfo.cityId | 城市 ID | 7（深圳） | 否 |
| tracingInfo.shopCategoryId / shopType | 品类 ID / 大类 | 1959 / 10（美食） | 否 |
| secondSubTitle 富文本 | 城市、品类、商圈 | 深圳 / 粥粉面 观澜商圈 | 否 |
| firstSubTitle 富文本 | 评价数 | 137条 | 否 |
| fiveScore | 五分制评分 | 3.9 | 否 |
| star / shareInfo.shopPower | 星级 ×10 | 35 | 否 |
| shareInfo.content | 星级+人均 | ★★★☆, ¥19/人 | 否 |
| albumRecReason.reason | 推荐理由（推测取自大众评价摘要，不是专辑作者的备注；author=false） | 味道很好,服务好,环境很干净 | 否 |
| thirdSubTitle | 标签/榜单图标 | 付费停车、有无障碍设施 | 否 |
| headImg | 头图 | img.meituan.net/… | 否 |
| shareInfo.webUrl | 分享 H5 链接 | m.dianping.com/appshare/shop/{uuid} | 否 |
| jumpUrl | App deeplink | dianping://shopinfo?id=…&cityid=7 | 否 |
| userHaveBeen.* / isDeleted / power | 当前访客是否去过（未登录时全是 false）/ 店铺已删除 / 未知 | false / false / 5 | – |
| shopRecDishList | 推荐菜 | null（专辑接口不返回） | – |
| **旧版** lat / lng | 经纬度 | 22.687574, 114.040197 | **否（真实值）** |
| **旧版** location / argPrice / topCategoryId | 商圈+品类 / 人均 / 一级类目 | 观澜商圈 粥粉面 / ¥19/人 / 10 | 否 |
| m.dianping 商详 regionName | 商圈 | 观澜商圈 | 否 |
| m.dianping 商详 dishName | 推荐菜 | 豌豆杂酱面、蹄花面… | 否 |
| m.dianping 商详 address / phoneNo | 地址 / 电话 | 观澜大道6****** / 17***** | **是** |
| m.dianping 商详 lat/lng | | 0 / 0 | 未登录返回 0 |

## 3. 字段（专辑级）
favorAlbumItem：albumId、title（坂田）、shopCount（6）、contentCount、introduction / richTextIntro（null）、createTime / latestModifyTime（毫秒时间戳，2025-06-04 / 2026-06-24）、favorCount、shareCount、collaborative、basicImage；authorInfo：userId、userName（自由）、avatar、level（2）、profileUrl；外加 authorIMChatUrl（私信 deeplink）、isLogin=false、status=0。

## 4. 拿不到的
完整地址、电话（打码）；营业时间具体时段（只返回「营业中」）；行政区（只有商圈）；专辑作者给每家店写的备注（专辑接口没有这个字段）；按 userId 列出作者的所有专辑；用户「我的收藏」（要登录）。

## 5. 美食肥猫怎么用
1. 用户粘贴专辑分享链接，解析出 albumid（如果是 albumencryptid 也一并透传）。
2. 调两次 getfavoralbumdetail.bin：新版拿评分/推荐理由/类目，旧版拿 lat/lng。type=1 按 nextstart 翻页，直到 isEnd。
3. 按 shopId 低频拉 m.dianping.com/shop/{id}，补推荐菜和商圈，用来跟视频里解析出的菜品交叉验证。
4. 用 shopId 加经纬度做主键去重、挂地图，跟抖音解析结果按「店名相似 + 距离 < 300m」匹配（阈值待定）。地址打码不影响匹配。
5. 注意：没有官方开放接口，接口可能随时变；只按用户主动分享的链接、低频读取，不做批量爬取。
