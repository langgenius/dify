# 🚀 本地开发部署指南

## 🎯 核心问题

**Q: 修改代码后是否会自动看到最新代码？**

**A: 不会，需要手动操作**

```
当前使用的是官方预编译镜像（1.13.3版本）
├─ langgenius/dify-api:1.13.3  ← 固定版本
├─ langgenius/dify-web:1.13.3  ← 固定版本
└─ 修改源代码不会影响容器内的代码
```

---

## 📋 本地开发的两种模式

### 模式 1️⃣：快速测试（推荐新手）

**适用场景：** 只想测试功能，不改代码

```bash
cd docker
docker-compose up -d

# 容器运行官方镜像
# 无需关心源代码
# 访问: http://localhost:3000
```

**特点：**
- ✅ 易上手 - 一行命令启动
- ✅ 无需依赖 - Docker 处理所有环节
- ❌ 无法开发 - 修改代码无效

---

### 模式 2️⃣：热开发（推荐开发者）

**适用场景：** 修改代码，实时看到效果

#### 步骤 1：使用 override 配置

```bash
cd /Users/chao/Dify

# docker-compose.override.yml 已创建
# 当你运行 docker-compose 时会自动使用它
```

#### 步骤 2：从源代码构建镜像

```bash
# 构建基础镜像
docker build -f api/Dockerfile -t dify-api:dev api/
docker build -f web/Dockerfile -t dify-web:dev web/

# 或使用 docker-compose 自动构建
cd docker
docker-compose up -d
```

#### 步骤 3：修改代码后...

**后端代码修改：**
```bash
# 1. 编辑 api/ 目录中的 Python 文件
vi api/core/models/model.py  # 例如

# 2. 容器会自动重启（watch mode）
# 3. 无需手动操作 ✨

# 查看日志验证
docker-compose logs -f api
```

**前端代码修改：**
```bash
# 1. 编辑 web/ 目录中的 TypeScript/React 文件
vi web/app/components/Header.tsx  # 例如

# 2. Next.js 热重载自动工作
# 3. 刷新浏览器看到修改 ✨

# 查看日志验证
docker-compose logs -f web
```

---

## 🔄 完整本地开发工作流

### 初始化

```bash
cd /Users/chao/Dify

# 方式 A：使用官方镜像快速测试
cd docker
docker-compose up -d
# 访问: http://localhost:3000

# 方式 B：从源代码构建开发环境
cd /Users/chao/Dify

# 构建镜像（首次）
docker-compose build

# 启动容器
docker-compose up -d

# 验证
docker-compose ps
```

### 开发循环

```
1️⃣ 修改源代码
   ├─ vi api/core/models/model.py
   └─ vi web/app/components/Header.tsx

2️⃣ 立即看到效果
   ├─ 后端: 自动重启（watch mode）
   ├─ 前端: 热重载（HMR）
   └─ 数据库: 自动迁移

3️⃣ 测试功能
   ├─ 访问 http://localhost:3000
   └─ 测试新功能

4️⃣ 查看日志调试
   ├─ docker-compose logs -f api
   └─ docker-compose logs -f web

5️⃣ 提交代码
   ├─ git add .
   ├─ git commit
   └─ git push origin develop
      → GitHub Actions 自动构建和部署
```

---

## 📊 官方镜像 vs 本地构建

```bash
┌──────────────┬──────────────────┬──────────────────┐
│ 特性         │ 官方镜像（1.13.3）│ 本地构建（dev）  │
├──────────────┼──────────────────┼──────────────────┤
│ 代码更新     │ ❌ 手动重建      │ ✅ 自动热重载    │
│ 启动时间     │ ⚡ 快 (1min)    │ 🐢 慢 (5min)    │
│ 依赖大小     │ 📦 大 (2GB)     │ 📦 大 (2GB)     │
│ 适用场景     │ 测试、演示      │ 开发、调试       │
│ 修改代码效果 │ ❌ 无效         │ ✅ 立即生效      │
│ IDE 集成     │ ❌ 困难         │ ✅ 完全支持      │
└──────────────┴──────────────────┴──────────────────┘
```

---

## 🛠️ 本地开发常用命令

### 查看和管理容器

```bash
# 查看运行状态
docker-compose ps

# 查看日志（实时）
docker-compose logs -f api      # 后端日志
docker-compose logs -f web      # 前端日志
docker-compose logs -f          # 所有日志

# 跟进特定容器的错误
docker-compose logs --tail=100 api
```

### 重建和重启

```bash
# 重建镜像（代码改变很大时）
docker-compose build api
docker-compose build web

# 重启容器（不重建）
docker-compose restart api
docker-compose restart web

# 完全重启（清空旧数据）
docker-compose down -v
docker-compose up -d
```

### 进入容器调试

```bash
# 进入后端容器
docker-compose exec api bash
# 现在可以运行 Python 命令调试

# 进入前端容器
docker-compose exec web bash
# 现在可以运行 npm 命令调试

# 进入数据库
docker-compose exec postgres psql -U postgres -d dify
# 现在可以执行 SQL 命令
```

### 查看实时性能

```bash
# 实时监控所有容器
docker stats

# 查看容器内存/CPU 使用
docker stats dify-api dify-web

# 分析容器中的进程
docker top dify-api
docker top dify-web
```

---

## 🚀 快速启动脚本

### 脚本：dev-setup.sh

```bash
#!/bin/bash
# 本地开发环境一键启动

set -e

echo "🚀 Setting up local development environment..."

# 1. 检查 Docker
if ! command -v docker &> /dev/null; then
    echo "❌ Docker not installed"
    exit 1
fi

# 2. 拉取最新代码
echo "📥 Pulling latest code..."
git fetch origin develop
git checkout develop

# 3. 构建镜像
echo "🔨 Building Docker images..."
docker-compose build

# 4. 启动容器
echo "🐳 Starting containers..."
docker-compose up -d

# 5. 等待服务就绪
echo "⏳ Waiting for services..."
sleep 10

# 6. 运行迁移（如需要）
echo "🗄️  Running migrations..."
docker-compose exec -T api alembic upgrade head

# 7. 验证
echo "✅ Health checks..."
curl -f http://localhost:3000 || exit 1
curl -f http://localhost:5001/api/health || exit 1

echo ""
echo "✅ Development environment is ready!"
echo ""
echo "🔗 Access URLs:"
echo "  - Frontend: http://localhost:3000"
echo "  - API: http://localhost:5001/api"
echo "  - API Health: http://localhost:5001/api/health"
echo ""
echo "📝 Common commands:"
echo "  - View logs: docker-compose logs -f"
echo "  - Stop: docker-compose down"
echo "  - Restart: docker-compose restart"
```

使用：
```bash
chmod +x scripts/dev-setup.sh
./scripts/dev-setup.sh
```

---

## 🎯 我应该用哪种模式？

```
        你想做什么？
              │
    ┌─────────┼─────────┐
    │         │         │
  测试功能  改代码   深度调试
  演示给人  本地开发  性能分析
    │         │         │
  模式 1 → 模式 2   模式 2+
 官方镜像  本地构建   IDE 连接
    │         │         │
 docker-    docker-   docker-
 compose up compose up compose up
          override  + debugger
```

---

## 📚 本地开发最佳实践

### ✅ 必做

1. **使用 Volume 挂载源代码**
   ```yaml
   volumes:
     - ./api:/app
     - ./web:/app
   ```

2. **启用热重载**
   ```bash
   # Python: 使用 --reload 标志
   uvicorn app:app --reload
   
   # Node.js: Next.js 自动支持 HMR
   npm run dev
   ```

3. **定期检查日志**
   ```bash
   docker-compose logs -f
   ```

4. **使用 .dockerignore 优化构建**
   ```
   .git
   .env.local
   node_modules
   __pycache__
   .pytest_cache
   ```

### ❌ 不要做

1. **直接修改容器内的代码**
   ```bash
   # 不要这样做！
   docker-compose exec api vi /app/models.py
   # 修改会丢失
   ```

2. **忘记提交代码后才部署**
   ```bash
   # 容易遗漏本地修改
   git push 前一定要 commit
   ```

3. **混合使用官方镜像和本地构建**
   ```bash
   # 指定镜像版本，避免混淆
   docker-compose config | grep image:
   ```

---

## 🔧 常见问题

### Q1: 修改代码后容器没有重启怎么办？

```bash
# 强制重建
docker-compose down
docker-compose build
docker-compose up -d

# 或查看是否启用了 watch mode
docker-compose logs api | grep -i reload
```

### Q2: Port 3000/5001 已被占用

```bash
# 查找占用进程
lsof -i :3000
lsof -i :5001

# 杀死进程
kill -9 <PID>

# 或修改 docker-compose.yml
ports:
  - "3001:3000"  # 用 3001 代替
  - "5002:5001"  # 用 5002 代替
```

### Q3: 容器频繁重启

```bash
# 查看错误日志
docker-compose logs api | tail -50

# 可能原因：
# 1. 依赖缺失 - 检查 requirements.txt / package.json
# 2. 配置错误 - 检查 .env 文件
# 3. 数据库连接失败 - 检查数据库容器

docker-compose ps  # 检查所有容器
```

### Q4: 修改完代码运行出错

```bash
# 查看完整日志
docker-compose logs -f --tail=200 api

# 进入容器调试
docker-compose exec api bash

# 查看依赖
pip list
npm list
```

---

## 📈 性能优化

### 减少镜像构建时间

```dockerfile
# ✅ 好：多阶段构建
FROM python:3.11 AS builder
COPY requirements.txt .
RUN pip install -r requirements.txt

FROM python:3.11
COPY --from=builder /usr/local/lib/python3.11/site-packages /usr/local/lib/python3.11/site-packages
COPY . .

# ❌ 差：一阶段构建（镜像较大）
FROM python:3.11
COPY . .
RUN pip install -r requirements.txt
```

### 加速容器启动

```bash
# 使用 .dockerignore 减少构建上下文
echo "
.git
node_modules
__pycache__
.pytest_cache
.env.local
" > .dockerignore

# 预热缓存
docker-compose build --no-cache api web
```

---

## 🎓 相关命令参考

```bash
# 开发常用
docker-compose up -d          # 启动
docker-compose down           # 停止
docker-compose logs -f        # 查看日志
docker-compose build          # 重建镜像
docker-compose restart        # 重启容器
docker-compose exec api bash  # 进入容器

# 调试commands
docker ps                      # 查看容器
docker images                  # 查看镜像
docker stats                   # 实时监控
docker logs <container-id>    # 查看容器日志
```

---

## ✅ 检查清单

部署本地开发环境前：

- [ ] Docker Desktop 已安装
- [ ] 代码已克隆到本地
- [ ] 源代码使用 Volume 挂载
- [ ] 热重载已启用
- [ ] 首次构建完成
- [ ] 所有容器健康运行
- [ ] 可访问 http://localhost:3000

开发时：

- [ ] 修改代码后查看日志确认更新
- [ ] 定期查看容器健康状态
- [ ] 保持 Docker daemon 运行
- [ ] 代码改变前 git commit
- [ ] 测试完毕后 git push

---

## 📞 需要帮助？

查看完整文档：
- `.github/DEPLOYMENT_GUIDE.md` - 详细部署指南
- `.github/DEPLOYMENT_QUICK_REFERENCE.md` - 快速命令参考
- Docker 官方文档 - https://docs.docker.com/
