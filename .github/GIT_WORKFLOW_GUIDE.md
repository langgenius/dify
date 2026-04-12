# 🔀 Fork 和本地配置管理指南

## 📊 当前 Git 结构

```
GitHub 官方
(langgenius/dify)
    ↓ fork
你的 GitHub
(lczc1988/dify)
    ↓ clone
本地仓库
/Users/chao/Dify
```

---

## ⚠️ 核心问题解答

### Q1: 本地代码 push 到 GitHub 会覆盖 fork 的代码吗？

**答：不会！原因如下**

```
你的 Fork（origin）
├─ 完全独立的仓库
├─ 在你的 GitHub 账户下
├─ 与官方仓库完全隔离
└─ Push 只影响你自己的 fork

官方仓库（upstream）
├─ langgenius/dify
├─ 不受你的 push 影响
└─ 只有官方维护者可以修改

你的 push:
git push origin develop
    ↓ 只推送到
    lczc1988/dify（你的 fork）
    ↓ 不影响
    langgenius/dify（官方）
```

**举例：**
```bash
# 本地修改源代码
vi api/models.py
git add .
git commit -m "feat: my change"

# Push 到你的 fork
git push origin develop
    ↓ 只更新到 lczc1988/dify
    ↓ 官方 langgenius/dify 毫不受影响 ✓

# GitHub 会显示
lczc1988/dify: 领先官方 1 commit
```

---

### Q2: 如何保证本地的配置和 Dify 的更新同时存在？

**答：使用正确的 Git 工作流**

```
官方更新                  你的本地配置
（upstream）          （本地 + fork）
    ↓                       ↓
git fetch upstream    （自动挂载 Volume）
    ↓                       ↓
git merge upstream/develop
    ↓                       ↓
整合官方代码          保留本地配置 ✓
```

---

## 🗂️ Git 结构详解

### 三个 Remote 关系

```
$ git remote -v

origin   → https://github.com/lczc1988/dify.git
           你的 Fork（推送目标）

upstream → https://github.com/langgenius/dify.git
           官方仓库（拉取源）

local    → /Users/chao/Dify
           本地工作目录
```

### 分支关系

```
本地分支                关联的远程分支
develop ──→ origin/develop （你的 fork）
            upstream/develop （官方）

main ───→ origin/main
          upstream/main
```

---

## 🔄 完整工作流程（推荐）

### 1️⃣ 初始设置（已完成 ✓）

```bash
# 已有
git remote -v
# origin    https://github.com/lczc1988/dify.git (fetch/push)
# upstream  https://github.com/langgenius/dify.git (fetch/push)
```

### 2️⃣ 日常开发流程

#### 开始新功能

```bash
# 步骤 1: 同步官方最新代码
git fetch upstream                # 从官方拉取
git checkout develop              # 切换到 develop 分支
git merge upstream/develop        # 整合官方代码

# 步骤 2: 创建功能分支
git checkout -b feature/my-feature

# 步骤 3: 在功能分支上开发
vi api/core/models.py
docker-compose up -d              # 本地测试（自动挂载）
# ... 修改代码，测试功能 ...

# 步骤 4: 提交代码
git add .
git commit -m "feat: add new feature"

# 步骤 5: 推送到你的 fork
git push origin feature/my-feature

# 步骤 6: 创建 Pull Request（可选）
# GitHub → 你的 fork → Create Pull Request
#         compare: upstream/develop ... origin/feature/my-feature
```

#### 本地配置文件（不推送）

```bash
# 这些文件应该在 .gitignore 中
.env.local              # 本地环境变量
.env.staging            # Staging 配置
.env.production         # 生产配置
docker-compose.override.yml # 本地开发覆盖配置
.vscode/settings.json   # IDE 本地配置
```

**验证 .gitignore：**
```bash
git check-ignore -v .env.local
# 如果有输出，说明已忽略 ✓

# 查看已忽略的文件
git status --ignored
```

### 3️⃣ 同步官方更新

#### 场景：官方发布了新版本

```
官方发布 v1.14.0
    ↓
你想合并到本地
    ↓
保留你的修改
    ↓
整合新的功能
```

**操作步骤：**

```bash
# 步骤 1: 获取官方最新
git fetch upstream
git fetch origin

# 步骤 2: 检查差异
git log --oneline origin/develop..upstream/develop
# 显示官方领先的 commits

# 步骤 3: 整合官方代码
git checkout develop
git merge upstream/develop

# 步骤 4: 解决冲突（如有）
# 编辑冲突文件
git add .
git commit -m "merge: sync with upstream/develop"

# 步骤 5: 推送到自己的 fork
git push origin develop

# 现在你的 fork 既包含
# ✓ 官方最新代码
# ✓ 你的本地修改
```

---

## 📋 分支管理策略

### 推荐分支结构

```
main
├─ 生产发布分支
├─ 来自 upstream/main
└─ 不直接修改

develop
├─ 开发主分支
├─ 整合所有开发分支
└─ 同步 upstream/develop

feature/*
├─ 功能开发分支
├─ 从 develop 创建
└─ 完成后删除

fix/*
├─ Bug 修复分支
├─ 从 develop 创建
└─ 完成后删除

hotfix/*
├─ 紧急修复
├─ 从 main 创建
└─ 修复后合并回 main/develop

local/*
├─ 本地配置分支
├─ 长期存在
├─ 不推送到 GitHub
└─ 用于本地开发环境
```

### 创建本地配置分支

```bash
# 创建本地配置分支
git checkout -b local/dev-config

# 在这个分支上进行本地配置
vi docker-compose.override.yml
vi .env.local
git add .
git commit -m "chore: local development configuration"

# 切换回 develop 时，配置不会丢失
git checkout develop
# ... 进行开发 ...

# 需要本地配置时切换回来
git checkout local/dev-config
```

---

## 🔐 保护本地配置的方法

### 方法 1️⃣: 使用 .gitignore

```bash
# .gitignore（已提交到 GitHub）
.env.local
.env.*.local
docker-compose.override.yml
.vscode/
.idea/
*.local.*
```

**验证：**
```bash
# 检查文件是否被忽略
git check-ignore -v .env.local
# 有输出 = 已忽略 ✓

# Add 命令会自动忽略
git add .  # 不会添加 .env.local
```

### 方法 2️⃣: 使用模板文件

```bash
# 提交模板文件到 GitHub
.env.example      ← 模板（不含真实密钥）
.env.staging.example
.env.production.example

# 本地创建实际配置（不提交）
.env.local        ← 真实密钥（.gitignore）
.env.staging      ← 真实密钥（.gitignore）
.env.production   ← 真实密钥（.gitignore）
```

**使用：**
```bash
# 首次设置
cp .env.example .env.local
# 编辑 .env.local 添加真实密钥
vi .env.local
```

### 方法 3️⃣: Git Hooks 防护

```bash
# 创建 pre-commit hook 防止提交敏感文件
cat > .git/hooks/pre-commit << 'EOF'
#!/bin/bash

# 检查是否想要提交敏感文件
if git diff --cached --name-only | grep -E '\.env|secrets|credentials'; then
    echo "❌ ERROR: Attempting to commit sensitive files!"
    echo "❌ 不允许提交: .env, secrets, credentials 等敏感文件"
    echo "✅ 这些文件应该在 .gitignore 中"
    exit 1
fi
EOF

chmod +x .git/hooks/pre-commit
```

---

## 📈 场景演练

### 场景 1️⃣: 本地开发 + 官方更新

```
Day 1: 你开始功能开发
git checkout -b feature/new-api
vi api/core/models.py
git commit -m "feat: new API"

Day 3: 官方发布新版本（upstream/develop 更新）
git fetch upstream
git merge upstream/develop  # 合并官方代码

现在 feature/new-api 包含：
✓ 你的新 API 代码
✓ 官方最新功能
✓ 本地配置（自动挂载）保持不变
```

### 场景 2️⃣: 多个本地修改 + 官方更新

```
你有两个分支：
- feature/auth-system （3 commits，已完成）
- feature/database-optimization （进行中）

官方有新更新

操作：
1. git fetch upstream
2. git checkout develop
3. git merge upstream/develop  # 同步官方
4. git rebase develop feature/auth-system  # 更新分支 1
5. git rebase develop feature/database-optimization # 更新分支 2

现在两个分支都：
✓ 包含最新功能
✓ 保留你的修改
✓ 可随时推送到 origin
```

### 场景 3️⃣: 解决合并冲突

```
git pull upstream develop
# 冲突发生！

# 查看冲突
git status

# 编辑冲突文件
vi api/core/models.py
# 手动选择保留哪些代码

# 解决完成
git add .
git commit -m "resolve: merge conflicts with upstream"
git push origin develop
```

---

## 🛠️ 常用 Git 命令速查

### 同步官方代码

```bash
# 拉取官方最新
git fetch upstream

# 查看官方的新 commits
git log -3 upstream/develop

# 合并官方代码
git merge upstream/develop

# 推送到自己的 fork
git push origin develop
```

### 分支管理

```bash
# 列出所有分支
git branch -a

# 创建功能分支
git checkout -b feature/my-feature

# 删除本地分支
git branch -d feature/my-feature

# 删除远程分支
git push origin --delete feature/my-feature

# 追踪远程分支
git checkout --track origin/feature/my-feature
```

### 查看差异

```bash
# 对比本地 vs 官方
git diff origin/develop..upstream/develop

# 查看官方领先的 commits
git log origin/develop..upstream/develop --oneline

# 查看本地领先的 commits
git log upstream/develop..origin/develop --oneline
```

### 清理和维护

```bash
# 删除已合并的分支
git branch -d feature/completed-feature

# 清理本地跟踪信息
git remote prune origin
git remote prune upstream

# 查看所有未推送的 commits
git log origin/develop..develop --oneline
```

---

## 📊 我的工作流推荐

### 日常流程

```bash
# 早上：同步官方
git fetch upstream
git checkout develop
git merge upstream/develop --ff-only  # 快进合并

# 中午：继续开发
git checkout feature/my-feature
# 编写代码 ...

# 下午：提交代码
git commit -m "feat: progress"
git push origin feature/my-feature

# 晚上：准备合并
# 创建 Pull Request 或者
git checkout develop
git merge feature/my-feature
# 提交本地配置保存在 local/dev-config 分支
```

### 周末：大清理

```bash
# 拉取官方最新
git fetch upstream
git pull upstream develop

# 整理本地分支
git branch -d feature/completed-1
git branch -d fix/completed-2

# 打标签标记稳定版本
git tag -a v1.0.0-local -m "Stable local version"
git push origin v1.0.0-local

# 检查配置备份
git checkout local/dev-config
git status  # 确保配置安全
```

---

## 🚀 最佳实践

### ✅ 必做

```bash
# 1. 定期同步官方
git fetch upstream  # 至少每周一次

# 2. 分离配置文件
.env.local          # 本地配置（.gitignore）
.env.example        # 模板文件（提交）

# 3. 使用功能分支
git checkout -b feature/名称  # 不直接在 develop 修改

# 4. 明确 commit message
git commit -m "feat: 描述"
git commit -m "fix: 描述"
git commit -m "chore: 描述"

# 5. 推送到 origin
git push origin feature/名称  # 不直接推送到 upstream
```

### ❌ 避免

```bash
# 1. 不要直接修改 develop
git checkout develop
git add .
# ❌ 不要这样做

# 2. 不要提交敏感信息
git add .env  # ❌ 包含 API 密钥
git add credentials.json  # ❌ 包含密钥

# 3. 不要 Force Push（除非很确定）
git push --force origin develop  # ⚠️ 危险！

# 4. 不要忘记同步官方
# 很久不做 git fetch upstream  # ❌ 容易冲突

# 5. 不要混淆 origin/upstream
git push upstream feature/my-feature  # ❌ 无权限
# 应该
git push origin feature/my-feature    # ✓ 推送到自己的 fork
```

---

## 📈 配置管理最佳实践

### 推荐项目结构

```
/Users/chao/Dify/
├─ .env.example               ✓ 提交
├─ .env.staging.example       ✓ 提交
├─ .env.production.example    ✓ 提交
├─ .env.local                 ✗ .gitignore
├─ .env.staging               ✗ .gitignore
├─ docker-compose.yml         ✓ 提交（官方）
├─ docker-compose.override.yml ✗ .gitignore（本地开发）
├─ docker-compose.dev.yml     ✓ 提交（示例）
└─ .gitignore
   ├─ .env.local
   ├─ .env.*.local
   ├─ docker-compose.override.yml
   └─ 其他敏感文件
```

### 环境变量管理

```bash
# 模板文件（提交到 GitHub）
.env.example
OPENAI_API_KEY=sk-xxxx-example-only
DATABASE_URL=postgresql://localhost/dify
REDIS_URL=redis://localhost:6379

# 本地文件（不提交）
.env.local
OPENAI_API_KEY=sk-real-key-xxxx
DATABASE_URL=postgresql://localhost/dify
REDIS_URL=redis://localhost:6379

# 使用
python app.py  # 自动读取 .env 或 .env.local
```

---

## 🔄 同步流程图

```
官方仓库 (upstream)
     ↓ git fetch
本地追踪 (upstream/develop)
     ↓ git merge
本地分支 (develop)
     ↓ 添加功能
功能分支 (feature/xxx)
     ↓ git push
你的 fork (origin)
     ↓ 创建 PR
官方仓库 (Pull Request)
     ↓ 合并
官方仓库 (upstream/develop 更新)
     ↓ ...循环
```

---

## 📋 检查清单

初始设置：

- [ ] Fork 已创建
- [ ] Origin 指向你的 fork
- [ ] Upstream 指向官方
- [ ] .gitignore 包含本地配置

日常开发：

- [ ] 定期 `git fetch upstream`
- [ ] 功能开发在分支上
- [ ] 提交前检查敏感信息
- [ ] 推送到 origin（不是 upstream）
- [ ] 保存本地配置在 local/ 分支

长期维护：

- [ ] 每周同步官方代码
- [ ] 定期删除已完成分支
- [ ] 保留本地配置备份
- [ ] 记录关键 commits 和 tags

---

## 📞 常见问题

### Q: 我不小心 push 到 upstream 怎么办？

```bash
# 你没有权限，不会成功 ✓
git push upstream feature/my-feature
# fatal: Permission denied

# 如果somehow成功了，联系官方维护者
```

### Q: 我想把本地修改提交为 PR 到官方怎么办？

```bash
# 1. 确保本地 develop 最新
git fetch upstream
git merge upstream/develop

# 2. 创建 PR 分支
git checkout -b feature/upstream-contribution

# 3. 修改代码提交
git add .
git commit -m "feat: contribution to official"

# 4. 推送到自己的 fork
git push origin feature/upstream-contribution

# 5. 创建 PR
# GitHub 界面：
# Base: langgenius/dify/develop
# Compare: lczc1988/dify/feature/upstream-contribution
```

### Q: 官方仓库太大，如何加速克隆？

```bash
# 浅克隆（只获取最新历史）
git clone --depth 1 https://github.com/langgenius/dify.git

# 添加 upstream 之后加深历史
git fetch --unshallow upstream
```

### Q: 如何清理本地已过期的分支追踪？

```bash
# 显示已删除的远程分支
git branch -vv | grep "gone"

# 删除本地追踪
git branch -D feature/old-feature
# 或批量删除
git fetch -p  # --prune：删除不存在的追踪
```

---

## 🎯 总结

```
你的 Fork 结构
├─ ✓ 完全独立
├─ ✓ Push 不影响官方
├─ ✓ 可随时同步官方代码
└─ ✓ 本地配置安全隔离

工作流
├─ 1. 同步官方: git fetch upstream
├─ 2. 创建分支: git checkout -b feature/xxx
├─ 3. 开发代码: 修改文件，测试
├─ 4. 提交代码: git commit & push origin
└─ 5. 保存配置: 在 local/ 分支或 .gitignore

你完全掌控：
✓ 代码修改
✓ 本地配置
✓ 更新时机
✓ 何时合并
```
