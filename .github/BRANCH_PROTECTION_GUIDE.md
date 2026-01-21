# 分支保护规则配置指南

## 概述
本文档说明如何在 GitHub 上为 dev 和 upstream-* 分支设置保护规则，确保团队协作的代码质量和流程规范。

## 配置步骤

### 1. 访问仓库设置
1. 打开 GitHub 仓库：https://github.com/xianglixiang/dify
2. 点击 `Settings` 标签
3. 在左侧菜单找到 `Branches`

### 2. 为 `dev` 分支设置保护规则

点击 `Add branch protection rule`，配置如下：

#### Branch name pattern
```
dev
```

#### 推荐的保护规则配置

##### ✅ 必须启用的规则

**Require a pull request before merging**
- ✅ 启用此选项（强制使用 PR）
- ✅ Require approvals: `1` 或更多（至少1人审查）
- ✅ Dismiss stale pull request approvals when new commits are pushed（新提交时重新审查）
- ❌ Require review from Code Owners（可选，如果有 CODEOWNERS 文件）

**Require status checks to pass before merging**（如果配置了 CI/CD）
- ✅ 启用此选项
- ✅ Require branches to be up to date before merging
- 添加必须通过的检查项：
  - `Backend Lint` (make lint)
  - `Backend Type Check` (make type-check)
  - `Backend Tests` (pytest unit tests)
  - `Frontend Lint` (pnpm lint:fix)
  - `Frontend Type Check` (pnpm type-check:tsgo)
  - `Frontend Tests` (pnpm test)

**Require conversation resolution before merging**
- ✅ 启用此选项（确保所有 PR 评论都已解决）

**Require signed commits**（可选，增强安全性）
- ⚠️ 根据团队需求决定

**Require linear history**（推荐）
- ✅ 启用此选项（保持提交历史线性，禁止 merge commits）
- 或者关闭此选项，允许 merge commits

**Do not allow bypassing the above settings**
- ✅ Include administrators（包括管理员也必须遵守规则）

##### 🔒 访问控制

**Restrict who can push to matching branches**（可选）
- 如果需要，可以限制只有特定人员/团队可以推送
- 对于 dev 分支，建议不启用（允许所有协作者创建 PR）

**Allow force pushes**
- ❌ 禁用（防止强制推送覆盖历史）

**Allow deletions**
- ❌ 禁用（防止误删除分支）

### 3. 为 `upstream-*` 分支设置保护规则

点击 `Add branch protection rule`，配置如下：

#### Branch name pattern
```
upstream-*
```

#### 保护规则配置

**Require a pull request before merging**
- ✅ 启用此选项
- ✅ Require approvals: `2`（更严格的审查）

**Lock branch**（推荐）
- ✅ 启用此选项（将分支设为只读）
- 说明：upstream-* 分支应该只作为版本基准，不应该有任何自定义提交

**Restrict who can push to matching branches**
- ✅ 启用并限制为仓库管理员
- 或者不添加任何人（完全只读）

**Allow force pushes**
- ❌ 禁用

**Allow deletions**
- ❌ 禁用

### 4. 可选：为 `main` 分支设置保护规则

如果你想保留 main 分支作为稳定版本：

#### Branch name pattern
```
main
```

#### 保护规则
- 与 dev 分支类似，但可以设置更严格的审查要求
- 或者考虑将 main 分支作为归档，只保护 dev 分支

## 工作流程

### 标准开发流程

```bash
# 1. 从 dev 创建功能分支
git checkout dev
git pull origin dev
git checkout -b feature/your-feature-name

# 2. 开发并提交
git add .
git commit -m "feat: your feature description"
git push origin feature/your-feature-name

# 3. 在 GitHub 上创建 Pull Request
# 目标分支: dev
# 等待 CI 检查通过
# 请求团队成员审查

# 4. 审查通过后，合并 PR（通过 GitHub UI）

# 5. 删除功能分支（可选）
git branch -d feature/your-feature-name
git push origin --delete feature/your-feature-name
```

### 紧急修复流程

```bash
# 1. 创建 hotfix 分支
git checkout dev
git checkout -b hotfix/critical-bug-fix

# 2. 快速修复并提交
git commit -m "fix: critical bug description"
git push origin hotfix/critical-bug-fix

# 3. 创建 PR 并请求加急审查
# 可以设置 "urgent" 标签
```

### 版本升级流程

```bash
# 1. 获取新版本
git fetch upstream --tags

# 2. 创建版本追踪分支（由管理员执行）
git checkout -b upstream-1.12.0 1.12.0
git push origin upstream-1.12.0

# 3. 创建升级 PR
git checkout dev
git checkout -b upgrade/to-1.12.0
git rebase upstream-1.12.0

# 4. 解决冲突并推送
git push origin upgrade/to-1.12.0

# 5. 创建 PR: upgrade/to-1.12.0 → dev
# 进行充分的测试和审查
```

## 本地 Git Hooks（可选）

为了在本地强制执行一些规则，可以配置 Git hooks：

### Pre-commit Hook

创建 `.git/hooks/pre-commit`：

```bash
#!/bin/bash

# 检查当前分支
branch=$(git symbolic-ref --short HEAD)

# 禁止直接提交到受保护分支
if [[ "$branch" == "dev" ]] || [[ "$branch" == "main" ]] || [[ "$branch" == upstream-* ]]; then
    echo "❌ Error: Direct commits to '$branch' are not allowed."
    echo "Please create a feature branch:"
    echo "  git checkout -b feature/your-feature-name"
    exit 1
fi

# 运行代码检查（可选）
# make lint
# make type-check

exit 0
```

### Pre-push Hook

创建 `.git/hooks/pre-push`：

```bash
#!/bin/bash

# 禁止推送到受保护分支
while read local_ref local_sha remote_ref remote_sha
do
    if [[ "$remote_ref" == "refs/heads/dev" ]] ||
       [[ "$remote_ref" == "refs/heads/main" ]] ||
       [[ "$remote_ref" == refs/heads/upstream-* ]]; then
        echo "❌ Error: Direct push to '$remote_ref' is not allowed."
        echo "Please create a Pull Request instead."
        exit 1
    fi
done

exit 0
```

设置可执行权限：
```bash
chmod +x .git/hooks/pre-commit
chmod +x .git/hooks/pre-push
```

## PR 模板

创建 `.github/pull_request_template.md`：

```markdown
## 描述
<!-- 请简要描述本 PR 的目的和改动内容 -->

## 改动类型
- [ ] 新功能 (feat)
- [ ] Bug 修复 (fix)
- [ ] 重构 (refactor)
- [ ] 文档更新 (docs)
- [ ] 性能优化 (perf)
- [ ] 测试 (test)
- [ ] 构建/工具 (chore)

## 相关 Issue
<!-- 如果有，请链接相关的 Issue，例如: Closes #123 -->

## 测试
- [ ] Backend: `make lint` ✅
- [ ] Backend: `make type-check` ✅
- [ ] Backend: `uv run --project api --dev dev/pytest/pytest_unit_tests.sh` ✅
- [ ] Frontend: `pnpm lint:fix` ✅
- [ ] Frontend: `pnpm type-check:tsgo` ✅
- [ ] Frontend: `pnpm test` ✅
- [ ] 手动测试通过 ✅

## 截图（如适用）
<!-- 如果有 UI 改动，请提供截图 -->

## Checklist
- [ ] 代码遵循项目规范
- [ ] 已添加必要的测试
- [ ] 所有测试通过
- [ ] 文档已更新
- [ ] 提交信息符合规范
```

## 团队成员权限建议

### GitHub 仓库角色分配

- **Admin（管理员）**：1-2人
  - 可以修改仓库设置和分支保护规则
  - 可以合并任何 PR

- **Maintainer（维护者）**：2-3人
  - 可以合并 PR
  - 可以管理 Issues 和 Projects

- **Write（写入）**：所有开发者
  - 可以创建分支和 PR
  - 可以审查 PR
  - 不能直接推送到受保护分支

- **Read（只读）**：外部协作者
  - 可以查看代码和创建 Issues

## 故障排除

### 如果已经在 dev 分支上有本地提交

```bash
# 1. 创建功能分支保存这些提交
git checkout dev
git checkout -b feature/save-my-changes

# 2. 推送功能分支
git push origin feature/save-my-changes

# 3. 重置 dev 分支到远程状态
git checkout dev
git reset --hard origin/dev

# 4. 创建 PR: feature/save-my-changes → dev
```

### 如果需要临时绕过保护规则

1. 管理员可以在 Branch protection rules 中临时禁用规则
2. 执行必要的操作
3. 立即重新启用保护规则
4. ⚠️ 此操作应该记录并通知团队

## 参考资源

- [GitHub Branch Protection Rules](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)
- [Dify Project Conventions](../CLAUDE.md)
