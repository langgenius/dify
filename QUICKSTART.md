# Dify 本地启动指南

## 🚀 方案 1: Docker 部署（推荐）

### 前置条件
- Docker Desktop for Mac
- 至少 4GB RAM
- 2 Core CPU

### 步骤 1: 安装 Docker

访问 [Docker Desktop for Mac](https://www.docker.com/products/docker-desktop/) 下载并安装。

或使用 Homebrew 安装：
```bash
brew install --cask docker
```

安装后启动 Docker Desktop 应用程序。

### 步骤 2: 配置环境变量

```bash
cd /Users/wesharn/workplace/ai-agent-sys/docker
cp .env.example .env
```

### 步骤 3: 编辑配置（可选）

```bash
# 编辑 .env 文件，设置必要的配置
vim .env

# 关键配置项：
# - SECRET_KEY: 留空自动生成
# - OPENAI_API_KEY: 如果要使用 OpenAI（可选）
# - 其他 API Keys 根据需要配置
```

### 步骤 4: 启动服务

```bash
cd /Users/wesharn/workplace/ai-agent-sys/docker
docker compose up -d
```

### 步骤 5: 查看状态

```bash
# 查看容器状态
docker compose ps

# 查看日志
docker compose logs -f

# 查看特定服务日志
docker compose logs -f api
docker compose logs -f web
```

### 步骤 6: 访问应用

启动成功后，在浏览器访问：
- **主页**: http://localhost
- **控制台**: http://localhost/install (首次访问需要初始化)

### 停止服务

```bash
cd /Users/wesharn/workplace/ai-agent-sys/docker
docker compose down
```

### 重启服务

```bash
docker compose restart
```

### 查看资源占用

```bash
docker stats
```

---

## 🛠️ 方案 2: 本地开发环境部署

适合需要修改代码并实时查看效果的场景。

### 前置条件
- Python 3.10+
- Node.js 18+
- PostgreSQL 15+
- Redis 7+
- 向量数据库（Weaviate/Milvus 等）

### 2.1 启动中间件服务（使用 Docker）

```bash
cd /Users/wesharn/workplace/ai-agent-sys/docker
cp envs/middleware.env.example middleware.env

# 编辑 middleware.env 设置数据库类型等
vim middleware.env

# 启动中间件（数据库、Redis、向量数据库）
docker compose --env-file middleware.env -f docker-compose.middleware.yaml -p dify up -d
```

### 2.2 后端 API 启动

```bash
cd /Users/wesharn/workplace/ai-agent-sys/api

# 安装 uv（如果还没有）
curl -LsSf https://astral.sh/uv/install.sh | sh

# 安装依赖
uv sync

# 复制环境变量
cp .env.example .env

# 编辑 .env 配置数据库连接等
vim .env

# 运行数据库迁移
uv run flask db upgrade

# 启动 API 服务
uv run flask run --host 0.0.0.0 --port 5001 --debug

# 在另一个终端启动 Celery worker
cd /Users/wesharn/workplace/ai-agent-sys/api
uv run celery -A app.celery worker -P gevent -c 1 --loglevel INFO
```

### 2.3 前端启动

```bash
cd /Users/wesharn/workplace/ai-agent-sys/web

# 安装 pnpm（如果还没有）
npm install -g pnpm

# 安装依赖
pnpm install

# 复制环境变量
cp .env.example .env.local

# 编辑 .env.local 配置 API 地址
vim .env.local

# 启动开发服务器
pnpm dev
```

访问: http://localhost:3000

---

## 🔧 常见问题

### Q1: Docker 启动失败
```bash
# 查看详细错误
docker compose logs

# 清理并重启
docker compose down -v
docker compose up -d
```

### Q2: 端口冲突
```bash
# 查看端口占用
lsof -i :80
lsof -i :5001
lsof -i :3000

# 修改 .env 中的端口配置
```

### Q3: 数据库连接失败
```bash
# 检查数据库容器状态
docker compose ps db

# 查看数据库日志
docker compose logs db

# 重启数据库
docker compose restart db
```

### Q4: API 服务启动失败
```bash
# 检查依赖安装
uv sync

# 检查数据库迁移
uv run flask db current

# 查看详细错误
uv run flask run --debug
```

### Q5: 内存不足
```bash
# 清理 Docker 缓存
docker system prune -a

# 调整 Docker Desktop 内存分配
# Docker Desktop -> Settings -> Resources -> Memory
```

---

## 📊 服务架构

```
┌─────────────────────────────────────────────────┐
│                   Nginx (80)                    │
│          反向代理 + 静态文件服务                  │
└────────────┬────────────────────────┬───────────┘
             │                        │
    ┌────────▼────────┐      ┌───────▼────────┐
    │  Web (3000)     │      │  API (5001)    │
    │  Next.js        │      │  Flask         │
    └─────────────────┘      └───────┬────────┘
                                     │
                ┌────────────────────┼──────────────────┐
                │                    │                  │
       ┌────────▼────────┐  ┌───────▼────────┐  ┌─────▼─────┐
       │ PostgreSQL      │  │ Redis          │  │ Weaviate  │
       │ (5432)          │  │ (6379)         │  │ (8080)    │
       └─────────────────┘  └────────────────┘  └───────────┘
```

---

## 🎯 验证部署成功

### 1. 检查所有容器运行状态
```bash
docker compose ps
# 应该看到所有容器状态为 "Up"
```

### 2. 检查 API 健康
```bash
curl http://localhost/console/api/health
# 应该返回: {"status": "ok"}
```

### 3. 访问控制台
浏览器访问 http://localhost/install

### 4. 创建管理员账户
首次访问需要设置管理员邮箱和密码

---

## 📝 下一步

1. ✅ 完成初始化设置
2. ✅ 配置模型提供商 (OpenAI/Anthropic 等)
3. ✅ 创建第一个应用
4. ✅ 测试工作流功能
5. ✅ 开始定制开发

---

## 🔗 相关文档

- [架构分析](ARCHITECTURE.md)
- [同步指南](SYNC_GUIDE.md)
- [官方文档](https://docs.dify.ai/)
