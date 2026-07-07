# Dify 二开实习生分工方案

## 团队角色

| 角色 | 人数 | 职责 |
| --- | ---: | --- |
| 技术负责人 | 1 | 分支策略、升级方案、架构边界、最终合并 |
| 发布负责人 | 1 | release plan、staging/production、回滚演练 |
| Mentor | 每 2-3 名实习生 1 人 | 任务拆解、PR review、风险把关 |
| 实习生 Web | 1-3 | UI、i18n、组件测试、低风险页面修复 |
| 实习生 API | 1-2 | 单测、DTO、配置校验、低风险服务逻辑 |
| 实习生 QA/E2E | 1-2 | Playwright/Cucumber、发布验收、回归脚本 |
| 实习生 Upgrade Scout | 1 | upstream release notes、diff 初筛、冲突记录 |

## 第一阶段：入门期，第 1-2 周

目标：让实习生熟悉 Dify 结构和 GitHub 协作，不碰高风险代码。

任务池：

- `docs`：整理本地启动说明、常见错误 FAQ
- `web`：修复 i18n 缺失、补 Storybook/组件测试
- `api`：补配置一致性测试、补纯函数单测
- `e2e`：补 smoke 场景和失败截图说明
- `upgrade scout`：阅读 upstream changelog，产出升级风险表

验收：

- 每人至少 2 个低风险 PR
- 每个 PR 通过 `Company CI`
- 每人能独立完成 rebase、解决简单冲突、补测试

## 第二阶段：功能期，第 3-6 周

目标：进入公司二开能力建设，但仍然小步 PR。

分工建议：

| 方向 | 可分配任务 | 验收 |
| --- | --- | --- |
| Web | Agent V2/Roster 可见 UI、表单、状态展示、i18n | 截图 + typecheck + 组件测试 |
| API | 非核心路径接口、字段校验、服务层小能力 | pytest + API contract 说明 |
| Agent | dify-agent 本地测试、文档示例、边界错误处理 | `make -C dify-agent test` |
| QA/E2E | 登录、创建应用、发布 workflow、Agent smoke | HTML report 或失败 artifact |
| Upgrade | upstream diff map、冲突文件 owner 分派 | 升级 PR checklist |

## 第三阶段：升级期，每次 upstream 升级

固定分工：

1. Upgrade Scout：列 upstream commits、release notes、breaking changes。
2. 技术负责人：创建 `upgrade/upstream-YYYYMMDD` 分支并 merge upstream。
3. Web 实习生：检查 `web/`、`packages/`、i18n、Agent V2 入口。
4. API 实习生：检查 `api/configs`、migration、controller/service 变动。
5. QA/E2E 实习生：跑 smoke 和核心链路回归。
6. 发布负责人：维护 release plan、staging 验证、回滚 tag。

## 禁区清单

实习生默认不能单独修改：

- `api/migrations/**`
- `api/controllers/console/auth/**`
- `api/services/billing*`
- `api/services/enterprise/**`
- tenant/workspace 权限判断
- `.github/workflows/company-deploy-compose.yml`
- `docker/.env.example` 中生产相关配置
- 任何 secret、token、真实客户数据

如果必须改，PR 至少需要：

- 1 名 mentor review
- 1 名技术负责人 review
- staging 验证记录
- 回滚/兼容说明

## 任务颗粒度模板

每个 Issue 控制在 0.5-2 天：

```text
标题：[area:web][risk:low] 修复 Agent Roster 页面空状态 i18n
背景：当前空状态文案硬编码，需接入 i18n。
范围：只改 web/features/agent-v2/... 和 locale 文件。
验收：
- 无硬编码用户可见英文
- pnpm/vp typecheck 通过
- 提供截图
非范围：不改 API、不改路由、不改权限
Mentor：@xxx
```
