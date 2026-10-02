# Docker 安装建议 - 针对你的 Mac 配置

## 📊 你的系统配置

```
型号:          MacBook Pro (2015 Mid, 15-inch)
处理器:        Intel Core i7-4770HQ @ 2.2 GHz (4核)
内存:          16 GB
架构:          x86_64 (Intel)
系统版本:      macOS 12.7.6 (Monterey)
内核:          Darwin 21.6.0
```

## ✅ Docker 版本推荐

### 推荐版本: Docker Desktop 4.25.x - 4.34.x

**原因**:
1. ✅ macOS 12 (Monterey) 完全支持
2. ✅ Intel 芯片完美兼容
3. ✅ 16GB 内存足够运行 Dify (需要 4-8GB)
4. ✅ 稳定版本，Bug 较少

### ⚠️ 版本限制

**不推荐安装最新版 (4.35+)**:
- Docker Desktop 4.35+ 要求 macOS 13+ (Ventura)
- 你的 macOS 12.7.6 不支持

**最佳选择**: Docker Desktop 4.34.3 (最后支持 macOS 12 的版本)

## 🚀 安装方法

### 方法 1: 直接下载安装（推荐）

**下载地址**:
```
Docker Desktop 4.34.3 (Intel Chip):
https://desktop.docker.com/mac/main/amd64/170107/Docker.dmg
```

**安装步骤**:
1. 下载 DMG 文件
2. 双击打开
3. 将 Docker.app 拖到 Applications 文件夹
4. 打开 Docker.app
5. 等待 Docker 启动（首次启动需要几分钟）
6. 看到菜单栏有 Docker 鲸鱼图标表示成功

### 方法 2: 使用 Homebrew

```bash
# 安装 Docker Desktop
brew install --cask docker

# 注意: Homebrew 可能安装较新版本
# 如果出现不兼容，请使用方法 1
```

## ⚙️ Docker 配置建议

### 启动 Docker Desktop 后配置

1. **打开 Docker Desktop**
2. **点击设置图标 (齿轮)** 
3. **Resources 配置**:

```
CPU: 4 cores (建议分配 2-3 核给 Docker)
Memory: 6-8 GB (16GB 总内存，建议分配 6-8GB 给 Docker)
Swap: 1-2 GB
Disk: 60 GB (根据实际需要调整)
```

### 推荐配置 (针对 Dify):

```yaml
Resources:
  CPUs: 3
  Memory: 6 GB
  Swap: 1 GB
  Disk Image Size: 60 GB

Features:
  ✅ Use virtualization framework
  ✅ Enable VirtioFS
  ❌ Use Rosetta (Intel 芯片不需要)
```

## 🔧 安装后验证

```bash
# 1. 检查 Docker 版本
docker --version
# 应显示: Docker version 4.34.x

# 2. 检查 Docker Compose 版本
docker compose version
# 应显示: Docker Compose version v2.x.x

# 3. 运行测试容器
docker run hello-world
# 应显示: Hello from Docker!

# 4. 查看系统信息
docker info
```

## 📋 Dify 部署要求检查

| 要求项 | 最低配置 | 你的配置 | 状态 |
|--------|---------|---------|------|
| CPU | 2 Core | 4 Core | ✅ 充足 |
| Memory | 4 GB | 16 GB | ✅ 充足 |
| Docker | 20.10+ | 待安装 | ⏳ 待安装 |
| Docker Compose | 2.24+ | 待安装 | ⏳ 待安装 |

**结论**: 你的硬件配置完全满足运行 Dify 的要求！

## 🎯 安装后下一步

### 1. 快速启动 Dify

```bash
cd /Users/wesharn/workplace/ai-agent-sys/docker
cp .env.example .env
docker compose up -d
```

### 2. 查看容器状态

```bash
docker compose ps
```

### 3. 访问应用

```
控制台: http://localhost/install
```

## ⚠️ 常见问题

### Q1: Docker 启动慢
**原因**: 首次启动需要初始化虚拟机
**解决**: 等待 2-5 分钟，观察菜单栏图标变化

### Q2: 提示需要更新 macOS
**原因**: 安装了过新的 Docker 版本
**解决**: 卸载后安装 Docker 4.34.3

```bash
# 卸载当前版本
rm -rf /Applications/Docker.app
rm -rf ~/Library/Group\ Containers/group.com.docker
rm -rf ~/Library/Containers/com.docker.docker

# 重新安装 4.34.3
```

### Q3: 内存不足
**原因**: Docker 分配内存过多
**解决**: 调整 Docker Desktop 内存分配到 4-6GB

### Q4: Docker daemon 未启动
**解决**: 
```bash
# 确保 Docker Desktop 应用在运行
open -a Docker
```

## 📚 版本历史参考

| Docker Desktop | macOS 要求 | 发布日期 | 推荐度 |
|---------------|-----------|---------|-------|
| 4.34.3 | 12+ | 2024-10 | ⭐⭐⭐⭐⭐ 最推荐 |
| 4.33.x | 12+ | 2024-09 | ⭐⭐⭐⭐ |
| 4.30.x | 12+ | 2024-06 | ⭐⭐⭐ |
| 4.25.x | 11+ | 2023-12 | ⭐⭐⭐ |
| 4.35+ | 13+ | 2024-11 | ❌ 不兼容 |

## 🔗 相关资源

- [Docker Desktop 官方下载](https://docs.docker.com/desktop/release-notes/)
- [Docker 文档](https://docs.docker.com/)
- [Dify 快速启动](QUICKSTART.md)
- [系统架构](ARCHITECTURE.md)

## 💾 下载链接汇总

```bash
# Docker Desktop 4.34.3 (Intel Chip)
# 适用于 macOS 12+ Intel 芯片
https://desktop.docker.com/mac/main/amd64/170107/Docker.dmg

# 备用下载 (如果官方链接失效)
# 可以从 Docker Hub 搜索历史版本
```

## ✨ 安装成功标志

当你看到以下内容时，表示安装成功：

1. ✅ 菜单栏出现 Docker 鲸鱼图标
2. ✅ `docker --version` 显示版本号
3. ✅ `docker compose version` 显示版本号
4. ✅ `docker run hello-world` 成功运行

**准备好安装了吗？** 下载链接已在上方提供！
