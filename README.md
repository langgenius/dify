# Dify ローカル構築手順書（Local LLM + Localベクトル化API）

## 前提条件
* OS: macOS / Linux / Windows(WSL2)
* Docker / Docker Compose: インストール済み
* Git: インストール済み

---

## 1. リポジトリのクローン

```bash
git clone https://github.com/qa-dx/dify.git
```

---

## 2. 起動

```bash
cd dify/docker

cp .env.example .env
cp middleware.env.example middleware.env

docker compose up -d --build
```
### 2.1. `middleware.env`に以下を設定

```env
LLM_PROVIDER=ollama
OLLAMA_BASE_URL=http://ollama:11434
EMBEDDING_PROVIDER=custom
CUSTOM_EMBEDDING_URL=http://embedding-api:8000/embeddings
```

### 2.2. LLM モデルのダウンロード

```bash
docker compose exec ollama ollama pull llama3
```

### 2.3. 起動確認

```bash
docker compose exec ollama ollama run llama3
```

## 3. 動作確認

### 3.1. Embedding API

```bash
curl -X POST http://localhost:8001/v1/embeddings \
  -H "Content-Type: application/json" \
  -d '{"input": ["こんにちは"]}'
```

### 3.2. Local LLM

```bash
curl http://localhost:11434/api/tags
```
