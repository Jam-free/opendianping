# 微信云托管（仓库根为构建上下文）
# 控制台：目标目录留空；Dockerfile 名称填 Dockerfile
# 含 lib/fetcher，可解析大众点评公开专辑链接
FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 根目录依赖：lib/fetcher 需要 node-html-parser 等
COPY package.json package-lock.json ./
RUN npm ci --omit=dev || npm install --omit=dev

COPY miniprogram/package.json miniprogram/package-lock.json ./miniprogram/
WORKDIR /app/miniprogram
RUN npm ci || npm install

WORKDIR /app
COPY lib ./lib
COPY miniprogram ./miniprogram

WORKDIR /app/miniprogram

ENV NODE_ENV=production
ENV PORT=80
ENV DB_PATH=/data/miniprogram.db
ENV DEV_AUTH_BYPASS=true
ENV SOURCE_ADAPTER=opendianping

EXPOSE 80
CMD ["npx", "tsx", "server/index.ts"]
