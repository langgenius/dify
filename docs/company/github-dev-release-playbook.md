# 公司二开 Dify：GitHub 开发、升级与发版搭建手册

本文面向 `/Users/ocrand/AI/Project/Dify/dify` 这份公司二开 Dify 仓库，目标是让正式员工和实习生都能在 GitHub 上协作开发，同时避免升级 Dify upstream 时把公司改动冲掉。

## 1. 当前仓库事实

- 当前本地仓库：`/Users/ocrand/AI/Project/Dify/dify`
- 当前分支：`feature/agent-skills-auto-dsl-20260630`
- fork 远端：`Firestarbook/dify`
- upstream 远端：`langgenius/dify`
- GitHub 上 `Firestarbook/dify` 当前账号权限：组织 Owner/Admin
- GitHub main 分支已启用 branch protection：必须 PR、1 个 approval、`Company CI`、conversation resolution
- 当前 upstream 工作流大量使用 `depot-ubuntu-24.04` runner；公司 fork 如果没有 Depot runner，不能直接把这些 job 作为唯一必选门禁
- 当前 `build-push.yml` 对真正推送镜像有 `github.repository == 'langgenius/dify'` 判断；公司 fork 需要单独的 release workflow

## 2. 第一件事：规范 Git remote

现在公司仓库已迁移到 GitHub Organization。给实习生用时统一使用组织仓库作为 `origin`，官方 Dify 作为 `upstream`：

```bash
cd /Users/ocrand/AI/Project/Dify/dify

git remote set-url origin https://github.com/Firestarbook/dify.git
git remote set-url --push origin https://github.com/Firestarbook/dify.git
git remote set-url upstream https://github.com/langgenius/dify.git
git remote set-url --push upstream DISABLED

git remote -v
```

期望结果：

```text
origin    https://github.com/Firestarbook/dify.git (fetch)
origin    https://github.com/Firestarbook/dify.git (push)
upstream  https://github.com/langgenius/dify.git (fetch)
upstream  DISABLED (push)
```

## 3. 分支模型

建议不要开一个长期混乱的 `develop`。Dify 升级和公司功能开发分两条线：

| 分支 | 用途 | 谁能写 |
| --- | --- | --- |
| `main` | 公司稳定基线，可部署 | 只允许 PR 合并 |
| `upgrade/upstream-YYYYMMDD` | 同步官方 Dify upstream | 技术负责人/高级同学 |
| `feature/<issue>-<summary>` | 公司二开功能 | 开发/实习生 |
| `fix/<issue>-<summary>` | 缺陷修复 | 开发/实习生 |
| `release/company-vYYYY.MM.N` | 发版候选、只收阻断修复 | 发布负责人 |
| `hotfix/<issue>-<summary>` | 线上紧急修复 | 正式员工主导 |

## 4. GitHub 必配项

### 4.1 Environments

创建：

- `staging`：允许自动/手动部署，给实习生验证但不暴露生产密钥。
- `production`：必须 required reviewers，至少 1 名正式员工审批。

需要的 secrets 见 `.github/SECRETS.md`。

### 4.2 Branch protection / Ruleset

等 `Company CI` 首次在 GitHub 跑出来以后，对 `main` 启用：

- Require a pull request before merging
- Require approvals：至少 1 人；高风险区域 2 人
- Dismiss stale approvals when new commits are pushed
- Require status checks：`Company CI`
- Require conversation resolution before merging
- Block force pushes
- Block branch deletion

### 4.3 CODEOWNERS

上游 `.github/CODEOWNERS` 是 Dify 官方维护者，不适合公司 fork 直接作为审批责任人。建议在公司 fork 中替换成公司团队账号，例如：

```text
* @Firestarbook/dify-maintainers
/api/ @Firestarbook/dify-maintainers
/web/ @Firestarbook/dify-maintainers
/dify-agent/ @Firestarbook/dify-maintainers
/docker/ @Firestarbook/security-reviewers
/.github/ @Firestarbook/security-reviewers
/api/migrations/ @Firestarbook/dify-maintainers @Firestarbook/security-reviewers
```

如果暂时没有更多 GitHub team，就先用正式员工 GitHub 用户名，实习生不进入 CODEOWNERS。

## 5. CI/CD 搭建

本仓库已新增公司专用工作流，避免依赖 upstream 的 Depot runner 和 langgenius 发布条件：

- `.github/workflows/company-ci.yml`
- `.github/workflows/company-release-ghcr.yml`
- `.github/workflows/company-deploy-compose.yml`

### PR 门禁

`company-ci.yml` 做轻量门禁：

- API 改动：`uv lock --check`、`uv sync`、`ruff check api`、配置一致性 smoke test
- Web 改动：使用 `.github/actions/setup-web`，跑 `vp run lint:ci` 和 `vp run type-check`
- Dify Agent 改动：Ruff + pytest
- Docker 改动：API/Web Docker build dry-run

Branch protection 只需要把最终 job `Company CI` 设为 required check。

### 镜像发布

`company-release-ghcr.yml` 会构建并推送：

- `ghcr.io/<owner>/dify-api:<tag>`
- `ghcr.io/<owner>/dify-web:<tag>`

发布方式：

```bash
git checkout main
git pull origin main
git tag company-v2026.07.07.1
git push origin company-v2026.07.07.1
```

### 部署

`company-deploy-compose.yml` 用 GitHub Environment 审批后，通过 SSH 到服务器执行 Docker Compose 覆盖镜像部署。

服务器要求：

- 已有 Dify `docker/docker-compose.yaml`
- 已登录 GHCR，如果镜像是 private
- `DEPLOY_PATH` 指向包含 `docker-compose.yaml` 的目录
- 部署用户只能操作该目录和 Docker，不给 root 密码

回滚方式：重新运行 deploy workflow，输入上一稳定 tag。

## 6. 官方 Dify 升级流程

每次升级官方 Dify，不要让实习生直接在业务功能分支上 merge upstream。固定流程：

```bash
cd /Users/ocrand/AI/Project/Dify/dify

git fetch upstream
git fetch origin
git checkout main
git pull origin main
git checkout -b upgrade/upstream-20260707

git merge upstream/main
# 解决冲突，重点看 api/configs、web/env.ts、docker/.env.example、docker/envs/**、Agent V2/Agent Roster 相关文件
```

升级 PR 必须包含：

- upstream commit 范围
- 冲突文件清单
- 公司二开功能回归清单
- 数据库 migration 说明
- Docker/env 配置 diff
- staging 验证截图/日志

## 7. 实习生参与原则

实习生可以做：

- 文档、翻译、i18n 缺失补齐
- 前端低风险 UI 修复、样式一致性、组件测试
- 后端纯函数/DTO/校验逻辑和单测
- E2E/Playwright 场景补齐
- upstream diff 初筛和冲突标注
- Dependabot/依赖升级的本地验证

实习生不直接做：

- 生产部署和 production secrets
- 数据库 migration 主设计
- 鉴权、租户隔离、权限、计费、安全边界
- 大规模重构、架构迁移
- 直接 merge upstream/main 到 main

## 8. PR 规则

每个实习生 PR 必须满足：

- 关联一个 Issue
- 单 PR 建议不超过 400 行有效代码变更
- 标清风险等级：`risk:low` / `risk:medium` / `risk:high`
- 粘贴本地验证命令和结果
- UI 改动必须有截图或录屏
- API 改动必须有测试
- 不允许包含密钥、真实客户数据、生产配置

## 9. 推荐 GitHub Labels

```text
area:web
area:api
area:agent
area:docker
area:e2e
area:docs
kind:bug
kind:feature
kind:upgrade
kind:test
risk:low
risk:medium
risk:high
good-first-issue
intern-ready
needs-design
needs-security-review
needs-migration-review
blocked
```

## 10. 推荐 Project 看板列

1. Backlog
2. Ready
3. In Progress
4. PR Opened
5. Review Changes Requested
6. Staging Verify
7. Ready to Release
8. Done

## 11. 每周节奏

- 周一：拆任务、标风险、分配 mentor
- 周二到周四：开发、PR、review
- 周五上午：staging 合并验证
- 周五下午：复盘、整理升级冲突/遗留项
- 发版周：周三 code freeze，周四 staging，周五 production 或按业务窗口发布
