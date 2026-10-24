# 美食肥猫 · 云端 Agent Skill

把用户在「美食肥猫」小程序里导入 / 记下 / 好友共享的店，开放给你的 AI（只读）。

## 安装

1. 用户在小程序「连接 AI」页复制 Token（`fm_…`）
2. 配置环境变量：

```bash
export FEIMAOCAT_API_BASE="https://你的云托管域名"
export FEIMAOCAT_TOKEN="fm_……"
```

## 调用

所有请求带 Header：`Authorization: Bearer $FEIMAOCAT_TOKEN`

- `GET $FEIMAOCAT_API_BASE/api/agent/shops` — 我的店 + 好友共享店
- `GET $FEIMAOCAT_API_BASE/api/agent/friends` — 美食好友列表

## 能力

- 查看我的店、附近推荐、好友口味、导出清单、路线建议、搜索店铺  
  （基于上述 JSON，由你本地推理完成；本网关不跑模型）

## 约束

- 只读；不要编造 shopId；不要索要点评账号密码
- Token 可被用户随时重置，失败时提示重新打开「连接 AI」页
