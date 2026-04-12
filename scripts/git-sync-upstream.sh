#!/bin/bash
# scripts/git-sync-upstream.sh
# 与官方仓库同步的一键脚本

set -e

echo "🔄 Syncing with upstream (official Dify repository)..."
echo ""

# 1. 检查是否在 git 仓库
if ! git rev-parse --git-dir > /dev/null 2>&1; then
    echo "❌ Not in a git repository"
    exit 1
fi

# 2. 检查 upstream 是否配置
if ! git remote get-url upstream > /dev/null 2>&1; then
    echo "⚠️  Upstream not configured"
    echo "Setting up upstream..."
    git remote add upstream https://github.com/langgenius/dify.git
    echo "✓ Upstream configured"
fi

# 3. 获取所有分支信息
echo "📥 Fetching from remotes..."
git fetch upstream
git fetch origin

# 4. 显示差异
echo ""
echo "📊 Comparing branches..."
echo ""

# 官方领先的 commits
AHEAD=$(git rev-list origin/develop..upstream/develop --count 2>/dev/null || echo "0")
if [ "$AHEAD" -gt 0 ]; then
    echo "⬇️  Official is ahead by $AHEAD commits:"
    git log -5 origin/develop..upstream/develop --oneline
fi

# 本地领先的 commits
BEHIND=$(git rev-list upstream/develop..origin/develop --count 2>/dev/null || echo "0")
if [ "$BEHIND" -gt 0 ]; then
    echo ""
    echo "⬆️  Your fork is ahead by $BEHIND commits:"
    git log -5 upstream/develop..origin/develop --oneline
fi

# 5. 询问是否合并
if [ "$AHEAD" -gt 0 ]; then
    echo ""
    read -p "❓ Merge official changes into local develop? (y/n) " -n 1 -r
    echo ""
    
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        echo "🔀 Merging upstream/develop..."
        
        # 确保在 develop 分支
        git checkout develop
        
        # 合并
        git merge upstream/develop --ff-only 2>/dev/null || {
            echo "⚠️  Cannot fast-forward. Using regular merge..."
            git merge upstream/develop -m "merge: sync with upstream/develop"
        }
        
        # 推送到自己的 fork
        echo "📤 Pushing to origin..."
        git push origin develop
        
        echo "✅ Sync completed!"
    else
        echo "❌ Merge cancelled"
    fi
else
    echo "✅ Already up to date!"
fi

# 6. 显示提示
echo ""
echo "💡 Next steps:"
echo "  - git checkout -b feature/my-feature"
echo "  - Make changes..."
echo "  - git commit -m 'feat: description'"
echo "  - git push origin feature/my-feature"
