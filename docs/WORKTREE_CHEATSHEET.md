# Git Worktree 速查表

## 🚀 快速开始

```bash
# 使用辅助脚本（推荐）
./scripts/worktree-helpers.sh setup      # 创建常用 worktree
./scripts/worktree-helpers.sh list       # 列出所有 worktree
./scripts/worktree-helpers.sh feature authentication   # 创建功能分支
./scripts/worktree-helpers.sh review 123 # Review PR #123
```

## 📋 常用命令

### 创建 Worktree

```bash
# 基本语法
git worktree add <路径> <分支>

# 创建功能分支 worktree
git worktree add ../dify-feature-auth -b feature/authentication

# 从远程分支创建
git fetch origin
git worktree add ../dify-review origin/feature/some-branch

# 创建 PR review worktree
git fetch origin pull/123/head:pr-123
git worktree add ../dify-review-123 pr-123

# 从 tag 创建（版本对比）
git worktree add ../dify-v1.11.4 1.11.4
```

### 管理 Worktree

```bash
# 列出所有 worktree
git worktree list
git worktree list --porcelain    # 详细信息

# 删除 worktree
git worktree remove ../dify-feature-auth
git worktree remove --force ../dify-feature-auth  # 强制删除

# 移动 worktree
git worktree move ../old-path ../new-path

# 清理已删除的 worktree 记录
git worktree prune
```

## 🎯 典型场景

### 场景 1: 紧急修复

```bash
# 1. 创建 hotfix worktree
./scripts/worktree-helpers.sh hotfix security-patch

# 2. 修复并提交
cd ../dify-hotfix-security-patch
npm install
# 修复代码...
git add .
git commit -m "fix: security vulnerability"
git push origin hotfix/security-patch

# 3. 创建 PR，合并后删除
./scripts/worktree-helpers.sh remove hotfix-security-patch
```

### 场景 2: Code Review

```bash
# 1. 创建 review worktree
./scripts/worktree-helpers.sh review 456

# 2. 测试 PR
cd ../dify-review-pr-456
npm install
npm run dev  # 在端口 3002 测试

# 3. Review 完成后删除
./scripts/worktree-helpers.sh remove review-pr-456
```

### 场景 3: 并行开发

```bash
# 创建多个功能 worktree
./scripts/worktree-helpers.sh feature authentication
./scripts/worktree-helpers.sh feature search-optimization

# 在不同窗口工作
cd ../dify-feature-authentication && npm run dev       # Terminal 1
cd ../dify-feature-search-optimization && npm run dev  # Terminal 2
```

### 场景 4: 版本对比

```bash
# 创建版本对比 worktree
git worktree add ../dify-v1.11.4 upstream-1.11.4
git worktree add ../dify-v1.12.0 upstream-1.12.0

# 对比代码
diff -r ../dify-v1.11.4/api ../dify-v1.12.0/api
meld ../dify-v1.11.4 ../dify-v1.12.0
```

## 🛠️ 辅助脚本

### 所有命令

| 命令 | 说明 | 示例 |
|------|------|------|
| `setup` | 创建常用 worktree | `./scripts/worktree-helpers.sh setup` |
| `list` | 列出所有 worktree | `./scripts/worktree-helpers.sh list` |
| `status` | 显示所有状态 | `./scripts/worktree-helpers.sh status` |
| `clean` | 清理已合并的 | `./scripts/worktree-helpers.sh clean` |
| `feature <name>` | 创建功能分支 | `./scripts/worktree-helpers.sh feature auth` |
| `hotfix <name>` | 创建紧急修复 | `./scripts/worktree-helpers.sh hotfix bug` |
| `review <num>` | Review PR | `./scripts/worktree-helpers.sh review 123` |
| `remove <name>` | 删除 worktree | `./scripts/worktree-helpers.sh remove auth` |
| `open <name>` | 在 VS Code 打开 | `./scripts/worktree-helpers.sh open auth` |

## 📁 目录命名规范

```bash
~/projects/
├── dify/                       # 主仓库 (dev 分支)
├── dify-review/                # 常驻 review worktree
├── dify-testing/               # 常驻测试环境
├── dify-feature-<name>/        # 功能开发
├── dify-hotfix-<name>/         # 紧急修复
├── dify-review-pr-<num>/       # PR review
└── dify-upstream-<version>/    # 版本参考
```

## ⚙️ 环境配置

### 不同端口运行

```bash
# 方式 1: 命令行参数
cd ~/projects/dify
npm run dev                      # 3000

cd ~/projects/dify-testing
npm run dev -- --port 3001       # 3001

cd ~/projects/dify-review
PORT=3002 npm run dev            # 3002
```

### .env 文件

```bash
# ~/projects/dify/.env
PORT=3000
API_PORT=5000

# ~/projects/dify-testing/.env
PORT=3001
API_PORT=5001

# ~/projects/dify-review/.env
PORT=3002
API_PORT=5002
```

## ⚠️ 注意事项

### ✅ 可以做的

- ✅ 同时在多个 worktree 中工作
- ✅ 在不同 worktree 中运行开发服务器（不同端口）
- ✅ 在任何 worktree 中执行 git fetch/pull
- ✅ 每个 worktree 有独立的 node_modules

### ❌ 不能做的

- ❌ 同一分支不能在多个 worktree 中 checkout
- ❌ 在一个 worktree 中操作另一个 worktree 的文件
- ❌ 共享 node_modules（每个需要独立安装）

### 💡 最佳实践

1. **及时清理**：用完的 worktree 要删除
2. **规范命名**：使用统一的命名规范
3. **独立窗口**：每个 worktree 在独立的 IDE 窗口打开
4. **定期同步**：定期在各个 worktree 中 pull 最新代码

## 🔧 故障排除

### 分支已被使用

```bash
# 错误：fatal: 'feature/auth' is already checked out at '...'
# 解决：先删除旧的 worktree 或使用不同名称
git worktree remove ../old-worktree
```

### 删除失败（有未提交更改）

```bash
# 选项 1: 提交更改
cd ../dify-feature-auth
git add .
git commit -m "WIP: save work"

# 选项 2: 强制删除
git worktree remove --force ../dify-feature-auth
```

### 清理已删除目录的记录

```bash
# 如果手动删除了 worktree 目录
rm -rf ../dify-old-worktree

# 清理 Git 记录
git worktree prune
```

## 📚 更多资源

- **详细指南**: [docs/GIT_WORKTREE_GUIDE.md](./GIT_WORKTREE_GUIDE.md)
- **团队工作流**: [docs/TEAM_WORKFLOW.md](./TEAM_WORKFLOW.md)
- **Git 官方文档**: https://git-scm.com/docs/git-worktree

## 💬 常见问题速答

**Q: Worktree 占用多少空间？**
A: .git 共享（200MB），工作目录（500MB），node_modules（800MB/个）

**Q: 如何在 worktree 间共享更改？**
A: 使用 stash、patch 或临时提交 + cherry-pick

**Q: 影响 CI/CD 吗？**
A: 不影响。CI/CD 使用标准 clone，不涉及 worktree

**Q: 可以嵌套吗？**
A: 不建议。保持扁平的目录结构

**Q: 与分支切换相比的优势？**
A: 零切换成本、独立环境、可并行工作

---

**快速帮助**: `./scripts/worktree-helpers.sh help`
