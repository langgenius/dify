# 🌐 部署地点和架构图

## 📍 部署位置矩阵

```
┌─────────────────────────────────────────────────────────────────────┐
│                    部署地点和运行位置                                 │
├──────────┬────────────────┬────────────────┬─────────────┬──────────┤
│ 环境     │ 硬件           │ 访问地址       │ 数据存储    │ 状态     │
├──────────┼────────────────┼────────────────┼─────────────┼──────────┤
│ 本地开发 │ 你的 Mac       │ localhost      │ 本地        │ ✅ 运行中│
│          │ macOS 12.6.7   │ :3000          │ Docker vol  │          │
│          │ Apple Silicon  │ :5001          │             │          │
├──────────┼────────────────┼────────────────┼─────────────┼──────────┤
│ Staging  │ 部署服务器     │ staging.dify   │ Docker vol  │ ⏳ 需配置│
│          │ （需自备）     │ .example.com   │ + 数据库    │          │
│          │ Ubuntu/Debian  │ 或 IP:3000     │             │          │
├──────────┼────────────────┼────────────────┼─────────────┼──────────┤
│ K8s      │ Kubernetes集群 │ k8s-cluster    │ PVC + DB    │ ⏳ 需配置│
│          │ 多个 Node      │ staging.dify   │ services    │          │
│          │ （云平台）     │ .example.com   │             │          │
├──────────┼────────────────┼────────────────┼─────────────┼──────────┤
│ 生产     │ 云平台         │ dify           │ 托管数据库  │ ⏳ 需配置│
│          │ AWS/GCP/Azure  │ .example.com   │ S3 存储     │          │
│          │ 或裸金属       │ CDN + LB       │             │          │
└──────────┴────────────────┴────────────────┴─────────────┴──────────┘
```

---

## 🏗️ 当前部署架构（本地开发）

### Phase 1: 你的 MacBook 上

```
你的 MacBook Pro (Apple Silicon)
├─ macOS 12.6.7
├─ Docker Desktop 4.68.0
├─ 8GB+ RAM 分配给 Docker
└─ 存储空间 20GB+

    ↓
    
Docker Compose (docker-compose.yml)
├─ 容器 3000 → 前端 (dify-web)
│   ├─ Node.js 应用
│   ├─ 监听: 0.0.0.0:3000
│   └─ 访问: http://localhost:3000
│
├─ 容器 5001 → 后端 API (dify-api)
│   ├─ Python 应用
│   ├─ 监听: 0.0.0.0:5001
│   └─ 访问: http://localhost:5001/api
│
├─ 容器 5432 → PostgreSQL 数据库
│   ├─ 监听: 0.0.0.0:5432
│   └─ 数据存储在: Docker volume
│
├─ 容器 6379 → Redis 缓存
│   ├─ 监听: 0.0.0.0:6379
│   └─ 临时数据
│
└─ 容器 其他服务 (nginx, plugin_daemon 等)
    └─ 支持应用运行

    ↓
    
本地访问
├─ 前端: http://localhost:3000 ✅ 可访问
├─ 后端: http://localhost:5001/api ✅ 可访问
└─ 数据库: localhost:5432 ✅ 可访问
```

---

## 🔄 GitHub Actions 工作流程

### 代码流向和部署流程

```
你的 MacBook
    ↓
git commit + git push origin develop
    ↓ (网络)
GitHub 代码仓库
(https://github.com/lczc1988/dify)
    ↓ (触发 webhook)
GitHub Actions 运行环境 (GitHub 的服务器)
    ├─ 步骤 1: 检出代码
    ├─ 步骤 2: 运行 CI 测试
    ├─ 步骤 3: 构建 Docker 镜像
    │   ├─ Backend: dify-api:develop
    │   └─ Frontend: dify-web:develop
    ├─ 步骤 4: 推送镜像到 ghcr.io
    │   (GitHub Container Registry)
    └─ 步骤 5: 部署到 Staging (需配置)
```

### 镜像仓库位置

```
GitHub Container Registry (ghcr.io)
├─ ghcr.io/lczc1988/dify-api:develop
│  ├─ 大小: ~500MB
│  ├─ 含有: Python 应用 + 依赖
│  └─ 更新: 每次 push to develop
│
└─ ghcr.io/lczc1988/dify-web:develop
   ├─ 大小: ~200MB
   ├─ 含有: Node.js 应用 + 依赖
   └─ 更新: 每次 push to develop
```

---

## 🚀 三种部署目标地点

### 方案 1️⃣: 单服务器部署（SSH）

```
你的 MacBook
    ↓
git push origin develop
    ↓
GitHub Actions
    ├─ 构建镜像 ✓
    ├─ 推送到 ghcr.io ✓
    └─ SSH 连接到部署服务器 ← 需配置
        ↓
远程服务器（Staging）
├─ 主机名: staging.dify.example.com
├─ IP: xxx.xxx.xxx.xxx (你的服务器)
├─ 系统: Ubuntu 20.04 LTS
└─ 容器:
    ├─ 前端: dify-web (3000 端口)
    ├─ 后端: dify-api (5001 端口)
    └─ 数据库: PostgreSQL (5432 端口)
    
访问: http://staging.dify.example.com:3000
     http://staging.dify.example.com:5001/api
```

**所需配置:**
```
GitHub Secrets:
- DEPLOY_HOST: staging.dify.example.com
- DEPLOY_USER: deploy-user
- DEPLOY_KEY: (SSH 私钥)
```

---

### 方案 2️⃣: Kubernetes 集群部署

```
你的 MacBook
    ↓
git push origin develop
    ↓
GitHub Actions
    ├─ 构建镜像 ✓
    ├─ 推送到 ghcr.io ✓
    └─ kubectl 部署到 K8s 集群 ← 需配置
        ↓
Kubernetes 集群（可在云平台）
├─ 节点 1: Master + Worker
├─ 节点 2: Worker
├─ 节点 3: Worker
│
├─ Namespace: dify
│   ├─ Pod 副本 (dify-api)
│   │   ├─ Replica 1: 5001 端口
│   │   ├─ Replica 2: 5001 端口
│   │   └─ Replica 3: 5001 端口 (自动扩展)
│   │
│   ├─ Pod 副本 (dify-web)
│   │   ├─ Replica 1: 3000 端口
│   │   └─ Replica 2: 3000 端口
│   │
│   ├─ Service: LoadBalancer
│   │   └─ 外部 IP: xxx.xxx.xxx.xxx
│   │
│   ├─ Persistent Volumes
│   │   ├─ 数据库存储 (100GB)
│   │   └─ 文件存储 (应用数据)
│   │
│   └─ ConfigMaps: 配置和环境变量

访问: http://kubernetes-lb.example.com:3000
     自动负载均衡
     自动故障恢复
     自动扩缩容
```

**所需配置:**
```
GitHub Secrets:
- KUBE_CONFIG: (base64 编码的 kubeconfig)
- 云平台的访问凭证
```

**云平台选择:**
- ☁️ AWS (EKS)
- ☁️ Google Cloud (GKE)
- ☁️ Azure (AKS)
- ☁️ 自建 K8s 集群

---

### 方案 3️⃣: 完全托管服务（可选）

```
你的 MacBook
    ↓
git push origin develop
    ↓
GitHub Actions
    └─ 自动化部署 (根据配置)
        ↓
云平台托管服务
├─ Heroku / Railway / Render
├─ Firebase Hosting
├─ Vercel (前端)
└─ Render / Railway (后端)

特点:
- 完全托管，零运维
- 按使用量计费
- 自动部署和更新
- 内置 SSL / CDN
```

---

## 📊 部署位置决策树

```
             我应该部署在哪里？
                    │
         ┌──────────┼──────────┐
         │          │          │
     个人项目      小团队      企业生产
      学习用      内部用      高可用
         │          │          │
      本地+       单服务器+   Kubernetes+
     Docker      SSH部署     云平台
     Compose
         │          │          │
    localhost   部署服务器   K8s 集群
    :3000      :3000        LoadBalancer
    
    💻私有      🏢商业      ☁️云端
    完全控制    中等成本    完全托管
    零成本      简单维护    自动扩展
```

---

## 🗂️ 你需要准备什么？

### ✅ 已有（当前）

```
✓ 本地 Mac: docker-compose up -d
✓ GitHub: 代码仓库 + Actions
✓ ghcr.io: 镜像仓库（自动）
```

### 🔄 需准备（可选）

#### 方案 1 - 部署到单服务器

```
需要:
☐ 购买云服务器 ($5-20/月)
   ├─ AWS EC2 小实例
   ├─ DigitalOcean Droplet
   ├─ Linode
   ├─ Vultr
   └─ Hetzner
   
☐ 配置 SSH 密钥登录
☐ 配置 GitHub Secrets (DEPLOY_HOST/KEY)
☐ 配置域名 DNS
☐ 安装 Docker 和 Docker Compose
```

#### 方案 2 - 部署到 Kubernetes

```
需要:
☐ Kubernetes 集群
   ├─ 云托管 K8s
   │  ├─ AWS EKS (~$70/月)
   │  ├─ Google GKE (~$60/月)
   │  └─ Azure AKS (~$50/月)
   │
   └─ 自建 K8s
      ├─ 3 个或更多服务器
      ├─ 技术复杂度高
      └─ 月成本 $100+

☐ kubectl 访问权限
☐ 配置 GitHub Secrets (KUBE_CONFIG)
☐ 持久化存储 (PVC)
☐ 监控系统 (Prometheus/Grafana)
```

---

## 💰 成本对比

```
┌──────────┬─────────┬──────────┬───────────┬──────────────┐
│ 方案     │ 初期   │ 月维护   │ 扩展性    │ 推荐场景     │
├──────────┼─────────┼──────────┼───────────┼──────────────┤
│ 本地Dev  │ $0      │ 免费     │ 个人PC    │ 学习/开发    │
│ 单服务器 │ $0-50   │ $5-20    │ 手动扩展  │ 小型项目     │
│ K8s 云   │ $50-100 │ $50-200+ │ 自动扩展  │ 中型项目     │
│ 自建 K8s │ $500+   │ $100+    │ 完全控制  │ 大型项目     │
│ 完全托管 │ $0-100  │ 按用量   │ 自动      │ 快速开发     │
└──────────┴─────────┴──────────┴───────────┴──────────────┘
```

---

## 🎯 推荐路线

### 第一阶段（当前 ✅）

```
在本地 Mac 上运行
╔════════════════════════════════╗
║ docker-compose up -d           ║
║ 访问: http://localhost:3000    ║
║ ✓ 功能测试                      ║
║ ✓ 代码开发                      ║
╚════════════════════════════════╝
```

### 第二阶段（Staging - 推荐 2-4 周后）

```
部署到单个服务器
╔════════════════════════════════╗
║ 购买: DigitalOcean/AWS 小实例  ║
║ 成本: $5-10/月                 ║
║ 部署: ./scripts/deploy.sh      ║
║ 访问: http://staging.xxx.com   ║
║ ✓ 演示给团队/客户              ║
║ ✓ 性能测试                     ║
║ ✓ 实际使用反馈                 ║
╚════════════════════════════════╝
```

### 第三阶段（Production - 用户增长后）

```
升级到 Kubernetes（需要时）
╔════════════════════════════════╗
║ 使用: AWS EKS / GCP GKE        ║
║ 成本: $50-200/月（可扩展）     ║
║ 部署: kubectl apply -f k8s/    ║
║ 访问: http://dify.example.com  ║
║ ✓ 自动扩展 (1-100+ Pod)        ║
║ ✓ 99.9% 可用性                 ║
║ ✓ 自动故障恢复                 ║
║ ✓ 监控和告警                   ║
╚════════════════════════════════╝
```

---

## 🔗 快速开始

### 你现在的位置

```
✅ 本地开发环境已启动
├─ 访问地址: http://localhost:3000
└─ 部署位置: 你的 MacBook
```

### 下一步（可选）

**如果想部署到真实服务器：**

1. 阅读完整指南
   ```
   .github/DEPLOYMENT_GUIDE.md
   ```

2. 选择部署方案
   ```
   方案 D: 脚本部署（最简单）
   ./scripts/deploy.sh staging develop
   ```

3. 配置 GitHub Secrets（自动化）
   ```
   Settings → Secrets
   添加: DEPLOY_HOST, DEPLOY_KEY 等
   ```

4. 推送代码自动部署
   ```
   git push origin develop
   → GitHub Actions 自动部署
   ```

---

## 📞 常见问题

**Q: 我能在哪里找到部署的应用？**
- 本地: http://localhost:3000
- 服务器: http://your-server-ip:3000
- 云平台: http://your-domain.com

**Q: 部署到生产需要多少成本？**
- 单服务器: $5-50/月
- Kubernetes: $50-200/月
- 完全托管: 按使用量计费

**Q: 如何自动化部署？**
- GitHub Actions (已配置 ✓)
- 添加 GitHub Secrets
- 自动执行 CI/CD

**Q: 我现在应该做什么？**
- ✓ 在本地继续开发
- ⏳ 准备就绪时再部署
- 🎓 先理解各方案再选择
