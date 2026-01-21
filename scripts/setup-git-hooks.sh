#!/bin/bash

# Setup script for Git hooks to enforce branch protection locally
# Run this script after cloning the repository: ./scripts/setup-git-hooks.sh

set -e

echo "🔧 Setting up Git hooks for branch protection..."
echo ""

# Get the repository root directory
REPO_ROOT=$(git rev-parse --show-toplevel)
HOOKS_DIR="$REPO_ROOT/.git/hooks"

# Check if we're in a git repository
if [ ! -d "$HOOKS_DIR" ]; then
    echo "❌ Error: Not in a Git repository or .git/hooks directory not found."
    exit 1
fi

# Create pre-commit hook
echo "📝 Creating pre-commit hook..."
cat > "$HOOKS_DIR/pre-commit" << 'EOF'
#!/bin/bash

# Pre-commit hook to prevent direct commits to protected branches
# This enforces the feature branch workflow

# Get current branch name
branch=$(git symbolic-ref --short HEAD 2>/dev/null)

# Define protected branches
protected_branches=("dev" "main" "master")

# Check if current branch is protected
for protected in "${protected_branches[@]}"; do
    if [[ "$branch" == "$protected" ]]; then
        echo ""
        echo "❌ Error: Direct commits to '$branch' branch are not allowed."
        echo ""
        echo "📋 Please follow the team workflow:"
        echo "  1. Create a feature branch:"
        echo "     git checkout -b feature/your-feature-name"
        echo ""
        echo "  2. Make your changes and commit to the feature branch"
        echo ""
        echo "  3. Push and create a Pull Request:"
        echo "     git push origin feature/your-feature-name"
        echo ""
        echo "💡 Tip: If you have uncommitted changes, you can save them:"
        echo "  git stash"
        echo "  git checkout -b feature/your-feature-name"
        echo "  git stash pop"
        echo ""
        exit 1
    fi
done

# Check if branch starts with upstream-
if [[ "$branch" == upstream-* ]]; then
    echo ""
    echo "❌ Error: Direct commits to upstream tracking branch '$branch' are not allowed."
    echo ""
    echo "📋 Upstream branches are read-only version references."
    echo "   Please create a feature branch from 'dev' instead:"
    echo "     git checkout dev"
    echo "     git checkout -b feature/your-feature-name"
    echo ""
    exit 1
fi

# All checks passed
exit 0
EOF

chmod +x "$HOOKS_DIR/pre-commit"
echo "✅ pre-commit hook created"

# Create pre-push hook
echo "📝 Creating pre-push hook..."
cat > "$HOOKS_DIR/pre-push" << 'EOF'
#!/bin/bash

# Pre-push hook to prevent direct pushes to protected branches
# This enforces Pull Request workflow

protected_branches=("refs/heads/dev" "refs/heads/main" "refs/heads/master")

while read local_ref local_sha remote_ref remote_sha
do
    # Check if pushing to a protected branch
    for protected in "${protected_branches[@]}"; do
        if [[ "$remote_ref" == "$protected" ]]; then
            echo ""
            echo "❌ Error: Direct push to '${remote_ref#refs/heads/}' branch is not allowed."
            echo ""
            echo "📋 Please follow the team workflow:"
            echo "  1. Push your feature branch:"
            echo "     git push origin feature/your-feature-name"
            echo ""
            echo "  2. Create a Pull Request on GitHub:"
            echo "     https://github.com/xianglixiang/dify/pulls"
            echo ""
            echo "  3. Request code review from team members"
            echo ""
            echo "  4. Merge via GitHub UI after approval"
            echo ""
            exit 1
        fi
    done

    # Check if pushing to upstream-* branch
    if [[ "$remote_ref" == refs/heads/upstream-* ]]; then
        echo ""
        echo "❌ Error: Direct push to upstream tracking branch '${remote_ref#refs/heads/}' is not allowed."
        echo ""
        echo "📋 Upstream branches are read-only version references."
        echo "   Only repository administrators should update these branches."
        echo ""
        exit 1
    fi
done

# All checks passed
exit 0
EOF

chmod +x "$HOOKS_DIR/pre-push"
echo "✅ pre-push hook created"

echo ""
echo "✅ Git hooks setup completed successfully!"
echo ""
echo "📋 These hooks will:"
echo "  • Prevent direct commits to dev, main, and upstream-* branches"
echo "  • Prevent direct pushes to protected branches"
echo "  • Enforce the feature branch + Pull Request workflow"
echo ""
echo "💡 To test the hooks:"
echo "  git checkout dev"
echo "  git commit --allow-empty -m 'test'  # Should be blocked"
echo ""
echo "🚀 Start developing with:"
echo "  git checkout -b feature/your-feature-name"
echo ""
