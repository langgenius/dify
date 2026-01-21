# Dify Fork 团队协作文档

本目录包含 Dify fork 仓库的团队协作文档和工作流程指南。

## 📚 文档索引

### 🚀 快速开始

| 文档 | 描述 | 适用人群 |
|------|------|---------|
| [QUICK_START.md](./QUICK_START.md) | **从这里开始** - 快速开始指南和行动清单 | 所有人 |
| [TEAM_WORKFLOW.md](./TEAM_WORKFLOW.md) | **必读** - 完整的团队协作工作流程 | 所有开发者 |

### 🔧 工作流指南

| 文档 | 描述 | 何时使用 |
|------|------|---------|
| [TEAM_WORKFLOW.md](./TEAM_WORKFLOW.md) | 团队协作标准流程 | 日常开发 |
| [GIT_WORKTREE_GUIDE.md](./GIT_WORKTREE_GUIDE.md) | Git Worktree 完整指南 | 高级工作流 |
| [WORKTREE_CHEATSHEET.md](./WORKTREE_CHEATSHEET.md) | Worktree 速查表 | 快速参考 |

### ⚙️ 配置指南

| 文档 | 描述 | 适用人群 |
|------|------|---------|
| [../.github/BRANCH_PROTECTION_GUIDE.md](../.github/BRANCH_PROTECTION_GUIDE.md) | GitHub 分支保护配置 | 仓库管理员 |
| [../scripts/setup-git-hooks.sh](../scripts/setup-git-hooks.sh) | Git hooks 设置脚本 | 新成员 |
| [../scripts/worktree-helpers.sh](../scripts/worktree-helpers.sh) | Worktree 辅助脚本 | 使用 worktree 的成员 |

## 🎯 按角色查找

### 新成员入职

1. 阅读 [QUICK_START.md](./QUICK_START.md)
2. 阅读 [TEAM_WORKFLOW.md](./TEAM_WORKFLOW.md)
3. 运行设置脚本：
   ```bash
   ./scripts/setup-git-hooks.sh
   ```
4. 开始第一个功能开发

### 日常开发者

**基础工作流：**
- [TEAM_WORKFLOW.md](./TEAM_WORKFLOW.md) - 标准开发流程
- [TEAM_WORKFLOW.md#提交信息规范](./TEAM_WORKFLOW.md#提交信息规范) - Commit 规范

**高级技巧：**
- [GIT_WORKTREE_GUIDE.md](./GIT_WORKTREE_GUIDE.md) - 学习 Worktree
- [WORKTREE_CHEATSHEET.md](./WORKTREE_CHEATSHEET.md) - 常用命令

### Code Reviewer

- [TEAM_WORKFLOW.md#代码审查](./TEAM_WORKFLOW.md#代码审查) - 审查流程
- [GIT_WORKTREE_GUIDE.md#场景-2-code-review-和-pr-测试](./GIT_WORKTREE_GUIDE.md#场景-2-code-review-和-pr-测试) - 使用 Worktree Review

### 仓库管理员

- [../.github/BRANCH_PROTECTION_GUIDE.md](../.github/BRANCH_PROTECTION_GUIDE.md) - 配置分支保护
- [TEAM_WORKFLOW.md#版本升级](./TEAM_WORKFLOW.md#版本升级) - 升级流程

## 📖 主题索引

### 分支管理

- **分支结构**: [TEAM_WORKFLOW.md#分支结构](./TEAM_WORKFLOW.md#分支结构)
- **分支保护**: [../.github/BRANCH_PROTECTION_GUIDE.md](../.github/BRANCH_PROTECTION_GUIDE.md)
- **分支命名**: [TEAM_WORKFLOW.md#开始新功能](./TEAM_WORKFLOW.md#开始新功能)

### Git 工作流

- **标准流程**: [TEAM_WORKFLOW.md#标准开发流程](./TEAM_WORKFLOW.md#标准开发流程)
- **紧急修复**: [TEAM_WORKFLOW.md#紧急修复hotfix](./TEAM_WORKFLOW.md#紧急修复hotfix)
- **版本升级**: [TEAM_WORKFLOW.md#版本升级](./TEAM_WORKFLOW.md#版本升级)
- **Worktree**: [GIT_WORKTREE_GUIDE.md](./GIT_WORKTREE_GUIDE.md)

### Pull Request

- **创建 PR**: [TEAM_WORKFLOW.md#创建-pull-request](./TEAM_WORKFLOW.md#创建-pull-request)
- **代码审查**: [TEAM_WORKFLOW.md#代码审查](./TEAM_WORKFLOW.md#代码审查)
- **PR 模板**: [../.github/pull_request_template.md](../.github/pull_request_template.md)

### 代码质量

- **提交规范**: [TEAM_WORKFLOW.md#提交信息规范](./TEAM_WORKFLOW.md#提交信息规范)
- **质量检查**: [TEAM_WORKFLOW.md#代码质量检查](./TEAM_WORKFLOW.md#代码质量检查)
- **最佳实践**: [TEAM_WORKFLOW.md#最佳实践](./TEAM_WORKFLOW.md#最佳实践)

### 工具和脚本

- **Git Hooks**: [../scripts/setup-git-hooks.sh](../scripts/setup-git-hooks.sh)
- **Worktree 助手**: [../scripts/worktree-helpers.sh](../scripts/worktree-helpers.sh)

## 🔍 快速查找

### 常见问题

| 问题 | 在哪里找答案 |
|------|-------------|
| 如何开始开发新功能？ | [TEAM_WORKFLOW.md#开始新功能](./TEAM_WORKFLOW.md#开始新功能) |
| 如何 Review PR？ | [TEAM_WORKFLOW.md#代码审查](./TEAM_WORKFLOW.md#代码审查) |
| 紧急修复怎么处理？ | [TEAM_WORKFLOW.md#紧急修复](./TEAM_WORKFLOW.md#紧急修复) |
| 如何升级到新版本？ | [TEAM_WORKFLOW.md#版本升级](./TEAM_WORKFLOW.md#版本升级) |
| 什么是 Worktree？ | [GIT_WORKTREE_GUIDE.md](./GIT_WORKTREE_GUIDE.md) |
| Worktree 常用命令？ | [WORKTREE_CHEATSHEET.md](./WORKTREE_CHEATSHEET.md) |
| 如何配置分支保护？ | [../.github/BRANCH_PROTECTION_GUIDE.md](../.github/BRANCH_PROTECTION_GUIDE.md) |
| 不小心在 dev 分支提交了？ | [TEAM_WORKFLOW.md#常见问题](./TEAM_WORKFLOW.md#常见问题) |

### 常用命令速查

```bash
# 标准开发流程
git checkout dev
git pull origin dev
git checkout -b feature/your-feature
# 开发、提交、推送、创建 PR

# Git Worktree
./scripts/worktree-helpers.sh setup          # 初始化
./scripts/worktree-helpers.sh feature auth   # 创建功能 worktree
./scripts/worktree-helpers.sh review 123     # Review PR
./scripts/worktree-helpers.sh list           # 列出所有
./scripts/worktree-helpers.sh clean          # 清理已合并

# Git Hooks
./scripts/setup-git-hooks.sh                 # 设置本地保护
```

## 📋 文档更新记录

### 2026-01-21
- ✅ 初始化团队协作文档
- ✅ 创建分支管理策略
- ✅ 配置 Git Hooks 本地保护
- ✅ 添加 Git Worktree 完整指南
- ✅ 创建辅助脚本和速查表

## 💡 贡献指南

如果你发现文档有误或有改进建议：

1. 在功能分支上修改文档
2. 提交 PR，描述你的修改
3. 请求团队 Review
4. 合并后所有成员可见

## 📞 获取帮助

- **文档问题**: 查看本目录的相关文档
- **工作流问题**: 参考 [TEAM_WORKFLOW.md](./TEAM_WORKFLOW.md)
- **技术问题**: 在团队群组讨论
- **紧急问题**: 联系仓库管理员

## 🔗 相关资源

### 内部资源
- [项目约定](../CLAUDE.md) - 项目规范和约定
- [贡献指南](../CONTRIBUTING.md) - Dify 项目贡献指南

### 外部资源
- [Git 官方文档](https://git-scm.com/doc)
- [GitHub Flow](https://docs.github.com/en/get-started/quickstart/github-flow)
- [Conventional Commits](https://www.conventionalcommits.org/)
- [Dify 官方文档](https://docs.dify.ai/)

---

**开始使用**: 阅读 [QUICK_START.md](./QUICK_START.md) 📖
