# 本地测试环境设置指南

本文档说明如何创建和使用本地的Docker Compose测试环境，该环境不会被提交到版本控制。

## 📁 文件结构

```
docker/
├── .env                        # 本地环境配置
├── docker-compose.override.yaml # 本地覆盖配置
├── start-local-test.bat         # Windows启动脚本
└── README-local-test.md         # 本文档
```

## 🚀 快速开始

### 1. 准备环境配置文件

**使用 `.env`**
```bash
cd docker
copy .env.example .env
```

**注意**: 请确保 Docker Desktop 正在运行，然后执行启动脚本。

### 2. 修改配置（可选）

编辑你选择的环境文件，调整适合本地测试的配置：

```bash
# 开发环境
DEPLOY_ENV=DEVELOPMENT

# 启用调试
DEBUG=true
FLASK_DEBUG=true
LOG_LEVEL=DEBUG

# 数据库配置（保持默认即可）
DB_USERNAME=postgres
DB_PASSWORD=difyai123456

# 向量存储（本地测试推荐Weaviate）
VECTOR_STORE=weaviate
```

### 3. 启动测试环境

**Windows用户**：
```cmd
cd docker
start-local-test.bat
```

**脚本会自动**：
- 检查 Docker Desktop 是否运行
- 验证 `.env` 配置文件存在
- 构建 worker 镜像（使用本地 Dockerfile）
- 启动所有服务

或者手动启动：

```bash
# 启动中间件（数据库、Redis、向量存储）
docker compose -f docker-compose.middleware.yaml --profile weaviate up -d

# 启动应用服务
docker compose up -d
```

## 🎯 服务说明

### 中间件服务（docker-compose.middleware.yaml）
- **PostgreSQL**: 主数据库
- **Redis**: 缓存和消息队列
- **Weaviate**: 向量数据库（默认）
- **其他**: 可根据需要启用不同的向量存储

### 应用服务（docker-compose.yaml + override）
- **API**: 后端服务（开发模式，支持热重载）
- **Web**: 前端服务（开发模式）
- **Nginx**: 反向代理
- **Worker**: 后台任务处理

## 📝 本地开发特性

### 热重载
- API服务会自动检测代码变化并重启
- Web服务支持前端热重载

### 数据持久化
数据存储在 `docker/volumes/` 目录下，会在容器重启后保留。

### 调试支持
- 启用Flask调试模式
- 详细的日志输出
- API文档自动生成

## 🛠️ 常用命令

```bash
# 查看服务状态
docker compose ps

# 查看日志
docker compose logs -f [service_name]

# 重启特定服务
docker compose restart api

# 进入容器调试
docker compose exec api bash

# 停止所有服务
docker compose down

# 停止并清理数据卷
docker compose -f docker-compose.middleware.yaml down -v
```

## 🔧 自定义配置

### 修改端口
在环境文件中修改：
```bash
DIFY_PORT=5002  # API端口
EXPOSE_NGINX_PORT=8080  # Web端口
```

### 切换向量存储
在环境文件中修改：
```bash
VECTOR_STORE=qdrant  # 或 milvus, chroma 等
```

然后重新启动中间件：
```bash
docker compose -f docker-compose.middleware.yaml --profile qdrant up -d
```

### 使用本地 Dockerfile

如果需要使用自定义的 Dockerfile（比如使用国内镜像加速）：

1. **创建本地 Dockerfile**：
   ```bash
   # 复制原文件
   cp api/Dockerfile api/Dockerfile.local

   # 编辑本地文件（比如取消阿里云镜像注释）
   # 第15行取消注释：RUN sed -i 's@deb.debian.org@mirrors.aliyun.com@g' /etc/apt/sources.list.d/debian.sources
   ```

2. **配置 override 使用本地 Dockerfile**：
   `docker-compose.override.yaml` 已经配置好了使用 `Dockerfile.local`

3. **构建时会自动使用**：
   ```bash
   docker compose --env-file .env build worker
   ```

### 添加自定义服务
编辑 `docker-compose.override.yaml` 添加新服务。

## 📚 最佳实践

1. **不要修改官方文件**: 不要直接修改 `docker-compose.yaml`，所有本地改动都放在 `docker-compose.override.yaml` 中。

2. **使用有意义的环境文件**: 使用 `.env` 文件进行本地配置。

3. **定期清理**: 测试完成后清理不需要的数据卷。

4. **版本控制**: 这些本地文件（`.env`, `docker-compose.override.yaml`, `Dockerfile.local`）会被 `.gitignore` 忽略，不会提交到仓库。

## 🐛 故障排除

### 服务启动失败
```bash
# 检查端口占用
netstat -tulpn | grep :5001

# 检查Docker资源
docker system df

# 查看详细日志
docker compose logs
```

### 数据库连接问题
```bash
# 检查数据库状态
docker compose exec db pg_isready

# 重置数据库
docker compose down
docker volume rm dify_db_data
docker compose up -d db
```

### 内存不足
减少服务资源使用：
```yaml
# 在 docker-compose.override.yaml 中添加
services:
  db:
    environment:
      POSTGRES_SHARED_BUFFERS: 64MB
  redis:
    command: redis-server --maxmemory 64mb
```

## 📞 获取帮助

如果遇到问题，请：
1. 检查本文档
2. 查看 [官方文档](https://docs.dify.ai)
3. 在GitHub Issues中搜索类似问题
