# HITL Phase 2 QA 明细任务

目标：为 QA 同事提供执行明细；这些条目不逐条提交到 Linear。Linear 只保留 [hitl_phase2_linear_task_list.md](hitl_phase2_linear_task_list.md) 中的 `HITL-P2-053 — QA 进场与验收执行统筹` 一个大 QA 任务。

## QA 进场口径

| 项目 | 内容 |
|-|-|
| 进场日期 | 2026-07-27 |
| 目标 | 2026-07-28 给出 RC1 结论，2026-07-31 前完成 ready-to-merge 测试证据包。 |
| 输入物 | 可测环境、前端 RC build、前端 QA handoff 包、provider sandbox、测试账号、测试 workspace、migration dry run 环境、PR / branch、配置文档草稿。 |
| 输出物 | 测试矩阵执行结果、P0/P1 缺陷列表、provider gate 结论、migration dry run 记录、安全回归记录、最终测试证据包。 |

## 进场前置条件

| # | 检查项 | 负责人 | 验收标准 |
|-|-|-|-|
| Q0.1 | 确认 RC scope | Product / Backend / Frontend / Provider | 明确哪些 provider 纳入 2026-07-31 ready-to-merge，哪些降级到 fallback，哪些移出范围。 |
| Q0.2 | 准备测试环境 | Backend / DevOps | 环境包含最新 migration、前端 RC build、Celery、mail、provider callback URL、feature flags 和基础 seed data。 |
| Q0.3 | 准备测试账号与权限 | Backend / QA | 至少覆盖普通 member、workspace admin、enterprise admin、Service API token、anonymous WebApp session。 |
| Q0.4 | 准备 provider sandbox | Provider owners | 每个纳入范围的 provider 都有 credential、通讯录测试数据、可回调 URL 和失败注入方式。 |
| Q0.5 | 准备缺陷 triage 节奏 | QA / Release | P0/P1 每日同步；blocker 有 owner、复现步骤、期望修复日期。 |
| Q0.6 | 准备前端 QA handoff 包 | Frontend | 2026-07-26 前提供可测 build、feature flag / 配置说明、前端 smoke checklist、已知限制、关键页面截图或录屏。 |

## 测试执行矩阵

### 1. HITL 核心运行时

| # | 测试域 | 覆盖范围 | 验收标准 |
|-|-|-|-|
| Q1.1 | Email-only HITL | Email delivery、表单打开、OTP、提交、workflow resume、Last Run 展示。 | 一条 Email-only 工作流可端到端完成；提交后 downstream outputs 正确。 |
| Q1.2 | WebApp HITL | WebApp delivery、Service API / OpenAPI surface、token 权限隔离。 | 只有允许 surface 可以拿到可提交 token；内部 console token 不被公开接口提交。 |
| Q1.3 | Current initiator | WebApp、Service API、CLI / non-interactive initiator。 | current initiator snapshot 正确；anonymous WebApp session 只在原会话有效。 |
| Q1.4 | Dynamic Email | 变量解析、发送、OTP、审计、日志。 | 不反查 Account / Contact；审计记录变量值、发送结果和提交校验结果。 |
| Q1.5 | One-time Email | 节点配置、发送、OTP、提交。 | 不写入 Contact；重复提交只有一个成功。 |
| Q1.6 | Debug only notify me | Debug mode、收件人覆盖、生产配置不受影响。 | Debug 只通知当前操作者；published run 使用真实配置。 |
| Q1.7 | Form file inputs | 单文件、多文件、upload token、过期、租户归属。 | 文件上传只能绑定当前 form / recipient，跨租户文件不可提交。 |

### 2. 安全与滥用防护

| # | 测试域 | 覆盖范围 | 验收标准 |
|-|-|-|-|
| Q2.1 | OTP required | External、one-time、dynamic Email、fallback URL。 | 无 OTP、错误 OTP、过期 OTP、email 不匹配均不能提交。 |
| Q2.2 | OTP retry limit | 重试次数、重发频率、过期后重发。 | 达到限制后返回稳定错误码，并写入 audit / rate limit 记录。 |
| Q2.3 | Link forwarding | 收件人 A 将链接转发给 B。 | B 无法在没有匹配 OTP / identity 的情况下提交。 |
| Q2.4 | Concurrent submit | 同一 task/form 多人或多请求同时提交。 | 只有一个 first-writer 成功，其余返回已完成状态。 |
| Q2.5 | Rate limit | 表单打开、表单提交、OTP、dynamic Email 发送。 | 超限返回明确错误；不会继续发送邮件或写入成功提交。 |
| Q2.6 | Secret redaction | Provider credential、Email body、IM body、日志和审计。 | secret 不进日志；消息正文不完整进入审计。 |
| Q2.7 | Cross-tenant isolation | Roster、Contact Directory、IM Binding、form token、upload token。 | 不同 workspace / Organization / deployment 间不可越权读写。 |

### 3. Human Roster 与 Contact Directory

| # | 测试域 | 覆盖范围 | 验收标准 |
|-|-|-|-|
| Q3.1 | Roster initialization | workspace member 初始化、新成员进入、离职成员状态。 | 可新选成员只包含有效成员；历史 snapshot 仍可读。 |
| Q3.2 | External contact | 创建、去重、禁用、搜索、权限。 | workspace admin 可管理；普通 member 不可浏览完整 Roster。 |
| Q3.3 | Contact Directory | Organization-scoped contact、IM identity、同步结果。 | enterprise admin 可查看；SaaS workspace 不串数据。 |
| Q3.4 | IM Binding | provider user id、email、Dify account/contact 映射。 | 绑定变更不影响运行中 task snapshot。 |

### 4. Provider 端到端测试

| # | Provider | 覆盖范围 | 验收标准 |
|-|-|-|-|
| Q4.1 | Slack | EE 自建应用、SaaS OAuth、sync、send、identity verify、submit、Email 双发。 | 两条部署形态 E2E 通过，delivery status 和 audit 完整。 |
| Q4.2 | 钉钉 | EE / SaaS 企业自建应用、sync、send、callback、Web fallback。 | SaaS 租户接入文档可按步骤跑通。 |
| Q4.3 | 飞书 / Lark | EE 自建应用、sync、卡片通知、身份校验、提交。 | sandbox E2E 通过；失败回调写入 delivery status。 |
| Q4.4 | Microsoft Teams | Teams App、Adaptive Card 或 fallback、identity verify、submit。 | sandbox E2E 通过；fallback URL 可安全提交。 |
| Q4.5 | 企业微信 | sync、通知、身份校验、Web fallback。 | 通知 + Web 审批页 E2E 通过；卡片内完整审批不是硬门禁。 |
| Q4.6 | Provider failure | credential 错误、权限不足、rate limit、callback signature 错误。 | 失败原因可见；不会误标为 sent/submitted。 |

### 5. 迁移与兼容性

| # | 测试域 | 覆盖范围 | 验收标准 |
|-|-|-|-|
| Q5.1 | Existing published workflow | 旧 `human-input` DSL、旧 Email recipient、旧 WebApp token。 | 不自动改写；已发布 workflow 仍可执行和恢复。 |
| Q5.2 | Running pause state | migration 前已有 waiting form/task。 | 使用创建时 snapshot；配置变更不影响运行中 task。 |
| Q5.3 | Migration dry run | schema migration、seed / backfill、rollback。 | dry run 可重复执行；回滚步骤可复现。 |
| Q5.4 | Import / export | workflow DSL 导入导出、版本分流。 | 旧 DSL 导入不丢字段；新 DSL 能正确落到 v2 path。 |

### 6. 前端回归

| # | 测试域 | 覆盖范围 | 验收标准 |
|-|-|-|-|
| Q6.1 | HITL node config | recipient selector、dynamic Email chip、one-time Email、current initiator、debug only notify me。 | 保存、回显、复制、导入、发布后配置一致。 |
| Q6.2 | Human Roster UI | Human tab、权限、搜索、添加 external contact、状态展示。 | workspace admin 可操作；普通 member 受限。 |
| Q6.3 | Contact Directory / IM UI | credential、test connection、sync、binding 状态、错误态。 | secret 不回显；失败提示可定位。 |
| Q6.4 | Web approval page | OTP 输入、重发、过期、已提交、无权限、移动端。 | 状态文案清晰；不能出现表单内容遮挡或按钮不可点击。 |
| Q6.5 | Last Run view | delivery、resolution、submitted_by、failure reason。 | 信息可读且不泄露敏感字段。 |

## 日期安排

| 日期 | QA 重点 | 输出物 |
|-|-|-|
| 2026-07-27 | 进场、环境核验、smoke、核心 HITL / OTP / Roster 首轮。 | 环境可测结论、P0 blocker、首轮 smoke 结果。 |
| 2026-07-28 | RC1：核心 runtime、安全、migration、前端主路径、provider gate 回归。 | RC1 go / no-go、P0/P1 清单、provider 纳入范围。 |
| 2026-07-29 | Provider sandbox E2E、安全与 abuse hardening 回归、migration dry run 复验。 | Provider E2E 记录、安全回归记录、migration 记录。 |
| 2026-07-30 | 缺陷修复回归、文档步骤验收、测试证据整理。 | 测试证据包草稿、剩余风险列表。 |
| 2026-07-31 | 最终验证、merge readiness review 支持。 | 最终 QA sign-off 或 no-go 理由。 |

## 缺陷分级

| 等级 | 定义 | Merge gate |
|-|-|-|
| P0 | 数据丢失、越权提交、跨租户泄露、旧 workflow 大面积失效、provider callback 可被伪造。 | 必须关闭。 |
| P1 | 核心路径不可用、OTP / Email / provider 某一首发路径不可闭环、migration dry run 不可回滚。 | 必须关闭或从 scope 移出。 |
| P2 | 单个非首发 provider 体验问题、可绕过的 UI 缺陷、非关键日志缺字段。 | 可带已知限制进入 review。 |
| P3 | 文案、样式、诊断增强、非阻塞易用性问题。 | 不阻塞。 |

## QA 退出标准

| 标准 | 所需证据 |
|-|-|
| 核心运行时验收 | Email-only、WebApp、current initiator、dynamic Email、one-time Email、debug only notify me、并发提交测试记录。 |
| 安全验收 | OTP、rate limit、cross-tenant、secret redaction、audit 测试记录。 |
| Provider 验收 | 纳入 scope 的每个 provider sandbox E2E 记录和失败场景记录。 |
| 迁移验收 | dry run、rollback、旧 DSL / running pause state 兼容记录。 |
| 前端验收 | 节点配置、Roster、Contact Directory、Web approval、Last Run 展示截图或录屏。 |
| 发布验收 | P0/P1 为 0；P2/P3 有 owner、风险说明和后续处理计划。 |
