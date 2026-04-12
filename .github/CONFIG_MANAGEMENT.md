# 配置文件管理策略

## 📋 配置文件清单

### ✅ 应该提交到 GitHub

```
.env.example
.env.staging.example
.env.production.example
docker-compose.yml
docker-compose.dev.yml
docker-compose.middleware.yaml
.gitignore
.github/
k8s/
scripts/
```

### ❌ 不应该提交（添加到 .gitignore）

```
.env
.env.local
.env.*.local
.env.production
docker-compose.override.yml
docker-compose.local.yml
secrets/
credentials.json
api-keys.json
```

---

## 📝 人工设置步骤

### 首次克隆后

```bash
cd /Users/chao/Dify

# 1. 复制模板文件
cp .env.example .env.local
cp docker/docker-compose.yml .  # 如需要

# 2. 编辑本地配置
vi .env.local
# 添加真实的 API 密钥和数据库密码

# 3. 验证配置
grep -E "OPENAI_API_KEY|DATABASE_PASSWORD" .env.local
# 确保包含真实值

# 4. 验证 .gitignore
git check-ignore -v .env.local
# 应该有输出，说明已忽略 ✓

git status
# 不应该显示 .env.local
```

### 推送前检查

```bash
# 检查是否有敏感信息要提交
git diff --cached | grep -E "password|key|secret|token"
# 如果有输出，❌ 不要 commit

# 检查文件大小（避免大文件）
git ls-files -s | sort -k4 -n -r | head -20
# 应该都 < 1MB

# 检查所有暂存文件
git diff --cached --name-only
# 不应该包含 .env, .local, credentials 等文件
```

---

## 🔒 敏感信息安全清单

### 检查 Commit 历史

```bash
# 查找是否曾意外提交过敏感信息
git log -S "password" --all --oneline
git log -S "OPENAI_API_KEY" --all --oneline

# 如果发现问题，使用 git filter 清理历史
# 参考: https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository
```

### 部署前验证

```bash
# Staging 部署
export ENV_FILE=".env.staging"
# 检查必需的变量
grep "OPENAI_API_KEY" "$ENV_FILE" || echo "❌ Missing OPENAI_API_KEY"
grep "DATABASE_URL" "$ENV_FILE" || echo "❌ Missing DATABASE_URL"

# Production 部署
export ENV_FILE=".env.production"
# 检查必需的变量
grep "OPENAI_API_KEY" "$ENV_FILE" || echo "❌ Missing OPENAI_API_KEY"
grep "DATABASE_URL" "$ENV_FILE" || echo "❌ Missing DATABASE_URL"
grep "REDIS_URL" "$ENV_FILE" || echo "❌ Missing REDIS_URL"
```

---

## 🔄 配置同步策略

### 本地开发配置

```bash
# 使用 docker-compose.override.yml
# 位置: /Users/chao/Dify/docker-compose.override.yml
# 状态: .gitignore（不提交）

# 本地变量
# 位置: /Users/chao/Dify/.env.local
# 状态: .gitignore（不提交）

特点:
- 覆盖官方设置
- 不影响其他开发者
- 推送 GitHub Actions 时不使用
```

### Staging 配置

```bash
# 模板文件
# 位置: /Users/chao/Dify/.env.staging
# 状态: .gitignore（不提交）源代码

# GitHub Secrets
# 在 Repository Settings 中配置
# 自动注入到 GitHub Actions
```

### Production 配置

```bash
# 模板文件
# 位置: /Users/chao/Dify/.env.production
# 状态: .gitignore（不提交）
# 来源: .env.production.example（模板）

# 部署脚本自动使用
# 参考: scripts/deploy.sh
```

---

## 📊 配置流向图

```
官方仓库模板
.env.example
    ↓ fork
你的 Fork
.env.example
    ↓ clone
本地仓库
├─ .env.example（提交 ✓）
│   ↓ copy
├─ .env.local（不提交 ✗）
│   ├─ OPENAI_API_KEY=sk-xxx
│   ├─ DATABASE_PASSWORD=real-password
│   └─ DEBUG=true
│
├─ .env.staging（不提交 ✗）
│   ├─ 来自: .env.staging.example
│   └─ 用于部署脚本
│
└─ .env.production（不提交 ✗）
    ├─ 来自: .env.production.example
    └─ 用于 GitHub Actions

结果：
✓ 模板文件在 GitHub
✓ 真实配置在本地
✓ 敏感信息安全存储
✓ 便于团队协作
```

---

## 🛡️ 防止事故的 Git Hooks

### 安装防护 Hook

```bash
# 创建 pre-commit hook
cat > .git/hooks/pre-commit << 'EOF'
#!/bin/bash

# 检查敏感文件
SENSITIVE_FILES=(
    ".env"
    "credentials.json"
    "private_key.pem"
    "secrets/"
)

for file in "${SENSITIVE_FILES[@]}"; do
    if git diff --cached --name-only | grep -E "$file"; then
        echo "❌ ERROR: Attempting to commit sensitive file: $file"
        echo "✅ Add to .gitignore instead"
        exit 1
    fi
done

# 检查敏感内容
if git diff --cached | grep -E "password.*=|api.*key.*=|secret.*="; then
    echo "❌ WARNING: Potential sensitive content detected"
    read -p "Continue anyway? (not recommended) [y/N] " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

exit 0
EOF

chmod +x .git/hooks/pre-commit

# 安装完成
echo "✓ Pre-commit hook installed"
```

### 验证 Hook

```bash
# 尝试提交 .env 文件
git add .env
git commit -m "test"
# 应该被 hook 阻止 ✓
```

---

## 🚨 如果意外提交了敏感信息

### 快速恢复

```bash
# 步骤 1: 立即撤销提交（未推送）
git reset --soft HEAD~1
git reset HEAD .env  # 从缓存区移除

# 步骤 2: 编辑 .gitignore
echo ".env" >> .gitignore

# 步骤 3: 重新提交
git add .gitignore
git commit -m "chore: ignore .env file"

# 如果已推送到 GitHub
# 步骤 1: 通知 GitHub
# Settings → Secret scanning → Dismiss alerts

# 步骤 2: 重新生成密钥
# 更改 API 密钥、数据库密码等

# 步骤 3: 清理历史
git filter-branch --tree-filter 'rm -f .env' -- --all
git push --force
```

### 官方文档参考

https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository

---

## 📋 检查清单

部署前：

- [ ] .env.local 存在且配置正确
- [ ] .env.local 在 .gitignore 中
- [ ] docker-compose.override.yml 在 .gitignore 中
- [ ] git status 不显示敏感文件
- [ ] git diff --cached 无敏感信息

推送后：

- [ ] 检查 GitHub 不显示敏感文件
- [ ] GitHub Secret scanning 无警告
- [ ] 部署脚本能成功读取 .env 文件

生产前：

- [ ] 所有 .env.* 文件都是私有的
- [ ] 敏感信息只在 GitHub Secrets 中
- [ ] 部署脚本正确处理环境变量
- [ ] 日志不输出敏感信息
