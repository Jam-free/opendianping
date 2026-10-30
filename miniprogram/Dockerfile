# 微信云托管：目标目录填 miniprogram，Dockerfile 名称填 Dockerfile
# better-sqlite3@13 要求 Node >= 22
FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci || npm install

COPY . .

ENV NODE_ENV=production
ENV PORT=80
# 禁止无盘发布：服务必须挂载持久盘到 /data，且跨版本保持这条路径。
ENV DB_PATH=/data/miniprogram.db
ENV DEV_AUTH_BYPASS=false
ENV SOURCE_ADAPTER=opendianping

EXPOSE 80
CMD ["npx", "tsx", "server/index.ts"]
