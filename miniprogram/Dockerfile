# 微信云托管 / 通用容器：美食肥猫 API
FROM node:20-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 复用仓库根目录的 OpenDianping 适配器时，构建上下文应为 opendianping/
COPY package.json package-lock.json ./
COPY miniprogram/package.json miniprogram/package-lock.json ./miniprogram/

RUN npm ci --omit=dev || npm install --omit=dev
WORKDIR /app/miniprogram
RUN npm ci --omit=dev || npm install --omit=dev

WORKDIR /app
COPY . .

WORKDIR /app/miniprogram

ENV NODE_ENV=production
ENV PORT=80
ENV DB_PATH=/data/miniprogram.db
ENV DEV_AUTH_BYPASS=false

EXPOSE 80

# 持久盘挂载到 /data
CMD ["npx", "tsx", "server/index.ts"]
