# =====================
# Build Stage
# =====================
FROM node:20-alpine AS builder

WORKDIR /app

# ルートの package.json と lock ファイル
COPY package.json ./

# 各パッケージの package.json
COPY shared/package.json ./shared/
COPY server/package.json ./server/

# 依存関係インストール
RUN npm install --workspace=shared --workspace=server

# ソースコードをコピー
COPY tsconfig.base.json ./
COPY shared/ ./shared/
COPY server/ ./server/

# ビルド
RUN npm run build -w shared && npm run build -w server

# =====================
# Production Stage
# =====================
FROM node:20-alpine

WORKDIR /app

COPY package.json ./
COPY shared/package.json ./shared/
COPY server/package.json ./server/

# 本番依存関係のみ
RUN npm install --workspace=shared --workspace=server --omit=dev

# ビルド成果物をコピー
COPY --from=builder /app/shared/dist ./shared/dist
COPY --from=builder /app/server/dist ./server/dist

# データディレクトリ作成
RUN mkdir -p /app/data

ENV SYNC_PORT=8080
ENV SYNC_DATA_DIR=/app/data

EXPOSE 8080

CMD ["node", "server/dist/index.js"]
