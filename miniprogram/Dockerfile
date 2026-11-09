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
# 生产持久化走云托管 MySQL（控制台注入 MYSQL_* 或 DATABASE_URL，不要写进镜像）。
ENV DB_BACKEND=mysql
ENV MYSQL_DATABASE=feimaocat
ENV DEV_AUTH_BYPASS=false
ENV SOURCE_ADAPTER=opendianping

EXPOSE 80
CMD ["npx", "tsx", "server/index.ts"]
