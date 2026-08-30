#!/bin/bash
set -e

echo "🔄 开始同步官方Dify更新..."

# 保存当前分支
CURRENT_BRANCH=$(git branch --show-current)
echo "📍 当前分支: $CURRENT_BRANCH"

# 切换到main分支
echo "📍 切换到main分支"
git checkout main

# 拉取官方更新
echo "⬇️  拉取官方更新..."
git fetch upstream

# 显示即将合并的更新
echo ""
echo "📋 即将合并的更新："
git log HEAD..upstream/main --oneline --graph --max-count=10

# 询问是否继续
echo ""
read -p "是否继续合并？(y/n) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]
then
    echo "❌ 取消同步"
    git checkout $CURRENT_BRANCH
    exit 1
fi

# 合并官方更新
echo "🔀 合并官方更新到main..."
git merge upstream/main

# 推送到远程
echo "⬆️  推送到远程main..."
git push origin main

# 合并到develop分支
echo "🔀 合并到develop分支..."
git checkout develop
git merge main

echo ""
echo "✅ 同步完成！"
echo "💡 请检查是否有冲突需要解决"
echo "💡 如需推送develop分支: git push origin develop"

# 返回原分支
if [ "$CURRENT_BRANCH" != "develop" ] && [ "$CURRENT_BRANCH" != "main" ]; then
    git checkout $CURRENT_BRANCH
fi
