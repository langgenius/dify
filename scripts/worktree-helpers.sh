#!/bin/bash

# Git Worktree 辅助脚本
# 提供常用的 worktree 操作快捷方式

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 获取仓库根目录
REPO_ROOT=$(git rev-parse --show-toplevel)
REPO_NAME=$(basename "$REPO_ROOT")
PARENT_DIR=$(dirname "$REPO_ROOT")

# 打印带颜色的消息
info() { echo -e "${BLUE}ℹ${NC} $1"; }
success() { echo -e "${GREEN}✓${NC} $1"; }
warning() { echo -e "${YELLOW}⚠${NC} $1"; }
error() { echo -e "${RED}✗${NC} $1"; }

# 显示帮助信息
show_help() {
    cat << EOF
Git Worktree 辅助脚本

用法:
    $(basename $0) <command> [arguments]

命令:
    setup               创建常用的 worktree（review、testing）
    list                列出所有 worktree（格式化显示）
    clean               清理已合并到 dev 的 worktree
    remove <name>       删除指定的 worktree

    feature <name>      创建功能开发 worktree
    hotfix <name>       创建紧急修复 worktree
    review <pr-num>     创建 PR review worktree

    status              显示所有 worktree 的状态
    open <name>         在 VS Code 中打开指定 worktree

    help                显示此帮助信息

示例:
    $(basename $0) setup
    $(basename $0) feature authentication
    $(basename $0) hotfix security-patch
    $(basename $0) review 123
    $(basename $0) list
    $(basename $0) clean

详细文档: docs/GIT_WORKTREE_GUIDE.md
EOF
}

# 创建常用 worktree
setup_worktrees() {
    info "设置常用 worktree..."
    echo ""

    # 创建 review worktree
    if [ ! -d "$PARENT_DIR/${REPO_NAME}-review" ]; then
        info "创建 code review worktree..."
        git worktree add "$PARENT_DIR/${REPO_NAME}-review" dev
        success "已创建: ${REPO_NAME}-review (dev 分支)"
    else
        warning "已存在: ${REPO_NAME}-review"
    fi

    # 创建 testing worktree
    if [ ! -d "$PARENT_DIR/${REPO_NAME}-testing" ]; then
        info "创建测试环境 worktree..."
        git worktree add "$PARENT_DIR/${REPO_NAME}-testing" dev
        success "已创建: ${REPO_NAME}-testing (dev 分支)"
    else
        warning "已存在: ${REPO_NAME}-testing"
    fi

    echo ""
    success "设置完成！"
    echo ""
    info "建议下一步操作："
    echo "  cd $PARENT_DIR/${REPO_NAME}-review && npm install"
    echo "  cd $PARENT_DIR/${REPO_NAME}-testing && npm install"
    echo ""
    info "查看所有 worktree: $(basename $0) list"
}

# 列出所有 worktree（格式化）
list_worktrees() {
    info "所有 Git Worktree:"
    echo ""

    # 表头
    printf "${BLUE}%-40s %-30s %-15s${NC}\n" "路径" "分支" "提交"
    printf "%.0s-" {1..90}
    echo ""

    # 列出 worktree
    git worktree list --porcelain | awk '
        /^worktree / { path = substr($0, 10) }
        /^branch / { branch = substr($0, 8); gsub(/^refs\/heads\//, "", branch) }
        /^HEAD / { head = substr($0, 6) }
        /^$/ {
            if (path != "") {
                # 缩短路径显示
                short_path = path
                gsub(/.*\//, "", short_path)
                short_head = substr(head, 1, 12)
                printf "%-40s %-30s %-15s\n", short_path, branch, short_head
                path = ""; branch = ""; head = ""
            }
        }
    '

    echo ""
    count=$(git worktree list | wc -l | tr -d ' ')
    info "共 $count 个 worktree"
}

# 清理已合并的 worktree
clean_worktrees() {
    info "清理已合并到 dev 的 worktree..."
    echo ""

    cleaned=0

    # 获取所有 worktree
    git worktree list --porcelain | grep "^worktree" | sed 's/^worktree //' | while read -r wt_path; do
        # 跳过主仓库
        if [ "$wt_path" = "$REPO_ROOT" ]; then
            continue
        fi

        # 获取该 worktree 的分支
        branch=$(git -C "$wt_path" branch --show-current 2>/dev/null || echo "")

        if [ -z "$branch" ]; then
            continue
        fi

        # 检查是否已合并
        if git branch --merged dev | grep -q "^\s*${branch}$"; then
            warning "删除已合并的 worktree: $(basename "$wt_path") (分支: $branch)"
            git worktree remove "$wt_path" 2>/dev/null || {
                error "删除失败，可能有未提交的更改"
                info "强制删除: git worktree remove --force $wt_path"
            }
            cleaned=$((cleaned + 1))
        fi
    done

    echo ""
    if [ $cleaned -eq 0 ]; then
        success "没有需要清理的 worktree"
    else
        success "已清理 $cleaned 个 worktree"
    fi

    # 清理记录
    git worktree prune
}

# 删除指定 worktree
remove_worktree() {
    local name=$1

    if [ -z "$name" ]; then
        error "请指定 worktree 名称"
        echo "用法: $(basename $0) remove <name>"
        exit 1
    fi

    local path="$PARENT_DIR/${REPO_NAME}-${name}"

    if [ ! -d "$path" ]; then
        path="$PARENT_DIR/${name}"
        if [ ! -d "$path" ]; then
            error "Worktree 不存在: $name"
            exit 1
        fi
    fi

    info "删除 worktree: $(basename "$path")"
    git worktree remove "$path" || {
        warning "删除失败，可能有未提交的更改"
        echo ""
        read -p "是否强制删除? (y/N): " -r
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            git worktree remove --force "$path"
            success "已强制删除"
        else
            info "取消删除"
            exit 0
        fi
    }

    success "已删除 worktree: $(basename "$path")"
}

# 创建功能开发 worktree
create_feature() {
    local name=$1

    if [ -z "$name" ]; then
        error "请指定功能名称"
        echo "用法: $(basename $0) feature <name>"
        echo "示例: $(basename $0) feature authentication"
        exit 1
    fi

    local path="$PARENT_DIR/${REPO_NAME}-feature-${name}"
    local branch="feature/${name}"

    if [ -d "$path" ]; then
        error "Worktree 已存在: ${REPO_NAME}-feature-${name}"
        exit 1
    fi

    info "创建功能开发 worktree..."
    git worktree add -b "$branch" "$path" dev

    success "已创建功能 worktree: ${REPO_NAME}-feature-${name}"
    echo ""
    info "下一步操作:"
    echo "  cd $path"
    echo "  npm install"
    echo "  code ."
}

# 创建 hotfix worktree
create_hotfix() {
    local name=$1

    if [ -z "$name" ]; then
        error "请指定 hotfix 名称"
        echo "用法: $(basename $0) hotfix <name>"
        echo "示例: $(basename $0) hotfix security-patch"
        exit 1
    fi

    local path="$PARENT_DIR/${REPO_NAME}-hotfix-${name}"
    local branch="hotfix/${name}"

    if [ -d "$path" ]; then
        error "Worktree 已存在: ${REPO_NAME}-hotfix-${name}"
        exit 1
    fi

    info "创建 hotfix worktree..."
    git worktree add -b "$branch" "$path" dev

    success "已创建 hotfix worktree: ${REPO_NAME}-hotfix-${name}"
    echo ""
    info "下一步操作:"
    echo "  cd $path"
    echo "  npm install"
    echo "  # 修复 bug..."
    echo "  git push origin $branch"
    echo "  # 创建 PR"
}

# 创建 PR review worktree
create_review() {
    local pr_num=$1

    if [ -z "$pr_num" ]; then
        error "请指定 PR 编号"
        echo "用法: $(basename $0) review <pr-number>"
        echo "示例: $(basename $0) review 123"
        exit 1
    fi

    local path="$PARENT_DIR/${REPO_NAME}-review-pr-${pr_num}"

    if [ -d "$path" ]; then
        error "Worktree 已存在: ${REPO_NAME}-review-pr-${pr_num}"
        exit 1
    fi

    info "获取 PR #${pr_num}..."

    # 使用 GitHub CLI 如果可用
    if command -v gh &> /dev/null; then
        local branch=$(gh pr view $pr_num --json headRefName -q .headRefName 2>/dev/null || echo "")
        if [ -n "$branch" ]; then
            git fetch origin "$branch:pr-${pr_num}"
        else
            warning "无法通过 gh 获取 PR，尝试直接 fetch..."
            git fetch origin "pull/${pr_num}/head:pr-${pr_num}"
        fi
    else
        git fetch origin "pull/${pr_num}/head:pr-${pr_num}"
    fi

    info "创建 review worktree..."
    git worktree add "$path" "pr-${pr_num}"

    success "已创建 review worktree: ${REPO_NAME}-review-pr-${pr_num}"
    echo ""
    info "下一步操作:"
    echo "  cd $path"
    echo "  npm install"
    echo "  npm run dev"
    echo "  # 测试和审查代码..."
    echo ""
    info "完成后删除:"
    echo "  $(basename $0) remove review-pr-${pr_num}"
}

# 显示所有 worktree 状态
show_status() {
    info "Worktree 状态："
    echo ""

    git worktree list --porcelain | grep "^worktree" | sed 's/^worktree //' | while read -r wt_path; do
        name=$(basename "$wt_path")
        branch=$(git -C "$wt_path" branch --show-current 2>/dev/null || echo "(detached)")

        echo -e "${BLUE}$name${NC} (${branch})"

        # 检查是否有未提交的更改
        if [ -n "$(git -C "$wt_path" status --porcelain)" ]; then
            warning "  有未提交的更改"
            git -C "$wt_path" status --short | sed 's/^/    /'
        else
            success "  工作目录干净"
        fi

        # 检查是否需要 push
        local ahead=$(git -C "$wt_path" rev-list --count @{u}..HEAD 2>/dev/null || echo "0")
        if [ "$ahead" != "0" ]; then
            info "  有 $ahead 个未推送的提交"
        fi

        echo ""
    done
}

# 在 VS Code 中打开 worktree
open_worktree() {
    local name=$1

    if [ -z "$name" ]; then
        error "请指定 worktree 名称"
        echo "用法: $(basename $0) open <name>"
        exit 1
    fi

    local path="$PARENT_DIR/${REPO_NAME}-${name}"

    if [ ! -d "$path" ]; then
        path="$PARENT_DIR/${name}"
        if [ ! -d "$path" ]; then
            error "Worktree 不存在: $name"
            exit 1
        fi
    fi

    if command -v code &> /dev/null; then
        info "在 VS Code 中打开: $(basename "$path")"
        code "$path"
        success "已打开"
    else
        error "未找到 VS Code (code 命令)"
        info "请手动打开: cd $path"
    fi
}

# 主函数
main() {
    # 检查是否在 git 仓库中
    if ! git rev-parse --git-dir > /dev/null 2>&1; then
        error "当前目录不是 Git 仓库"
        exit 1
    fi

    # 解析命令
    case "${1:-help}" in
        setup)
            setup_worktrees
            ;;
        list|ls)
            list_worktrees
            ;;
        clean)
            clean_worktrees
            ;;
        remove|rm)
            remove_worktree "$2"
            ;;
        feature|feat)
            create_feature "$2"
            ;;
        hotfix|fix)
            create_hotfix "$2"
            ;;
        review|pr)
            create_review "$2"
            ;;
        status|st)
            show_status
            ;;
        open)
            open_worktree "$2"
            ;;
        help|--help|-h)
            show_help
            ;;
        *)
            error "未知命令: $1"
            echo ""
            show_help
            exit 1
            ;;
    esac
}

main "$@"
