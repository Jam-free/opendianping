# 微信云托管（仓库根为构建上下文）
# 控制台：目标目录留空；Dockerfile 名称填 Dockerfile
# 专辑解析已内置 miniprogram/server/adapters/album-fetch.ts，不再依赖根目录 lib
FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY miniprogram/package.json miniprogram/package-lock.json ./miniprogram/
WORKDIR /app/miniprogram
RUN npm ci || npm install

WORKDIR /app
COPY miniprogram ./miniprogram

WORKDIR /app/miniprogram

ENV NODE_ENV=production
ENV PORT=80
ENV DB_PATH=/data/miniprogram.db
ENV DEV_AUTH_BYPASS=true
ENV SOURCE_ADAPTER=opendianping

EXPOSE 80
CMD ["npx", "tsx", "server/index.ts"]
