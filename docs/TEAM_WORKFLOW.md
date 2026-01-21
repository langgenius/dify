# 团队协作工作流程

## 概述

本文档描述了 Dify fork 仓库的团队协作工作流程和分支管理策略。

## 分支结构

```
origin (fork: xianglixiang/dify)
├── dev                 ← 主开发分支（受保护）
├── upstream-1.11.4     ← 上游版本追踪分支（只读）
├── feature/*           ← 功能开发分支
├── hotfix/*            ← 紧急修复分支
└── upgrade/*           ← 版本升级分支

upstream (source: langgenius/dify)
├── main
└── tags (1.11.4, 1.12.0, ...)
```

## 分支保护规则

### 本地保护（Git Hooks）

已配置的 Git hooks：
- ✅ `pre-commit`: 阻止直接提交到 dev/main/upstream-* 分支
- ✅ `pre-push`: 阻止直接推送到受保护分支

### GitHub 保护（需要配置）

请参考 [`.github/BRANCH_PROTECTION_GUIDE.md`](../.github/BRANCH_PROTECTION_GUIDE.md) 配置 GitHub 分支保护规则：
- dev 分支：要求 PR + 至少 1 人审查
- upstream-* 分支：只读，仅管理员可修改

## 标准开发流程

### 1. 开始新功能

```bash
# 确保 dev 分支是最新的
git checkout dev
git pull origin dev

# 创建功能分支
git checkout -b feature/your-feature-name

# 示例功能分支命名：
# feature/add-user-authentication
# feature/improve-search-performance
# feature/support-new-llm-provider
```

### 2. 开发和提交

```bash
# 开发代码...

# 提交更改（遵循 Conventional Commits）
git add .
git commit -m "feat: add user authentication support"

# 更多提交...
git commit -m "test: add authentication tests"
git commit -m "docs: update authentication documentation"
```

### 3. 推送功能分支

```bash
# 推送到远程
git push origin feature/your-feature-name
```

### 4. 创建 Pull Request

1. 访问 https://github.com/xianglixiang/dify/pulls
2. 点击 "New Pull Request"
3. 选择：`base: dev` ← `compare: feature/your-feature-name`
4. 填写 PR 描述（会自动使用模板）
5. 请求团队成员审查

### 5. 代码审查

**作为 PR 作者：**
- 确保所有 CI 检查通过
- 回应审查意见
- 根据反馈修改代码

**作为审查者：**
- 检查代码质量和逻辑
- 运行本地测试
- 提供建设性反馈
- 批准或请求修改

### 6. 合并 PR

- 审查通过后，通过 GitHub UI 合并
- 推荐使用 "Squash and merge" 保持历史清晰
- 合并后删除功能分支

### 7. 清理本地分支

```bash
# 更新 dev 分支
git checkout dev
git pull origin dev

# 删除已合并的功能分支
git branch -d feature/your-feature-name
```

## 特殊场景

### 紧急修复（Hotfix）

```bash
# 1. 从 dev 创建 hotfix 分支
git checkout dev
git pull origin dev
git checkout -b hotfix/critical-bug-fix

# 2. 快速修复
git commit -m "fix: resolve critical security vulnerability"

# 3. 推送并创建 PR（标记为 urgent）
git push origin hotfix/critical-bug-fix

# 4. 请求加急审查和合并
```

### 版本升级

```bash
# 1. 获取新版本（由管理员执行）
git fetch upstream --tags

# 2. 创建新的上游追踪分支
git checkout -b upstream-1.12.0 1.12.0
git push origin upstream-1.12.0

# 3. 创建升级分支
git checkout dev
git pull origin dev
git checkout -b upgrade/to-1.12.0

# 4. 合并新版本
git rebase upstream-1.12.0
# 或者：git merge upstream-1.12.0

# 5. 解决冲突
# 编辑冲突文件...
git add <resolved-files>
git rebase --continue  # 或 git commit

# 6. 推送并创建 PR
git push origin upgrade/to-1.12.0 --force-with-lease

# 7. 充分测试后合并到 dev
```

### 同步 fork 的 main 分支（可选）

如果想保持 fork 的 main 分支与上游同步：

```bash
git checkout main
git pull upstream main
git push origin main
```

## 提交信息规范

遵循 [Conventional Commits](https://www.conventionalcommits.org/)：

```
<type>(<scope>): <subject>

<body>

<footer>
```

### 类型（Type）

- `feat`: 新功能
- `fix`: Bug 修复
- `docs`: 文档更新
- `style`: 代码格式（不影响功能）
- `refactor`: 重构
- `perf`: 性能优化
- `test`: 测试
- `chore`: 构建/工具/依赖更新

### 示例

```bash
feat(api): add user authentication endpoint

- Implement JWT-based authentication
- Add login and logout endpoints
- Include rate limiting for security

Closes #123
```

## 代码质量检查

### 提交前检查（自动）

Git hooks 会在提交前运行：
- 分支保护检查

### PR 前检查（手动）

```bash
# Backend
make lint
make type-check
uv run --project api --dev dev/pytest/pytest_unit_tests.sh

# Frontend
cd web
pnpm lint:fix
pnpm type-check:tsgo
pnpm test
```

### CI/CD 检查（自动）

PR 创建后，GitHub Actions 会自动运行：
- Linting
- Type checking
- Unit tests
- Integration tests（如果配置）

## 团队成员上手指南

### 首次设置

```bash
# 1. Clone 仓库
git clone git@github.com:xianglixiang/dify.git
cd dify

# 2. 添加 upstream remote
git remote add upstream https://github.com/langgenius/dify.git
git fetch upstream --tags

# 3. 设置 Git hooks
./scripts/setup-git-hooks.sh

# 4. 安装依赖
# Backend
cd api
uv sync

# Frontend
cd web
pnpm install

# 5. 验证环境
make lint
make type-check
cd web && pnpm type-check:tsgo
```

### 日常工作流

```bash
# 每天开始前
git checkout dev
git pull origin dev

# 创建功能分支
git checkout -b feature/my-feature

# 开发、提交、推送
# ...

# 创建 PR 并等待审查
```

## 常见问题

### Q: 我不小心在 dev 分支上提交了，怎么办？

```bash
# 方法 1: 使用 cherry-pick 转移提交
git checkout -b feature/save-my-work
git checkout dev
git reset --hard origin/dev
git checkout feature/save-my-work
git cherry-pick <commit-hash>

# 方法 2: 如果还没推送，直接重置
git checkout dev
git reset --soft HEAD~1  # 保留更改
git checkout -b feature/save-my-work
git commit -m "your message"
```

### Q: 我的功能分支落后 dev 很多，如何同步？

```bash
git checkout feature/my-feature
git fetch origin
git rebase origin/dev  # 或 git merge origin/dev

# 解决冲突后
git push origin feature/my-feature --force-with-lease
```

### Q: 如何绕过 Git hooks？

```bash
# 不推荐，但紧急情况下可以：
git commit --no-verify -m "message"

# 或临时禁用 hook
mv .git/hooks/pre-commit .git/hooks/pre-commit.disabled
# ... 提交 ...
mv .git/hooks/pre-commit.disabled .git/hooks/pre-commit
```

### Q: PR 被拒绝了，如何修改？

```bash
# 在功能分支上继续修改
git checkout feature/my-feature

# 修改代码...
git add .
git commit -m "fix: address review comments"

# 推送更新（PR 会自动更新）
git push origin feature/my-feature
```

## 最佳实践

### ✅ 推荐做法

1. **小而频繁的提交**：每个提交做一件事
2. **描述性的提交信息**：清楚说明改动内容和原因
3. **及时同步**：定期从 dev 同步到功能分支
4. **尽早创建 PR**：可以创建 Draft PR 获得早期反馈
5. **自测**：提交 PR 前运行所有测试
6. **及时响应**：快速回应审查意见

### ❌ 避免做法

1. **直接推送到 dev**：始终通过 PR
2. **巨大的 PR**：难以审查，容易出错
3. **含糊的提交信息**："fix bug" "update code"
4. **跳过测试**：没有测试的代码不应该合并
5. **忽略审查意见**：审查是为了提高代码质量
6. **在功能分支上 force push**：使用 `--force-with-lease`

## 工具和资源

### Git 工具

- [Git Flow](https://github.com/nvie/gitflow) - Git 扩展工具
- [Lazygit](https://github.com/jesseduffield/lazygit) - 终端 Git UI
- [GitHub CLI](https://cli.github.com/) - 命令行管理 PR

### 代码审查

- [GitHub PR Review Guide](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/reviewing-changes-in-pull-requests/about-pull-request-reviews)
- [Google Code Review Guidelines](https://google.github.io/eng-practices/review/)

### 提交规范

- [Conventional Commits](https://www.conventionalcommits.org/)
- [Commitizen](https://github.com/commitizen/cz-cli) - 辅助工具

## 联系和支持

- 分支保护配置问题：联系仓库管理员
- 工作流程问题：参考本文档或在团队群组讨论
- Dify 功能问题：查看 [上游文档](https://docs.dify.ai/)

## 更新记录

- 2026-01-21: 初始版本，建立分支管理策略和团队工作流程
