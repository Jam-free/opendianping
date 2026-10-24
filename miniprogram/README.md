# 美食肥猫小程序（重构版 · 今日真机）

双 Tab：**美食朋友圈** / **我的店**。邀请好友共享收藏；导入点评专辑；记美食；连接 AI。

视觉：微信读书风（浅灰底、白卡片、蓝色主按钮）。规格演进见仓库 `docs/`；上云步骤见 [`CLOUD_DEPLOY.md`](./CLOUD_DEPLOY.md)。

## 目录

```
miniprogram/
├── client/          # 微信小程序
├── server/          # Express API + SQLite
├── CLOUD_DEPLOY.md  # 云托管真机清单
├── Dockerfile       # 仓库根目录构建
└── Dockerfile.standalone
```

## 本地运行

```bash
cd miniprogram
cp .env.example .env
npm install
npm run dev          # http://127.0.0.1:8787
```

微信开发者工具打开：`miniprogram/client`  
详情 → 本地设置：勾选「不校验合法域名」。

## 主界面

| Tab | 能力 |
|-----|------|
| 朋友圈 | 邀请好友、美食好友列表、完善头像昵称 |
| 我的店 | 导入 / 连接 AI / 记美食 + 我的店铺列表 |

## 真机

按 [`CLOUD_DEPLOY.md`](./CLOUD_DEPLOY.md) 部署微信云托管，把 `client/utils/config.ts` 的 `API_BASE` 改成 HTTPS 域名后上传体验版。
