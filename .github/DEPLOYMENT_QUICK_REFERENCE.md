# 🚀 部署快速参考

## 📊 部署选项一览表

```bash
┌─────────────────────────────────────────────────────────────────┐
│ 部署方案选择                                                     │
├─────────┬──────────────┬─────────┬────────────┬─────────────────┤
│ 方案    │ 难度        │ 速度    │ 推荐场景   │ 命令            │
├─────────┼──────────────┼─────────┼────────────┼─────────────────┤
│ A1      │ ⭐ 简单      │ 快      │ 本地开发   │ docker-compose  │
│ A2      │ ⭐ 简单      │ 中      │ 小团队     │                 │
│ B       │ ⭐⭐⭐ 复杂   │ 快      │ 生产环境   │ kubectl apply   │
│ C       │ ⭐⭐ 中等    │ 中      │ 自动化     │ GitHub Actions  │
│ D       │ ⭐⭐ 中等    │ 快      │ 快速部署   │ ./deploy.sh     │
└─────────┴──────────────┴─────────┴────────────┴─────────────────┘
```

---

## 🗓️ 部署流程时间表

```
编写代码
   ↓ (git commit)
Pre-commit Hook 检查 ⏱️ 2-5 秒
   ↓ (git push)
GitHub Actions CI 测试 ⏱️ 5-10 分钟
   ├─ 后端: pytest, pylint
   └─ 前端: type-check, lint, build
   ↓ (如果测试通过)
Docker 镜像构建 ⏱️ 10-15 分钟
   ├─ 后端镜像: 500MB
   └─ 前端镜像: 200MB
   ↓ (推送到 ghcr.io)
部署 ⏱️ 3-5 分钟 (取决于方案)
   ├─ Docker Compose: 1-2 分钟
   ├─ SSH 部署: 2-3 分钟
   └─ Kubernetes: 3-5 分钟
   ↓
健康检查 & 验证 ⏱️ 30-60 秒

📈 总耗时: 30-45 分钟（从 git push 到生产可用）
```

---

## 🔧 快速命令速查

### 方案 A：Docker Compose（本地）

```bash
# 启动
cd /Users/chao/Dify
docker-compose up -d

# 查看状态
docker-compose ps

# 查看日志
docker-compose logs -f api
docker-compose logs -f web

# 停止
docker-compose down
```

### 方案 D：部署脚本

```bash
# Staging 环境
./scripts/deploy.sh staging develop

# Production 环境（需要配置）
./scripts/deploy.sh production v1.0.0

# 查看日志
docker-compose logs -f

# 回滚（使用备份）
docker-compose down
# 恢复备份
mysql -u root dify < backups/dify-backup-*.sql
docker-compose up -d
```

### 方案 C：Kubernetes

```bash
# 初始化 K8s（首次）
bash k8s/setup-k8s.sh dify ghcr.io your-username your-token

# 部署
kubectl apply -f k8s/staging/deployment.yaml

# 查看状态
kubectl get pods -n dify
kubectl get svc -n dify

# 查看日志
kubectl logs -f deployment/dify-api -n dify
kubectl logs -f deployment/dify-web -n dify

# 升级镜像
kubectl set image deployment/dify-api \
  api=ghcr.io/lczc1988/dify-api:develop \
  -n dify

# 回滚
kubectl rollout undo deployment/dify-api -n dify
```

### 方案 C：GitHub Actions（自动）

```bash
# 1. 推送到 develop
git commit -m "feat: new feature"
git push origin develop

# 2. GitHub Actions 自动执行
# - 运行 CI 测试
# - 构建 Docker 镜像
# - 部署到 Staging
# （无需手动操作）

# 3. 查看部署状态
# https://github.com/lczc1988/dify/actions

# 4. 手动部署 Production
# 在 Actions 页面点击 "Deploy to Production" → "Run workflow"
```

---

## 📋 部署检查清单

### 部署前

- [ ] 代码已 commit 并 push
- [ ] GitHub Actions CI 全部通过
- [ ] PR 已批准
- [ ] 数据库备份（重要！）
- [ ] 通知团队成员

### 部署中

- [ ] 监控容器启动
- [ ] 检查 CPU/内存使用
- [ ] 查看应用日志
- [ ] 确认无错误

### 部署后

- [ ] 访问应用验证功能
- [ ] 健康检查通过
- [ ] API 响应正常
- [ ] 数据库连接正常
- [ ] 记录部署时间和版本

---

## 🐛 常见问题和解决

### Q1: 镜像拉取失败

```bash
# 检查镜像是否存在
docker pull ghcr.io/lczc1988/dify-api:develop

# 登录 GitHub Container Registry
docker login ghcr.io -u USERNAME -p TOKEN

# 重试
docker-compose pull
```

### Q2: 端口被占用

```bash
# 查找占用的进程
lsof -i :3000
lsof -i :5001

# 杀死进程
kill -9 <PID>

# 或修改 docker-compose.yml 的端口
ports:
  - "3001:3000"  # 改成 3001
  - "5002:5001"  # 改成 5002
```

### Q3: 数据库连接失败

```bash
# 检查数据库服务
docker-compose ps

# 查看数据库日志
docker-compose logs postgres

# 重建数据库
docker-compose down -v
docker-compose up -d
docker-compose exec -T api python manage.py migrate
```

### Q4: 出现错误需要回滚

```bash
# 方案 D（脚本部署）
docker-compose down
sed -i 's/:develop/:stable/g' docker-compose.yml
docker-compose up -d

# 方案 C（Kubernetes）
kubectl rollout undo deployment/dify-api -n dify

# 方案 C（GitHub Actions）
# 推送回滚 commit
git revert HEAD
git push origin develop
# GitHub Actions 自动重新部署
```

---

## 📊 监控命令

### Docker Compose

```bash
# 实时监控
docker stats

# 查看容器历史
docker logs --tail 100 dify-api
docker logs --tail 100 dify-web

# 进入容器调试
docker-compose exec api bash
docker-compose exec web bash

# 性能分析
docker top <container-id>
```

### Kubernetes

```bash
# 实时监控
kubectl top nodes
kubectl top pods -n dify

# 查看事件
kubectl get events -n dify --sort-by='.lastTimestamp'

# 进入 Pod 调试
kubectl exec -it <pod-name> -n dify -- bash

# 性能分析
kubectl describe pod <pod-name> -n dify
```

---

## 📚 相关文档

| 文档 | 内容 |
|------|------|
| [DEPLOYMENT_GUIDE.md](.github/DEPLOYMENT_GUIDE.md) | 详细部署指南 |
| [scripts/deploy.sh](scripts/deploy.sh) | 部署脚本 |
| [.env.staging](.env.staging) | 环境变量示例 |
| [k8s/staging/deployment.yaml](k8s/staging/deployment.yaml) | K8s 配置 |
| [.github/workflows/deploy.yml](.github/workflows/deploy.yml) | GitHub Actions |

---

## 🎯 推荐路径

### Phase 1：本地开发（当前）
```bash
✅ docker-compose up -d
✅ 本地 Git hooks 验证
✅ GitHub Actions CI 测试
```

### Phase 2：Staging 部署（下一步）
```bash
⏳ 设置 deploy 服务器
⏳ 配置 .env.staging
⏳ ./scripts/deploy.sh staging develop
⏳ 配置 Slack 通知
```

### Phase 3：Production 部署（后续）
```bash
⏳ Kubernetes 集群
⏳ GitHub Actions 自动部署
⏳ 监控和告警
⏳ 灾难恢复方案
```

---

## 🚨 紧急回滚

```bash
# 快速回滚（Docker）
docker-compose pull --no-parallel
docker-compose down
git revert HEAD
docker-compose up -d

# 快速回滚（K8s）
kubectl rollout undo deployment/dify-api -n dify
kubectl rollout undo deployment/dify-web -n dify
kubectl rollout status deployment/dify-api -n dify
```

---

## 📞 获取帮助

- 📖 查看完整文档: [DEPLOYMENT_GUIDE.md](.github/DEPLOYMENT_GUIDE.md)
- 🔍 查看部署日志: `docker-compose logs` 或 GitHub Actions
- 💬 查看 CI/CD 日志: https://github.com/lczc1988/dify/actions
- 📧 提问: 在 GitHub Issues 中提问
