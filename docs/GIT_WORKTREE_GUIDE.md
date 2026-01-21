# Git Worktree 使用指南

## 目录

- [什么是 Git Worktree](#什么是-git-worktree)
- [为什么使用 Worktree](#为什么使用-worktree)
- [基础使用](#基础使用)
- [团队协作场景](#团队协作场景)
- [最佳实践](#最佳实践)
- [常见问题](#常见问题)
- [快速参考](#快速参考)

## 什么是 Git Worktree

Git Worktree 允许你在**同一个仓库**中创建**多个工作目录**，每个目录对应不同的分支。

### 传统方式 vs Worktree

```bash
# 传统方式：单个工作目录
~/projects/dify/          # 只能在一个分支工作
git checkout feature-a    # 切换会改变所有文件
git checkout feature-b    # 需要 stash 或 commit

# Worktree 方式：多个工作目录
~/projects/dify/          # dev 分支
~/projects/dify-auth/     # feature/authentication 分支
~/projects/dify-search/   # feature/search 分支
~/projects/dify-review/   # 审查 PR 的临时分支
```

### 核心概念

```
主仓库 (Main Repository)
└── .git/               # Git 数据库（共享）
    └── worktrees/      # Worktree 元数据

工作树 (Worktrees)
├── dify/              # 主工作树
├── dify-auth/         # 链接工作树 → feature/authentication
├── dify-search/       # 链接工作树 → feature/search
└── dify-review/       # 链接工作树 → review 分支
```

**关键点：**
- 所有 worktree 共享同一个 `.git` 目录（节省空间）
- 每个 worktree 有独立的工作目录和索引
- 可以同时在不同 worktree 中工作

## 为什么使用 Worktree

### 主要优势

#### 1. 零成本多任务切换

```bash
# 场景：你正在开发新功能，突然需要紧急修复 bug

# 传统方式 ❌
git stash                    # 保存工作
git checkout dev
git checkout -b hotfix/bug
npm install                  # 可能需要重装依赖
npm run dev                  # 重启开发服务器
# 修复后...
git checkout feature-a
git stash pop
npm install                  # 又要处理依赖
npm run dev                  # 又要重启服务器

# Worktree 方式 ✅
cd ~/projects/dify-hotfix    # 切换目录即可
npm run dev                  # 已经配置好的环境
# 修复完成后
cd ~/projects/dify           # 回到原来的工作
# 开发服务器一直在运行！
```

#### 2. 并行运行多个环境

```bash
# Terminal 1: 前端开发
cd ~/projects/dify-feature-ui
npm run dev                  # 前端在 localhost:3000

# Terminal 2: API 开发
cd ~/projects/dify-feature-api
uv run --project api flask run  # 后端在 localhost:5000

# Terminal 3: 测试其他功能
cd ~/projects/dify-feature-test
make test

# Terminal 4: Review PR
cd ~/projects/dify-review
npm run dev                  # 在 localhost:3001 测试 PR
```

#### 3. 便捷的代码审查

```bash
# 快速审查 PR
git fetch origin
git worktree add ../dify-review-123 origin/pr/123

cd ../dify-review-123
npm install
npm run dev
# 测试功能、审查代码...

# 完成后删除
cd ..
git worktree remove dify-review-123
```

#### 4. 版本对比

```bash
# 对比不同版本
git worktree add ../dify-v1.11.4 upstream-1.11.4
git worktree add ../dify-dev dev

# 使用任何工具对比
diff ../dify-v1.11.4/api/core/auth.py \
     ../dify-dev/api/core/auth.py

# 或使用可视化工具
code --diff ../dify-v1.11.4/web/app \
           ../dify-dev/web/app
```

### 性能对比

| 操作 | 传统切换 | Worktree |
|-----|---------|----------|
| 切换分支 | 2-10 秒 | 即时（切换目录） |
| IDE 重新索引 | 1-5 分钟 | 无需（已索引） |
| 依赖重装 | 30-300 秒 | 无需（已安装） |
| 开发服务器重启 | 10-30 秒 | 无需（一直运行） |
| 上下文恢复 | 手动 | 自动（独立环境） |

## 基础使用

### 安装和配置

Git Worktree 是 Git 内置功能，无需额外安装（Git 2.5+）。

```bash
# 检查 Git 版本
git --version  # 确保 >= 2.5

# 查看当前 worktree
git worktree list
```

### 创建 Worktree

#### 基本语法

```bash
git worktree add <路径> <分支名>
```

#### 常用方式

```bash
# 1. 从现有分支创建
git worktree add ../dify-auth feature/authentication

# 2. 创建新分支
git worktree add -b feature/new-feature ../dify-new-feature

# 3. 从远程分支创建
git worktree add ../dify-pr origin/pull/123/head

# 4. 创建临时 worktree（detached HEAD）
git worktree add --detach ../dify-temp HEAD

# 5. 从 tag 创建
git worktree add ../dify-v1.11.4 1.11.4
```

#### Dify 项目示例

```bash
# 在主仓库目录
cd ~/projects/dify

# 创建功能开发 worktree
git worktree add ../dify-feature-auth -b feature/authentication

# 创建代码审查 worktree
git fetch origin
git worktree add ../dify-review-pr-123 origin/feature/some-feature

# 创建上游版本对比 worktree
git worktree add ../dify-upstream-1.11.4 upstream-1.11.4

# 创建紧急修复 worktree
git worktree add ../dify-hotfix -b hotfix/security-patch dev
```

### 使用 Worktree

```bash
# 进入 worktree 工作
cd ~/projects/dify-feature-auth

# 像正常仓库一样工作
git status
git add .
git commit -m "feat: add authentication"
git push origin feature/authentication

# 切换回主仓库
cd ~/projects/dify
```

### 管理 Worktree

```bash
# 列出所有 worktree
git worktree list

# 详细信息（包括分支、提交）
git worktree list --porcelain

# 删除 worktree
git worktree remove ../dify-feature-auth

# 强制删除（即使有未提交的更改）
git worktree remove --force ../dify-feature-auth

# 移动 worktree
git worktree move ../dify-old-path ../dify-new-path

# 清理已删除的 worktree 记录
git worktree prune
```

## 团队协作场景

### 场景 1: 开发中需要紧急修复

**问题：**正在开发新功能，突然收到紧急 bug 需要立即修复。

**解决方案：**

```bash
# 步骤 1: 创建 hotfix worktree
cd ~/projects/dify
git worktree add ../dify-hotfix -b hotfix/critical-security-bug dev

# 步骤 2: 在 hotfix worktree 中工作
cd ../dify-hotfix
npm install
npm run dev  # 在不同端口运行

# 步骤 3: 修复并提交
git add .
git commit -m "fix: resolve critical security vulnerability"
git push origin hotfix/critical-security-bug

# 步骤 4: 创建 PR
gh pr create --base dev --head hotfix/critical-security-bug

# 步骤 5: 回到原来的工作
cd ~/projects/dify
# 你的功能开发环境完全没有受影响！
npm run dev  # 开发服务器还在运行

# 步骤 6: hotfix 合并后，删除 worktree
git worktree remove ../dify-hotfix
```

### 场景 2: Code Review 和 PR 测试

**问题：**团队成员提交了 PR，你需要测试和审查。

**解决方案：**

```bash
# 步骤 1: 获取 PR 分支并创建 worktree
git fetch origin
git worktree add ../dify-review-pr-456 origin/feature/new-search

# 步骤 2: 设置并测试
cd ../dify-review-pr-456
npm install
uv sync --project api

# 步骤 3: 运行测试
make lint
make type-check
cd web && pnpm test

# 步骤 4: 启动服务手动测试
npm run dev

# 步骤 5: 在浏览器测试功能，同时审查代码
code .

# 步骤 6: 提交审查意见后删除
cd ~/projects/dify
git worktree remove ../dify-review-pr-456

# 💡 提示：可以创建一个常驻的 review worktree
git worktree add ../dify-review dev
# 每次 review 时：
cd ../dify-review
git pull origin <PR-branch>
```

### 场景 3: 并行开发多个功能

**问题：**需要同时开发多个独立的功能。

**解决方案：**

```bash
# 创建多个功能 worktree
git worktree add ../dify-feature-auth -b feature/authentication
git worktree add ../dify-feature-search -b feature/search-optimization
git worktree add ../dify-feature-ui -b feature/ui-redesign

# 在不同的 IDE 窗口中打开
code ~/projects/dify-feature-auth
code ~/projects/dify-feature-search
code ~/projects/dify-feature-ui

# 每个窗口独立工作：
# Window 1: 开发认证功能
cd ~/projects/dify-feature-auth
npm run dev  # 端口 3000

# Window 2: 开发搜索优化
cd ~/projects/dify-feature-search
npm run dev -- --port 3001

# Window 3: 开发 UI 重构
cd ~/projects/dify-feature-ui
npm run dev -- --port 3002

# 每个功能独立提交和推送
cd ~/projects/dify-feature-auth
git commit -m "feat: add JWT authentication"
git push origin feature/authentication

cd ~/projects/dify-feature-search
git commit -m "feat: optimize search with ElasticSearch"
git push origin feature/search-optimization
```

### 场景 4: 版本升级和迁移

**问题：**需要升级到新的 Dify 版本，需要对比和迁移代码。

**解决方案：**

```bash
# 步骤 1: 创建版本对比 worktree
git fetch upstream --tags
git worktree add ../dify-upstream-1.11.4 upstream-1.11.4
git worktree add ../dify-upstream-1.12.0 upstream-1.12.0
git worktree add ../dify-current dev

# 步骤 2: 对比版本差异
diff -r ../dify-upstream-1.11.4/api/core \
        ../dify-upstream-1.12.0/api/core

# 或使用可视化工具
meld ../dify-upstream-1.11.4 ../dify-upstream-1.12.0

# 步骤 3: 创建升级分支
git worktree add ../dify-upgrade -b upgrade/to-1.12.0 dev

# 步骤 4: 在升级分支中工作
cd ../dify-upgrade

# 步骤 5: 合并新版本
git merge upstream-1.12.0
# 或 rebase
git rebase upstream-1.12.0

# 步骤 6: 解决冲突时，可以参考其他 worktree
# 打开三个窗口对比：
code ../dify-current          # 当前代码
code ../dify-upstream-1.12.0  # 新版本
code ../dify-upgrade          # 升级分支

# 步骤 7: 完成后推送并创建 PR
git push origin upgrade/to-1.12.0

# 步骤 8: 清理临时 worktree
git worktree remove ../dify-upstream-1.11.4
git worktree remove ../dify-upstream-1.12.0
```

### 场景 5: 长期运行的测试环境

**问题：**需要一个稳定的测试环境，不受开发分支影响。

**解决方案：**

```bash
# 创建专门的测试 worktree
git worktree add ../dify-testing dev

cd ../dify-testing
npm install
uv sync --project api

# 配置测试环境变量
cp .env.example .env
# 编辑 .env 为测试配置

# 启动服务（保持长期运行）
npm run dev &
cd api && flask run &

# 在主开发目录继续工作
cd ~/projects/dify
git checkout -b feature/new-work
# 测试环境不受影响，一直运行

# 需要测试时，在测试 worktree 中拉取最新代码
cd ~/projects/dify-testing
git pull origin dev
npm install  # 如果有依赖更新
# 服务会自动重载
```

## 最佳实践

### 1. 目录命名规范

```bash
# 推荐的命名方式
~/projects/
├── dify/                    # 主仓库
├── dify-feature-<name>/     # 功能开发
├── dify-hotfix-<name>/      # 紧急修复
├── dify-review/             # 代码审查（常驻）
├── dify-testing/            # 测试环境（常驻）
├── dify-upstream-<ver>/     # 版本参考
└── dify-temp/               # 临时用途

# 示例
dify-feature-auth
dify-feature-search
dify-hotfix-security
dify-review-pr-123
dify-upstream-1.11.4
```

### 2. 使用辅助脚本

创建常用 worktree 的快捷脚本（见 `scripts/worktree-helpers.sh`）。

### 3. 环境变量管理

```bash
# 每个 worktree 可以有独立的 .env 文件
~/projects/dify/.env              # 开发环境
~/projects/dify-testing/.env      # 测试环境
~/projects/dify-review/.env       # Review 环境

# 使用不同的端口
# dify/.env
PORT=3000
API_PORT=5000

# dify-testing/.env
PORT=3001
API_PORT=5001

# dify-review/.env
PORT=3002
API_PORT=5002
```

### 4. IDE 配置

```bash
# VS Code: 为每个 worktree 保存独立的工作区设置
code --add ~/projects/dify           # 添加到工作区
code --add ~/projects/dify-testing   # 添加到工作区
code --add ~/projects/dify-review    # 添加到工作区

# 或为每个 worktree 打开独立窗口
code ~/projects/dify
code ~/projects/dify-testing
code ~/projects/dify-review
```

### 5. 依赖管理

```bash
# 前端：每个 worktree 独立的 node_modules
cd ~/projects/dify-feature-auth
npm install  # 独立安装

# 使用 pnpm 共享依赖（推荐）
cd ~/projects/dify-feature-auth
pnpm install  # pnpm 会使用全局缓存

# 后端：使用 uv 的虚拟环境
cd ~/projects/dify-feature-auth
uv sync --project api  # 独立环境
```

### 6. Git 操作注意事项

```bash
# ⚠️ 同一分支不能在多个 worktree 中
git worktree add ../dify-a feature-x
git worktree add ../dify-b feature-x  # ❌ 错误

# ✅ 正确做法：先创建新分支
git worktree add -b feature-x-review ../dify-review feature-x

# 在一个 worktree 中提交，其他 worktree 可见
cd ~/projects/dify-feature-auth
git commit -m "feat: add auth"

cd ~/projects/dify
git log  # 可以看到新提交

# fetch/pull 在任何 worktree 中都会影响所有 worktree
cd ~/projects/dify-feature-auth
git fetch origin  # 所有 worktree 都更新了远程引用
```

### 7. 清理策略

```bash
# 定期清理已合并的功能分支 worktree
git worktree list | grep "feature/" | while read path hash branch; do
    if git branch --merged dev | grep -q "$branch"; then
        echo "Removing merged worktree: $path"
        git worktree remove "$path"
    fi
done

# 自动清理脚本（见 scripts/worktree-cleanup.sh）
```

## 常见问题

### Q1: Worktree 占用多少磁盘空间？

```bash
# 检查空间使用
du -sh ~/projects/dify*

# 答案：
# .git 目录是共享的（约 200MB）
# 每个 worktree 的工作目录（约 500MB）
# node_modules（每个约 800MB - 最大占用）
# Python 虚拟环境（每个约 300MB）

# 建议：
# - 使用 pnpm 共享 node_modules（可节省 50-70%）
# - 及时删除不用的 worktree
# - 对于临时 review，用完就删
```

### Q2: 如何在 worktree 之间共享未提交的更改？

```bash
# 方法 1: 使用 stash
cd ~/projects/dify-feature-auth
git stash push -m "WIP: authentication work"

cd ~/projects/dify-feature-other
git stash pop  # 应用到这个 worktree

# 方法 2: 创建临时提交
cd ~/projects/dify-feature-auth
git add .
git commit -m "WIP: temp commit"

cd ~/projects/dify-feature-other
git cherry-pick <commit-hash>

# 方法 3: 创建 patch
cd ~/projects/dify-feature-auth
git diff > /tmp/my-changes.patch

cd ~/projects/dify-feature-other
git apply /tmp/my-changes.patch
```

### Q3: Worktree 中的分支被删除了怎么办？

```bash
# 如果远程分支被删除
cd ~/projects/dify-review-pr-123
git status
# 提示：Your branch is based on 'origin/feature/deleted', but the upstream is gone.

# 解决方案：删除这个 worktree
cd ~/projects/dify
git worktree remove ../dify-review-pr-123

# 如果需要保留工作，先创建新分支
cd ~/projects/dify-review-pr-123
git checkout -b save-my-work
git push origin save-my-work
```

### Q4: 如何在 worktree 中运行多个开发服务器？

```bash
# 方法 1: 使用不同端口
cd ~/projects/dify
npm run dev  # 默认 3000

cd ~/projects/dify-testing
npm run dev -- --port 3001

cd ~/projects/dify-review
PORT=3002 npm run dev

# 方法 2: 配置 .env 文件
# dify/.env
PORT=3000

# dify-testing/.env
PORT=3001

# dify-review/.env
PORT=3002

# 然后直接运行
npm run dev  # 会读取各自的 .env
```

### Q5: Worktree 影响 IDE 性能吗？

```bash
# 建议：
# 1. 不要在一个 IDE 窗口中打开多个 worktree
#    每个 worktree 打开独立的窗口

# 2. 配置 IDE 忽略其他 worktree
#    在 .gitignore 或 IDE 设置中忽略：
../dify-*/

# 3. VS Code 设置
# .vscode/settings.json
{
  "files.watcherExclude": {
    "../dify-*/**": true
  },
  "search.exclude": {
    "../dify-*/**": true
  }
}
```

### Q6: 如何备份 worktree？

```bash
# worktree 的 Git 数据在主仓库的 .git 中
# 只需备份主仓库即可

# 备份整个项目（包括所有 worktree）
tar -czf dify-backup.tar.gz ~/projects/dify*

# 恢复时
tar -xzf dify-backup.tar.gz -C ~/projects/

# Git 数据已经完整，worktree 会自动关联
```

### Q7: Worktree 会影响 CI/CD 吗？

```bash
# 不会。CI/CD 运行在独立的环境中，
# 使用标准的 git clone，不涉及 worktree。

# 本地的 worktree 配置不会推送到远程仓库。
```

## 快速参考

### 常用命令速查

```bash
# 创建
git worktree add <path> <branch>
git worktree add -b <new-branch> <path> <base-branch>

# 列出
git worktree list
git worktree list --porcelain

# 删除
git worktree remove <path>
git worktree remove --force <path>

# 移动
git worktree move <old-path> <new-path>

# 清理
git worktree prune
```

### Dify 项目快速操作

```bash
# 创建功能开发 worktree
git worktree add ../dify-feature-<name> -b feature/<name>

# 创建 PR review worktree
git fetch origin pull/<PR-number>/head:<branch-name>
git worktree add ../dify-review-<PR-number> <branch-name>

# 创建版本对比 worktree
git worktree add ../dify-upstream-<version> upstream-<version>

# 创建 hotfix worktree
git worktree add ../dify-hotfix-<name> -b hotfix/<name> dev

# 删除所有已合并的功能 worktree
for wt in $(git worktree list --porcelain | grep "worktree" | awk '{print $2}'); do
    branch=$(git -C "$wt" branch --show-current)
    if git branch --merged dev | grep -q "$branch"; then
        git worktree remove "$wt"
    fi
done
```

### 辅助脚本

使用 `scripts/worktree-helpers.sh` 中的脚本：

```bash
# 创建常用 worktree
./scripts/worktree-helpers.sh setup

# 列出所有 worktree（格式化显示）
./scripts/worktree-helpers.sh list

# 清理已合并的 worktree
./scripts/worktree-helpers.sh clean

# 创建 review worktree
./scripts/worktree-helpers.sh review <PR-number>
```

## 进阶技巧

### 1. 与 tmux/screen 结合

```bash
# 为每个 worktree 创建 tmux 会话
tmux new -s dify-main -c ~/projects/dify
tmux new -s dify-auth -c ~/projects/dify-feature-auth
tmux new -s dify-review -c ~/projects/dify-review

# 在各个会话中运行开发服务器
tmux send-keys -t dify-main "npm run dev" Enter
tmux send-keys -t dify-auth "npm run dev -- --port 3001" Enter
tmux send-keys -t dify-review "npm run dev -- --port 3002" Enter

# 快速切换
tmux attach -t dify-main
tmux attach -t dify-auth
```

### 2. 自动化工作流

```bash
# 创建自动化脚本
cat > ~/projects/start-dify-dev.sh << 'EOF'
#!/bin/bash

# 启动主开发环境
cd ~/projects/dify
tmux new-session -d -s dify-main
tmux send-keys -t dify-main "npm run dev" Enter

# 启动测试环境
cd ~/projects/dify-testing
tmux new-session -d -s dify-test
tmux send-keys -t dify-test "npm run dev -- --port 3001" Enter

# 启动 API
cd ~/projects/dify/api
tmux new-session -d -s dify-api
tmux send-keys -t dify-api "uv run flask run" Enter

echo "Dev environments started!"
tmux ls
EOF

chmod +x ~/projects/start-dify-dev.sh
```

### 3. Git 别名

```bash
# 添加到 ~/.gitconfig
[alias]
    wt = worktree
    wtl = worktree list
    wta = worktree add
    wtr = worktree remove
    wtp = worktree prune

    # 创建功能 worktree
    wtf = "!f() { git worktree add ../dify-feature-$1 -b feature/$1; }; f"

    # 创建 hotfix worktree
    wth = "!f() { git worktree add ../dify-hotfix-$1 -b hotfix/$1 dev; }; f"

    # 创建 review worktree
    wtr = "!f() { git fetch origin pull/$1/head:pr-$1 && git worktree add ../dify-review-$1 pr-$1; }; f"

# 使用
git wtf authentication         # 创建 feature/authentication
git wth security-patch        # 创建 hotfix/security-patch
git wtr 123                   # Review PR #123
```

## 总结

### 何时使用 Worktree

✅ **推荐使用：**
- 频繁切换分支
- 同时开发多个功能
- Code Review 和测试 PR
- 运行长期服务（开发服务器、测试环境）
- 版本对比和迁移
- 紧急修复不想中断当前工作

❌ **不推荐使用：**
- 磁盘空间严重不足
- 只在单一分支工作
- 项目非常小（依赖安装很快）
- 不熟悉 Git（增加学习成本）

### 关键要点

1. **Worktree 是工具，不是必需品** - 根据实际需求选择使用
2. **及时清理** - 不用的 worktree 要删除，节省空间
3. **规范命名** - 使用清晰的目录命名规范
4. **独立环境** - 每个 worktree 有独立的依赖和配置
5. **共享 Git 数据** - 所有 worktree 共享 .git，节省空间
6. **适合团队** - 特别适合需要频繁 code review 的团队

## 相关资源

- [Git Worktree 官方文档](https://git-scm.com/docs/git-worktree)
- [团队工作流文档](./TEAM_WORKFLOW.md)
- [辅助脚本](../scripts/worktree-helpers.sh)
- [快速开始指南](./QUICK_START.md)

---

**提示：**阅读完本指南后，运行 `./scripts/worktree-helpers.sh` 查看可用的辅助功能。
