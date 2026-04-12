# CI/CD Pipeline Documentation

## 概述 / Overview

Dify 项目使用 GitHub Actions 作为 CI/CD 平台，自动化测试、构建和部署流程。

## Workflows 说明

### 1. CI Pipeline (`ci.yml`)

**触发条件：**
- Push 到 `main` 或 `develop` 分支
- Pull Request 指向 `main` 或 `develop` 分支

**执行步骤：**

#### 后端测试
- 支持 Python 3.10, 3.11, 3.12
- 使用 Poetry 管理依赖
- 运行 pytest
- 运行 pylint 代码检查
- 生成覆盖率报告

```bash
# 本地运行
cd api
poetry install
poetry run pytest
poetry run pylint
```

#### 前端测试
- 支持 Node.js 20.x, 22.x
- 使用 pnpm 管理依赖
- 类型检查 (TypeScript)
- ESLint 代码检查
- 构建验证
- 单元测试

```bash
# 本地运行
cd web
pnpm install
pnpm type-check
pnpm lint
pnpm build
pnpm test
```

#### 代码质量检查
- Conventional Commits 检查
- 文件权限检查

### 2. Deploy Pipeline (`deploy.yml`)

**触发条件：**
- Push 到 `develop` 分支
- 手动触发 (workflow_dispatch)

**执行步骤：**

1. **构建后端 Docker 镜像**
   - 标签化（branch、tag、SHA）
   - 缓存优化
   - 推送到 Container Registry

2. **构建前端 Docker 镜像**
   - 标签化（branch、tag、SHA）
   - 缓存优化
   - 推送到 Container Registry

3. **部署到 Staging**
   - 触发部署流程
   - Slack 通知（错误时）

## 预置检查清单

### Pull Request 模板
所有 PR 必须包含：
- 改动描述
- 类型分类（Bug fix / Feature / Docs / Refactor / Style / Performance）
- 关联 Issue 编号
- 测试清单

### CODEOWNERS
定义代码所有者，自动分配审查者：
- `/api/` - 后端维护者
- `/web/` - 前端维护者
- `/.github/workflows/` - DevOps 维护者

## 本地 Git Hooks

### Pre-commit Hook
在提交前自动运行检查：

```bash
# 自动执行内容：
1. 后端检查 - Poetry pytest/pylint
2. 前端检查 - pnpm type-check/lint（仅修改的文件）

# 位置
.git/hooks/pre-commit
```

使用 `--no-verify` 跳过检查（不推荐）：
```bash
git commit --no-verify
```

## 环境变量配置

### GitHub Secrets（如需部署）

在 Repository Settings → Secrets 添加：

```
SLACK_WEBHOOK       # Slack 通知 webhook
DOCKER_REGISTRY_URL # Docker 镜像仓库地址
KUBE_CONFIG         # Kubernetes 配置（如使用 K8s）
```

## 策略和最佳实践

### 1. 分支策略
- `main` - 生产分支，需要 PR 审查
- `develop` - 开发分支，CI/CD 推产
- `feature/*` - 功能分支，PR 到 develop

### 2. Commit Message 规范
遵循 Conventional Commits：

```
<type>(<scope>): <subject>

<body>

<footer>
```

**类型(Type)：**
- `feat` - 新功能
- `fix` - 错误修复
- `docs` - 文档
- `style` - 代码风格
- `refactor` - 重构
- `perf` - 性能优化
- `test` - 测试
- `chore` - 构建/工具

**示例：**
```
feat(api): add user authentication

- Implement JWT token generation
- Add password hashing with bcrypt
- Create authentication middleware

Closes #123
```

### 3. 代码审查
- 等待 CI/CD 通过
- 至少 1 个批准
- 更新后需要重新审查

### 4. 部署前检查
- 所有 CI 检查通过 ✅
- Code review 批准 ✅
- 无冲突合并 ✅

## 故障排除

### CI 失败排查

1. **后端测试失败**
   ```bash
   # 本地重现
   cd api
   poetry install
   poetry run pytest -v
   ```

2. **前端测试失败**
   ```bash
   # 本地重现
   cd web
   pnpm install
   pnpm type-check
   pnpm lint
   ```

3. **Docker 构建失败**
   ```bash
   # 检查 Dockerfile
   docker build -f api/Dockerfile .
   docker build -f web/Dockerfile .
   ```

### 跳过 CI（不推荐）
- 在 Commit message 中添加 `[skip ci]`
- 仅用于文档/配置改动

## 监控和告警

### GitHub Actions 仪表板
访问 Repository → Actions 查看：
- 所有 workflow 运行
- 实时执行日志
- 失败历史
- 执行时间趋势

### 本地调试

运行 GitHub Actions 本地模拟器：
```bash
# 安装 act
brew install act

# 运行特定 workflow
act -j backend-tests

# 运行所有 jobs
act
```

## 后续改进方向

- [ ] 集成代码覆盖率徽章
- [ ] 自动发布版本
- [ ] 集成性能基准测试
- [ ] 安全扫描（SAST/DAST）
- [ ] 自动文档生成
- [ ] Docker 镜像扫描
