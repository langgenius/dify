# 部署指南 / Deployment Guide

## 📊 部署阶段概览

| 环境 | 触发条件 | 自动化 | 用途 |
|------|---------|--------|------|
| 本地开发 | 本地运行 | ❌ 手动 | 功能开发测试 |
| Staging | Push to develop | ✅ 自动 | 集成测试、QA |
| Production | Tag release / 手动 | ✅ 自动 | 生产环境 |

---

## 💻 方案 A：本地/单机部署（Docker Compose）

### 前置条件
```bash
✓ Docker Desktop 已安装
✓ Docker Compose v2.0+
✓ 8GB+ RAM
```

### 部署步骤

#### 1. 准备环境变量
```bash
cd /Users/chao/Dify
cp .env.example .env

# 编辑配置
vi .env

# 关键变量：
OPENAI_API_KEY=your-key
DATABASE_URL=postgresql://...
REDIS_URL=redis://redis:6379
```

#### 2. 使用本地镜像或远程镜像

**方案 A1：使用本地构建的镜像**
```bash
# 构建镜像
docker build -f api/Dockerfile -t dify-api:latest api/
docker build -f web/Dockerfile -t dify-web:latest web/

# 启动
docker-compose up -d

# 验证
docker-compose ps
curl http://localhost:3000
```

**方案 A2：使用 GitHub Actions 构建的镜像**
```bash
# 编辑 docker-compose.yml
image: ghcr.io/lczc1988/dify-api:develop
image: ghcr.io/lczc1988/dify-web:develop

# 登录 GitHub Container Registry
echo ${{ secrets.GITHUB_TOKEN }} | docker login ghcr.io -u USERNAME --password-stdin

# 启动
docker-compose up -d
```

#### 3. 验证部署
```bash
# 检查容器状态
docker-compose ps

# 查看日志
docker-compose logs -f api
docker-compose logs -f web

# 访问应用
- 前端: http://localhost:3000
- 后端: http://localhost:5001/api
- 数据库: postgres://localhost:5432
```

#### 4. 关闭部署
```bash
docker-compose down
docker-compose down -v  # 包括数据卷
```

---

## ☁️ 方案 B：Kubernetes 部署

### 前置条件
```bash
✓ Kubernetes 集群（1.24+）
✓ kubectl 已配置
✓ Helm（可选，简化部署）
✓ 私密镜像拉取配置
```

### 部署步骤

#### 1. 配置 Kubernetes Secret
```bash
# 创建命名空间
kubectl create namespace dify

# 创建镜像拉取密令
kubectl create secret docker-registry ghcr-secret \
  --docker-server=ghcr.io \
  --docker-username=YOUR_USERNAME \
  --docker-password=${{ secrets.GITHUB_TOKEN }} \
  --docker-email=your-email@example.com \
  -n dify
```

#### 2. 创建部署 manifest
```yaml
# k8s/deployment.yaml
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: dify-config
  namespace: dify
data:
  DATABASE_URL: "postgresql://postgres:5432/dify"
  REDIS_URL: "redis://redis:6379"
  LOG_LEVEL: "INFO"

---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: dify-api
  namespace: dify
spec:
  replicas: 3
  selector:
    matchLabels:
      app: dify-api
  template:
    metadata:
      labels:
        app: dify-api
    spec:
      imagePullSecrets:
      - name: ghcr-secret
      containers:
      - name: api
        image: ghcr.io/lczc1988/dify-api:develop
        imagePullPolicy: Always
        ports:
        - containerPort: 5001
        envFrom:
        - configMapRef:
            name: dify-config
        env:
        - name: DATABASE_PASSWORD
          valueFrom:
            secretKeyRef:
              name: db-secret
              key: password
        resources:
          requests:
            cpu: 500m
            memory: 512Mi
          limits:
            cpu: 1000m
            memory: 1Gi
        livenessProbe:
          httpGet:
            path: /api/health
            port: 5001
          initialDelaySeconds: 30
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /api/health
            port: 5001
          initialDelaySeconds: 5
          periodSeconds: 5

---
apiVersion: v1
kind: Service
metadata:
  name: dify-api
  namespace: dify
spec:
  type: ClusterIP
  selector:
    app: dify-api
  ports:
  - port: 5001
    targetPort: 5001

---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: dify-web
  namespace: dify
spec:
  replicas: 2
  selector:
    matchLabels:
      app: dify-web
  template:
    metadata:
      labels:
        app: dify-web
    spec:
      imagePullSecrets:
      - name: ghcr-secret
      containers:
      - name: web
        image: ghcr.io/lczc1988/dify-web:develop
        imagePullPolicy: Always
        ports:
        - containerPort: 3000
        env:
        - name: API_URL
          value: "http://dify-api:5001"
        resources:
          requests:
            cpu: 250m
            memory: 256Mi
          limits:
            cpu: 500m
            memory: 512Mi
        livenessProbe:
          httpGet:
            path: /
            port: 3000
          initialDelaySeconds: 20
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /
            port: 3000
          initialDelaySeconds: 5
          periodSeconds: 5

---
apiVersion: v1
kind: Service
metadata:
  name: dify-web
  namespace: dify
spec:
  type: LoadBalancer
  selector:
    app: dify-web
  ports:
  - port: 3000
    targetPort: 3000

---
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: dify-network-policy
  namespace: dify
spec:
  podSelector:
    matchLabels:
      app: dify-api
  policyTypes:
  - Ingress
  ingress:
  - from:
    - podSelector:
        matchLabels:
          app: dify-web
    ports:
    - protocol: TCP
      port: 5001
```

#### 3. 部署到 K8s
```bash
# 创建数据库密令
kubectl create secret generic db-secret \
  --from-literal=password='your-db-password' \
  -n dify

# 应用配置
kubectl apply -f k8s/deployment.yaml

# 验证部署
kubectl get deployments -n dify
kubectl get pods -n dify
kubectl get svc -n dify

# 查看日志
kubectl logs -f deployment/dify-api -n dify
kubectl logs -f deployment/dify-web -n dify

# 端口转发（测试）
kubectl port-forward svc/dify-web 3000:3000 -n dify
```

---

## 🔄 方案 C：GitHub Actions 自动化部署

### 1. 配置 GitHub Secrets

在 Repository Settings → Secrets 添加：

```
# 部署目标配置
DEPLOY_HOST=your-server.com
DEPLOY_USER=deploy-user
DEPLOY_KEY=private-ssh-key

# 或 Kubernetes
KUBE_CONFIG=base64-encoded-kubeconfig

# 或云服务（AWS/Azure/GCP）
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
```

### 2. 创建部署 Workflow

```yaml
# .github/workflows/deploy-production.yml
name: Deploy to Production

on:
  release:
    types: [published]
  workflow_dispatch:
    inputs:
      environment:
        description: 'Environment to deploy'
        required: true
        default: 'staging'
        type: choice
        options:
          - staging
          - production

jobs:
  deploy:
    runs-on: ubuntu-latest
    
    steps:
      - uses: actions/checkout@v4
      
      - name: Deploy to Server
        env:
          DEPLOY_HOST: ${{ secrets.DEPLOY_HOST }}
          DEPLOY_USER: ${{ secrets.DEPLOY_USER }}
          DEPLOY_KEY: ${{ secrets.DEPLOY_KEY }}
        run: |
          mkdir -p ~/.ssh
          echo "$DEPLOY_KEY" > ~/.ssh/deploy_key
          chmod 600 ~/.ssh/deploy_key
          ssh-keyscan $DEPLOY_HOST >> ~/.ssh/known_hosts
          
          ssh -i ~/.ssh/deploy_key $DEPLOY_USER@$DEPLOY_HOST << 'EOF'
            cd /opt/dify
            docker-compose pull
            docker-compose down
            docker-compose up -d
            docker-compose logs -f
          EOF

      - name: Health Check
        run: |
          timeout 300 bash -c 'until curl -f ${{ secrets.DEPLOY_HOST }}/api/health; do sleep 10; done'

      - name: Slack Notification
        if: always()
        uses: slackapi/slack-github-action@v1
        with:
          webhook-url: ${{ secrets.SLACK_WEBHOOK }}
          payload: |
            {
              "text": "Deployment completed",
              "blocks": [{
                "type": "section",
                "text": {
                  "type": "mrkdwn",
                  "text": "Status: ${{ job.status }}\nEnvironment: ${{ github.event.inputs.environment }}"
                }
              }]
            }
```

### 3. 触发部署

**方式 1：Release**
```bash
git tag v1.0.0
git push origin v1.0.0
# GitHub 自动创建 Release，触发部署
```

**方式 2：手动**
```
GitHub → Actions → Deploy to Production → Run workflow
```

---

## 🔧 方案 D：传统部署脚本

### 部署脚本示例

```bash
#!/bin/bash
# deploy.sh

set -e

ENVIRONMENT=${1:-staging}
VERSION=${2:-develop}

echo "🚀 Deploying Dify to $ENVIRONMENT (version: $VERSION)"

# 1. 拉取最新代码
cd /opt/dify
git fetch origin
git checkout $VERSION

# 2. 拉取 Docker 镜像
docker pull ghcr.io/lczc1988/dify-api:$VERSION
docker pull ghcr.io/lczc1988/dify-web:$VERSION

# 3. 更新配置
./scripts/update-env.sh $ENVIRONMENT

# 4. 重启服务
docker-compose down
docker-compose up -d

# 5. 运行迁移
docker-compose exec -T api python manage.py migrate

# 6. 验证健康检查
echo "⏳ Waiting for services to be healthy..."
for i in {1..30}; do
    if curl -f http://localhost:5001/api/health; then
        echo "✅ API is healthy"
        break
    fi
    sleep 10
    if [ $i -eq 30 ]; then
        echo "❌ API failed to become healthy"
        exit 1
    fi
done

echo "✅ Deployment completed successfully!"
```

使用方式：
```bash
./deploy.sh staging develop
./deploy.sh production v1.0.0
```

---

## 📊 环境对比

| 特性 | Docker Compose | Kubernetes | Cloud Native |
|------|---|---|---|
| 复杂度 | ⭐ 简单 | ⭐⭐⭐ 中等 | ⭐⭐⭐⭐ 复杂 |
| 可扩展性 | ❌ 有限 | ✅ 优秀 | ✅ 优秀 |
| 自动恢复 | ❌ 无 | ✅ 有 | ✅ 有 |
| 负载均衡 | ❌ 无 | ✅ 内置 | ✅ 内置 |
| 成本 | 💰 低 | 💰💰 中 | 💰💰💰 高 |
| 最适用 | 本地+小规模 | 生产级 | 超大规模 |

---

## 🔍 部署检查清单

### 部署前
- [ ] 所有 CI/CD 检查通过
- [ ] Code Review 批准
- [ ] 数据库备份完成
- [ ] 回滚计划已准备
- [ ] 监控告警已配置

### 部署中
- [ ] 日志实时监控
- [ ] 性能指标监控
- [ ] 错误率监控
- [ ] 用户行为监控

### 部署后
- [ ] 健康检查通过
- [ ] 功能验证成功
- [ ] 性能指标正常
- [ ] 告警无异常

---

## 🚨 回滚方案

### Docker Compose 回滚
```bash
# 查看历史版本
docker image ls dify-api

# 回滚到上一个版本
docker-compose down
sed -i 's/:develop/:previous/' docker-compose.yml
docker-compose up -d
```

### Kubernetes 回滚
```bash
# 查看发布历史
kubectl rollout history deployment/dify-api -n dify

# 回滚到上一个版本
kubectl rollout undo deployment/dify-api -n dify

# 回滚到特定版本
kubectl rollout undo deployment/dify-api --to-revision=2 -n dify
```

### Git 回滚
```bash
# 恢复到前一个提交
git revert HEAD
git push origin develop

# GitHub Actions 会自动重新部署
```

---

## 📈 监控和告警

### 关键指标
```
- 应用可用性 > 99.9%
- API 响应时间 < 500ms
- 数据库连接池使用率 < 80%
- Docker 容器重启次数 = 0
- 错误率 < 0.1%
```

### 监控工具
- Prometheus + Grafana
- ELK Stack（日志分析）
- Sentry（错误追踪）
- New Relic（APM）

---

## 🎯 推荐配置

### 对于本项目
**当前阶段**：Docker Compose（本地开发）
**下一阶段**：GitHub Actions + 单机部署
**生产阶段**：Kubernetes + Cloud Native

### 立即可用
```
✅ 本地: docker-compose up -d
✅ 自动: GitHub Actions (已配置)
✅ 脚本: 部署脚本（自定义）
```

### 需要配置
```
⏳ 远程服务器部署（SSH/密钥）
⏳ Kubernetes 集群
⏳ 云服务配置（AWS/Azure）
```
