FROM node:20-alpine as build

WORKDIR /app

# 依存関係のファイルをコピー
COPY package*.json ./

# 依存関係のインストール
RUN npm install

# ソースコードをコピー
COPY . .

# TypeScriptのビルド
RUN npm run build

# 本番環境用のイメージ
FROM node:20-alpine

WORKDIR /app

# 必要なファイルだけをコピー
COPY --from=build /app/dist ./dist
COPY --from=build /app/package*.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/node_modules/kuromoji/dict ./node_modules/kuromoji/dict

# ポートの公開
EXPOSE 3000

# アプリの起動
CMD ["node", "dist/index.js"] 
