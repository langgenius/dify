# HITL Phase 2 Linear 任务清单

目标：2026-07-31 达到 PR ready to merge，不要求 SaaS 生产上线。  
来源排期：[hitl_phase2_schedule_plan.md](hitl_phase2_schedule_plan.md)  
QA 明细：[hitl_phase2_qa_task_list.md](hitl_phase2_qa_task_list.md)

## 使用口径

这个文件按“后续导入 Linear”的口径编写：每一行尽量对应一个 Linear issue。字段使用中文，但语义贴近 Linear：`任务编号`、`标题`、`团队`、`标签`、`优先级`、`状态`、`开始日期`、`截止日期`、`依赖`、`描述`、`验收标准`。

核心排期原则：

1. 先在 2026-07-10 至 2026-07-13 冻结前后端契约、API schema、mock fixture 和 provider contract，前端不能等后端全部实现完才开始。
2. 2026-07-13 起，后端实现领域模型和 runtime，前端基于契约和 mock 并行开发 Human Roster、Contact Directory、节点配置、审批页和 Last Run。
3. 2026-07-15 起，provider 后端 adapter 和 provider 前端配置 / 状态 UI 并行推进。
4. 2026-07-22 至 2026-07-26 作为前后端真实接口联调、provider UI 收敛和前端 RC handoff 窗口。
5. Linear 里只保留一个大的 QA 任务；具体测试拆分维护在 [hitl_phase2_qa_task_list.md](hitl_phase2_qa_task_list.md)，QA 同事从 2026-07-27 进场。

## 当前代码基线

| 能力 | 当前状态 | Phase 2 处理 |
|-|-|-|
| Human Input 节点 DSL | 已有 `human-input` 节点，包含 form content、inputs、actions、timeout、delivery_methods。 | 保持旧 published DSL 兼容；Phase 2 新 schema 需要明确 node version / adapter / rollback。 |
| 表单持久化 | 已有 `HumanInputForm`、`HumanInputDelivery`、`HumanInputFormRecipient`。 | 优先做 schema delta，不重复建设同义 task / delivery / recipient 表；如新增 task 表，必须给出桥接关系。 |
| WebApp / Console / Service API / OpenAPI 表单提交 | 已有 token 获取、提交、暂停恢复和 surface 隔离。 | 增加 OTP、actor 校验、原子提交、audit，不重做基础 endpoint。 |
| Email delivery | 已有 Email 配置、test send、Celery 发送、URL placeholder、feature gate。 | 增加 OTP、发送日志、投递状态、失败原因、限流和 secret redaction。 |
| 文件上传 | 已有表单 upload token 和文件归属校验。 | 纳入安全回归，不作为 Phase 2 主路径新增项。 |
| Provider | 后端没有 HITL provider adapter；前端 Slack / Teams 只是占位。 | Provider framework、provider adapter 和 provider 配置 UI 都是新增任务。 |
| Human Roster | 现有 Agent Roster 与 Phase 2 Human Roster 语义不同，Human tab 禁用。 | 新增 Human Roster / Contact Directory / IM Binding 模型、API 和 UI。 |

## 里程碑

| 里程碑 | 日期 | 目标 |
|-|-|-|
| M1 范围冻结 | 2026-07-10 | 冻结节点策略、身份规则、OTP、RBAC、provider gate。 |
| M2 契约冻结 | 2026-07-13 | 冻结 schema、API contract、mock fixture、provider contract，解除前端开发阻塞。 |
| M3 Core alpha | 2026-07-18 | 后端 Email-only / Roster / resolver / OTP / 原子提交闭环，前端核心页面可基于 mock 跑通。 |
| M4 前端主路径可联调 | 2026-07-21 | Human Roster、Contact Directory、节点配置、审批页、Last Run 前端主路径完成。 |
| M5 Provider readiness | 2026-07-24 | Provider 后端和前端配置入口完成 gate 判定。 |
| M6 前端 RC handoff | 2026-07-26 | 前后端真实接口联调、provider UI 收敛、前端 smoke 和 QA handoff 包完成。 |
| M7 QA entry | 2026-07-27 | QA 接收可测环境、前端 RC build、provider sandbox 和测试矩阵。 |
| M8 Merge readiness | 2026-07-31 | 测试证据、文档、回滚、安全、CI、review 全部 ready。 |

## Linear 任务

### M1 范围冻结

| 任务编号 | 标题 | 团队 | 标签 | 优先级 | 状态 | 开始日期 | 截止日期 | 依赖 | 描述 | 验收标准 |
|-|-|-|-|-|-|-|-|-|-|-|
| HITL-P2-001 | 冻结 Phase 2 节点兼容策略 | 后端、前端、工作流 | 决策、兼容性 | P0 | 待办 | 2026-07-10 | 2026-07-10 | - | 明确新逻辑节点、DSL version、导入导出、执行分流和回滚策略。 | 旧 `human-input` published workflow 不自动改写；旧运行路径可继续恢复；新 DSL 的执行入口明确。 |
| HITL-P2-002 | 冻结现有表模型复用边界 | 后端、数据库 | 决策、迁移 | P0 | 待办 | 2026-07-10 | 2026-07-10 | HITL-P2-001 | 确认 `human_input_forms`、`human_input_form_deliveries`、`human_input_form_recipients` 是否作为 Phase 2 基表继续扩展。 | 若新增 task 表，必须列出与现有 form / delivery / recipient 的映射和迁移桥接；不能出现两套状态源。 |
| HITL-P2-003 | 冻结身份与审批 actor 规则 | 后端、安全 | 决策、安全 | P0 | 待办 | 2026-07-10 | 2026-07-10 | HITL-P2-001 | 明确 WebApp、Service API、OpenAPI、Console、CLI、anonymous session、IM callback 的提交身份规则。 | `submitted_by`、allowed approver、anonymous session 边界和 current initiator 规则写入决策记录。 |
| HITL-P2-004 | 冻结 Email OTP 与 fallback 鉴权规则 | 后端、前端、安全 | 决策、安全、OTP | P0 | 待办 | 2026-07-10 | 2026-07-10 | HITL-P2-003 | 明确 Email / fallback URL 沿用现有 token 定位表单，提交时如何二次校验。 | External、one-time、dynamic Email 提交必须校验 OTP；成员或 IM 提交是否需要 OTP 有明确裁决。 |
| HITL-P2-005 | 冻结 Organization / RBAC 默认矩阵 | 后端、前端、安全、企业版、SaaS | 决策、RBAC | P0 | 待办 | 2026-07-10 | 2026-07-10 | - | 明确 EE / CE deployment 与 SaaS workspace 的 Organization 映射和默认权限矩阵。 | workspace admin 管 Human Roster；enterprise admin 管 EE Contact Directory 和 IM Integration；普通 member 权限边界明确。 |
| HITL-P2-006 | 冻结 provider 首发 gate 与降级策略 | Provider、安全、发布 | 决策、Provider | P0 | 待办 | 2026-07-10 | 2026-07-10 | HITL-P2-004、HITL-P2-005 | 定义 Slack、钉钉、飞书 / Lark、Teams、企业微信的首发准入和 fallback 策略。 | 每个 provider 的 sync、send、identity verify、callback、Web fallback、delivery status 最小门禁明确；企业微信允许通知 + Web fallback。 |

### M2 契约冻结与前端解耦

| 任务编号 | 标题 | 团队 | 标签 | 优先级 | 状态 | 开始日期 | 截止日期 | 依赖 | 描述 | 验收标准 |
|-|-|-|-|-|-|-|-|-|-|-|
| HITL-P2-007 | 设计 Contact Directory / Human Roster / IM Binding 模型 | 后端、数据库 | 模型、Roster、IM | P0 | 待办 | 2026-07-10 | 2026-07-13 | HITL-P2-005 | 定义 workspace member、Dify account、external contact、Organization-scoped IM identity 的领域模型。 | 字段、唯一约束、索引、状态枚举、历史 snapshot 读取策略明确。 |
| HITL-P2-008 | 设计 HITL task schema delta | 后端、数据库、工作流 | 模型、迁移 | P0 | 待办 | 2026-07-10 | 2026-07-13 | HITL-P2-002、HITL-P2-007 | 明确现有 form/delivery/recipient 字段哪些复用、哪些新增。 | 覆盖 recipient snapshot、delivery status、resolution、audit、provider callback metadata。 |
| HITL-P2-009 | 定义 recipient resolver v2 契约 | 后端、前端、工作流 | API 契约、Resolver | P0 | 待办 | 2026-07-10 | 2026-07-13 | HITL-P2-003、HITL-P2-007、HITL-P2-008 | 定义前端保存的 recipient 配置 schema 和后端解析输出 schema。 | static contact、external contact、one-time Email、dynamic Email、current initiator、debug only notify me 的输入、输出、去重和错误语义明确。 |
| HITL-P2-010 | 定义 Email OTP API 契约 | 后端、前端、安全 | API 契约、OTP | P0 | 待办 | 2026-07-10 | 2026-07-13 | HITL-P2-004、HITL-P2-008 | 定义 OTP 发送、重发、校验、错误码、rate limit 和前端状态机。 | 前端可基于 mock 开发；错误码覆盖过期、次数超限、email 不匹配、form 已完成。 |
| HITL-P2-011 | 定义 delivery / audit / Last Run API 契约 | 后端、前端、工作流 | API 契约、Last Run、审计 | P0 | 待办 | 2026-07-10 | 2026-07-13 | HITL-P2-008 | 定义 Last Run 展示所需的数据结构和审计事件字段。 | resolved recipients、变量值、投递状态、失败原因、submitted_by、submitted_at、channel 字段明确。 |
| HITL-P2-012 | 定义 Provider adapter contract | 后端、Provider、前端 | API 契约、Provider | P0 | 待办 | 2026-07-10 | 2026-07-13 | HITL-P2-006、HITL-P2-007、HITL-P2-008 | 定义 credential、test connection、Organization sync、send message、identity verify、callback、fallback URL、secret redaction 的接口。 | 后端 adapter 和前端 provider 配置 UI 可并行开发；mock provider schema 明确。 |
| HITL-P2-013 | 输出前端 mock fixture 与接口 stub | 前端、后端 | 前端、Mock、API 契约 | P0 | 待办 | 2026-07-11 | 2026-07-13 | HITL-P2-009、HITL-P2-010、HITL-P2-011、HITL-P2-012 | 为前端提供 Human Roster、Contact Directory、recipient selector、OTP、Last Run、provider 配置的 mock 数据。 | 前端可以不等待真实后端完成即开始主路径开发；mock fixture 与 API 契约字段一致。 |
| HITL-P2-014 | 定义 migration dry run 与回滚方案 | 后端、数据库、发布 | 迁移、回滚 | P0 | 待办 | 2026-07-10 | 2026-07-13 | HITL-P2-008 | 明确 schema migration、backfill、dry run、rollback 和运行中 task snapshot 策略。 | 旧 workflow 不失效；运行中 form/task 使用创建时 snapshot；migration 可 dry run、可回滚、可重复执行。 |

### M3 后端核心开发

| 任务编号 | 标题 | 团队 | 标签 | 优先级 | 状态 | 开始日期 | 截止日期 | 依赖 | 描述 | 验收标准 |
|-|-|-|-|-|-|-|-|-|-|-|
| HITL-P2-015 | 实现 Contact Directory / Human Roster / IM Binding migration | 后端、数据库 | 迁移、Roster、IM | P0 | 待办 | 2026-07-13 | 2026-07-16 | HITL-P2-007、HITL-P2-014 | 新增或扩展 Contact、Roster、IM Binding 相关表结构。 | 新表、索引、唯一约束和回滚脚本完成；Organization scope 不泄露跨 workspace / deployment 数据。 |
| HITL-P2-016 | 实现 Human Roster API | 后端、安全 | API、Roster、RBAC | P0 | 待办 | 2026-07-13 | 2026-07-17 | HITL-P2-015 | 实现 Human Roster 初始化、列表、搜索、external contact 管理和禁用状态过滤。 | workspace admin 可管理；普通 member 不可浏览完整 Roster；成员离开后不可新选。 |
| HITL-P2-017 | 实现 Contact Directory 与 IM Integration 管理 API | 后端、安全、Provider | API、IM、RBAC | P0 | 待办 | 2026-07-13 | 2026-07-17 | HITL-P2-015、HITL-P2-012 | 实现 provider credential、test connection、sync trigger、IM binding 状态查询 API。 | enterprise admin 可操作；secret 不出响应和日志；前端可接真实接口。 |
| HITL-P2-018 | 实现 recipient resolver v2 | 后端、工作流 | Resolver、运行时 | P0 | 待办 | 2026-07-13 | 2026-07-18 | HITL-P2-009、HITL-P2-016 | 实现各类 recipient 配置解析、去重、snapshot 和错误处理。 | dynamic Email 不反查 Account / Contact；current initiator 解析符合决策；输出 durable snapshot。 |
| HITL-P2-019 | 接入 Phase 2 节点执行分流 | 后端、工作流 | DSL、兼容性、运行时 | P0 | 待办 | 2026-07-14 | 2026-07-18 | HITL-P2-001、HITL-P2-008、HITL-P2-018 | 按 node version / schema 将新节点路由到 v2 resolver 和新 delivery pipeline。 | 旧 `human-input` 行为不变；新 DSL 走 v2 path；导入旧 DSL 可兼容。 |
| HITL-P2-020 | 实现 Email OTP 后端能力 | 后端、安全 | OTP、Email、安全 | P0 | 待办 | 2026-07-13 | 2026-07-18 | HITL-P2-010、HITL-P2-018 | 实现 OTP 生成、发送、重发、校验、过期和次数限制。 | External、one-time、dynamic Email 提交必须带有效 OTP；错误码稳定。 |
| HITL-P2-021 | 实现原子 first-writer-wins 提交 | 后端、数据库、安全 | 并发、提交 | P0 | 待办 | 2026-07-14 | 2026-07-18 | HITL-P2-008、HITL-P2-020 | 修复现有提交路径不是原子更新的问题。 | 同一 task/form 并发提交只有一个成功；失败方返回已完成状态；单测覆盖 race。 |
| HITL-P2-022 | 扩展 delivery record 状态机 | 后端、工作流、Provider | Delivery、状态机 | P0 | 待办 | 2026-07-14 | 2026-07-18 | HITL-P2-008、HITL-P2-012 | 记录 pending/sent/failed/submitted、provider message id、failure reason、sent_at、submitted_by、channel。 | 现有 Email delivery 写入状态；provider 可复用同一状态机。 |
| HITL-P2-023 | 实现 audit record 写入与脱敏 | 后端、安全 | 审计、脱敏 | P0 | 待办 | 2026-07-15 | 2026-07-18 | HITL-P2-011、HITL-P2-020、HITL-P2-021、HITL-P2-022 | 记录提交、拒绝、校验失败、投递失败等审计事件。 | 能回答谁在什么时候、通过什么身份、用什么 channel 提交或被拒绝；审计不记录完整敏感正文和 secret。 |
| HITL-P2-024 | 实现 Email 必发与最小发送 guardrails | 后端、SaaS、安全 | Email、限流、风控 | P0 | 待办 | 2026-07-15 | 2026-07-18 | HITL-P2-020、HITL-P2-022 | 实现 IM + Email 双发策略、dynamic Email 发送记录和最小限流。 | 有 IM binding 时 IM + Email 双发；无 IM binding 时 Email；发送失败原因可见。 |

### M4 前端核心开发

| 任务编号 | 标题 | 团队 | 标签 | 优先级 | 状态 | 开始日期 | 截止日期 | 依赖 | 描述 | 验收标准 |
|-|-|-|-|-|-|-|-|-|-|-|
| HITL-P2-025 | 实现 Human Roster 前端页面 | 前端 | 前端、Roster、RBAC | P0 | 待办 | 2026-07-13 | 2026-07-19 | HITL-P2-013、HITL-P2-016 | 启用 Roster 的 Human tab，接入 mock 后再切真实 API。 | workspace admin 可管理 Human Roster；成员离开/禁用状态可见且不可新选；普通 member 受限。 |
| HITL-P2-026 | 实现 Contact Directory / IM Integration 前端页面 | 前端、企业版、Provider | 前端、IM、Provider | P0 | 待办 | 2026-07-13 | 2026-07-20 | HITL-P2-013、HITL-P2-017 | 实现 credential 表单、test connection、sync trigger、IM binding 状态和错误态。 | secret 输入不可回显；provider 不可用态可见；mock 和真实 API 字段兼容。 |
| HITL-P2-027 | 实现 HITL 节点 recipient selector v2 | 前端、工作流 | 前端、节点配置、Resolver | P0 | 待办 | 2026-07-13 | 2026-07-20 | HITL-P2-009、HITL-P2-013 | 重做节点收件人选择器，支持新 recipient schema。 | 支持 static contact、external contact、one-time Email、dynamic Email variable chip、current initiator、debug only notify me；保存和回显正确。 |
| HITL-P2-028 | 实现 Notification Policy 配置 UI | 前端、工作流、Provider | 前端、通知策略 | P0 | 待办 | 2026-07-14 | 2026-07-20 | HITL-P2-012、HITL-P2-013、HITL-P2-027 | 实现 Email 必发、IM + Email 双发、fallback 行为和 provider 不可用错误态配置。 | 旧 WebApp / Email 配置兼容显示；新 schema 可保存、回显、导入导出。 |
| HITL-P2-029 | 实现 Web approval OTP 前端 | 前端、安全 | 前端、OTP、审批页 | P0 | 待办 | 2026-07-13 | 2026-07-20 | HITL-P2-010、HITL-P2-013 | 在独立审批页实现 OTP 输入、重发、错误态和提交状态机。 | 支持过期、次数超限、已提交、无权限、提交中、提交成功；移动端可用。 |
| HITL-P2-030 | 实现 Last Run delivery / resolution 展示 | 前端、工作流 | 前端、Last Run | P1 | 待办 | 2026-07-14 | 2026-07-21 | HITL-P2-011、HITL-P2-013 | 在 Last Run 中展示 resolved recipients、投递状态、失败原因和提交人。 | 信息可读且不泄露敏感字段；空态和失败态明确。 |
| HITL-P2-031 | 实现前端 i18n、空态、错误态和基础可访问性 | 前端 | 前端、i18n、可访问性 | P1 | 待办 | 2026-07-17 | 2026-07-21 | HITL-P2-025、HITL-P2-026、HITL-P2-027、HITL-P2-029、HITL-P2-030 | 补齐新增页面和组件的文案、空态、错误态、loading、disabled 和键盘可用性。 | 用户可见文案走 `web/i18n/en-US/`；关键按钮、输入框、错误提示在桌面和移动端不遮挡。 |
| HITL-P2-032 | 前端核心路径 mock smoke | 前端 | 前端、Mock、Smoke | P1 | 待办 | 2026-07-19 | 2026-07-21 | HITL-P2-025、HITL-P2-026、HITL-P2-027、HITL-P2-028、HITL-P2-029、HITL-P2-030 | 使用 mock fixture 跑通主要前端路径，提前暴露 UI 和状态机问题。 | Human Roster、Contact Directory、节点配置、审批页、Last Run 均可在 mock 数据下完成 smoke。 |

### M5 Provider 后端与前端并行开发

| 任务编号 | 标题 | 团队 | 标签 | 优先级 | 状态 | 开始日期 | 截止日期 | 依赖 | 描述 | 验收标准 |
|-|-|-|-|-|-|-|-|-|-|-|
| HITL-P2-033 | 实现 provider adapter runtime 与 mock provider | 后端、Provider | Provider、运行时 | P0 | 待办 | 2026-07-15 | 2026-07-19 | HITL-P2-012、HITL-P2-022、HITL-P2-024 | 实现 provider runtime 基类、mock provider 和 pipeline 单测。 | mock provider 覆盖 credential、sync、send、identity verify、callback、fallback。 |
| HITL-P2-034 | 实现 provider credential 与 callback 安全框架 | 后端、Provider、安全 | Provider、安全、Callback | P0 | 待办 | 2026-07-15 | 2026-07-20 | HITL-P2-017、HITL-P2-033 | 实现 credential 加密/脱敏、callback signature、state、replay 保护。 | 失败写入 delivery status 和 audit；secret 不进日志。 |
| HITL-P2-035 | 实现 Slack 后端 adapter | Provider、后端 | Slack、Provider | P0 | 待办 | 2026-07-16 | 2026-07-22 | HITL-P2-033、HITL-P2-034 | 实现 Slack EE 自建应用与 SaaS OAuth 的 sync、send、verify、callback。 | 两条部署形态 sandbox E2E 通过；delivery status 和 audit 完整。 |
| HITL-P2-036 | 实现 Slack 前端配置与状态 UI | 前端、Provider | Slack、前端、Provider | P1 | 待办 | 2026-07-18 | 2026-07-23 | HITL-P2-026、HITL-P2-028、HITL-P2-035 | 实现 Slack credential / OAuth 状态、test connection、sync 状态和 fallback 文案。 | Slack 配置入口可用；错误态可定位；未配置时节点给出清晰提示。 |
| HITL-P2-037 | 实现钉钉后端 adapter | Provider、后端 | 钉钉、Provider | P0 | 待办 | 2026-07-16 | 2026-07-22 | HITL-P2-033、HITL-P2-034 | 实现 EE 与 SaaS 企业自建应用的 sync、send、callback、identity mapping。 | SaaS 租户接入路径可跑通；Web fallback 和 delivery record 完整。 |
| HITL-P2-038 | 实现钉钉前端配置与状态 UI | 前端、Provider | 钉钉、前端、Provider | P1 | 待办 | 2026-07-18 | 2026-07-23 | HITL-P2-026、HITL-P2-028、HITL-P2-037 | 实现钉钉 credential、test connection、sync 状态、租户配置提示和 fallback 状态。 | 配置步骤与文档一致；错误态和权限不足提示明确。 |
| HITL-P2-039 | 实现飞书 / Lark 后端 adapter | Provider、后端 | 飞书、Lark、Provider | P0 | 待办 | 2026-07-16 | 2026-07-22 | HITL-P2-033、HITL-P2-034 | 实现 EE 自建应用 sync、卡片通知、身份校验、提交回调。 | sandbox E2E 通过；失败回调写入 delivery status。 |
| HITL-P2-040 | 实现飞书 / Lark 前端配置与状态 UI | 前端、Provider | 飞书、Lark、前端 | P1 | 待办 | 2026-07-18 | 2026-07-23 | HITL-P2-026、HITL-P2-028、HITL-P2-039 | 实现飞书 / Lark credential、test connection、sync 状态和 fallback 状态。 | 配置入口、错误态、同步结果展示可用。 |
| HITL-P2-041 | 实现 Microsoft Teams 后端 adapter | Provider、后端 | Teams、Provider | P0 | 待办 | 2026-07-17 | 2026-07-23 | HITL-P2-033、HITL-P2-034 | 实现 Teams App、Adaptive Card 或 fallback message、identity verify、submit callback。 | Teams sandbox E2E 通过；fallback URL 可安全提交。 |
| HITL-P2-042 | 实现 Microsoft Teams 前端配置与状态 UI | 前端、Provider | Teams、前端 | P1 | 待办 | 2026-07-19 | 2026-07-24 | HITL-P2-026、HITL-P2-028、HITL-P2-041 | 实现 Teams credential、test connection、sync 状态和 fallback 状态。 | Teams 配置入口可用；Adaptive Card / fallback 差异展示清楚。 |
| HITL-P2-043 | 实现企业微信后端 adapter | Provider、后端 | 企业微信、Provider | P0 | 待办 | 2026-07-17 | 2026-07-23 | HITL-P2-033、HITL-P2-034 | 实现企业微信 sync、通知、身份校验和 Web fallback。 | 通知 + Web 审批页 E2E 通过；卡片内完整审批不作为硬门禁。 |
| HITL-P2-044 | 实现企业微信前端配置与状态 UI | 前端、Provider | 企业微信、前端 | P1 | 待办 | 2026-07-19 | 2026-07-24 | HITL-P2-026、HITL-P2-028、HITL-P2-043 | 实现企业微信 credential、test connection、sync 状态、有限交互说明和 fallback 状态。 | UI 清楚表达企业微信能力边界；fallback 路径可见。 |
| HITL-P2-045 | Provider readiness gate | Provider、后端、前端、发布 | Provider、Gate、发布 | P0 | 待办 | 2026-07-24 | 2026-07-24 | HITL-P2-035、HITL-P2-036、HITL-P2-037、HITL-P2-038、HITL-P2-039、HITL-P2-040、HITL-P2-041、HITL-P2-042、HITL-P2-043、HITL-P2-044 | 对每个 provider 做 go / fallback / out of scope 判定。 | 未通过 gate 的 provider 从 7.31 ready-to-merge 范围移出或在 UI 中降级；结论同步给 QA 和文档。 |

### M6 前后端联调与前端 RC handoff

| 任务编号 | 标题 | 团队 | 标签 | 优先级 | 状态 | 开始日期 | 截止日期 | 依赖 | 描述 | 验收标准 |
|-|-|-|-|-|-|-|-|-|-|-|
| HITL-P2-046 | Human Roster / Contact Directory 前后端真实接口联调 | 前端、后端 | 联调、Roster、IM | P0 | 待办 | 2026-07-22 | 2026-07-25 | HITL-P2-016、HITL-P2-017、HITL-P2-025、HITL-P2-026 | 将前端 mock 切到真实 API，处理分页、权限、错误码和空态。 | Roster、Contact Directory、IM Integration 主路径在真实环境可用。 |
| HITL-P2-047 | HITL 节点配置与 runtime 前后端联调 | 前端、后端、工作流 | 联调、节点配置、运行时 | P0 | 待办 | 2026-07-22 | 2026-07-25 | HITL-P2-018、HITL-P2-019、HITL-P2-027、HITL-P2-028 | 将节点 recipient selector 和 Notification Policy 接入真实保存、发布、运行流程。 | 新 DSL 保存、回显、导入、发布、运行一致；旧 DSL 不回归。 |
| HITL-P2-048 | Web approval OTP 与提交链路联调 | 前端、后端、安全 | 联调、OTP、审批页 | P0 | 待办 | 2026-07-22 | 2026-07-25 | HITL-P2-020、HITL-P2-021、HITL-P2-029 | 将审批页 OTP、提交、重复提交、过期、错误态接入真实 API。 | Email / fallback 表单在真实环境可安全打开和提交；并发提交只有一个成功。 |
| HITL-P2-049 | Last Run / delivery / audit 联调 | 前端、后端、工作流 | 联调、Last Run、审计 | P1 | 待办 | 2026-07-23 | 2026-07-25 | HITL-P2-022、HITL-P2-023、HITL-P2-030 | 将 Last Run 展示接入真实 delivery / audit 数据。 | resolved recipients、投递状态、失败原因、submitted_by、submitted_at、channel 展示准确且脱敏。 |
| HITL-P2-050 | Provider 配置 UI 与真实 adapter 联调 | 前端、Provider、后端 | 联调、Provider | P0 | 待办 | 2026-07-24 | 2026-07-26 | HITL-P2-045 | 按 gate 结论收敛 provider 配置入口、不可用态、fallback 文案、图标、test connection 和 sync 状态。 | 通过 gate 的 provider UI 可用；未通过 gate 的 provider 隐藏或降级；QA 不会拿到半成品入口。 |
| HITL-P2-051 | 前端 RC 自测与质量门禁 | 前端 | 前端、Smoke、i18n | P0 | 待办 | 2026-07-25 | 2026-07-26 | HITL-P2-046、HITL-P2-047、HITL-P2-048、HITL-P2-049、HITL-P2-050 | 完成前端 smoke、移动端审批页检查、i18n key 检查、loading / empty / error / disabled 状态检查。 | 输出可测 build；`pnpm lint:fix` / `pnpm type-check` 或等价 CI 结果可追溯；关键页面截图或录屏齐备。 |
| HITL-P2-052 | 前端 QA handoff 包 | 前端、QA、发布 | QA、Handoff | P0 | 待办 | 2026-07-26 | 2026-07-26 | HITL-P2-051 | 汇总前端可测范围、feature flag、配置步骤、已知限制、smoke checklist 和关键路径说明。 | QA 可在 2026-07-27 直接接手；handoff 包包含 build、账号/权限要求、provider UI 状态和已知问题。 |

### M7 QA 与发布准备

| 任务编号 | 标题 | 团队 | 标签 | 优先级 | 状态 | 开始日期 | 截止日期 | 依赖 | 描述 | 验收标准 |
|-|-|-|-|-|-|-|-|-|-|-|
| HITL-P2-053 | QA 进场与验收执行统筹 | QA、后端、前端、Provider、安全、发布 | QA、验收 | P0 | 待办 | 2026-07-27 | 2026-07-31 | HITL-P2-024、HITL-P2-045、HITL-P2-052 | QA 同事按 [hitl_phase2_qa_task_list.md](hitl_phase2_qa_task_list.md) 执行测试矩阵，P0/P1 缺陷进入每日 triage。 | 2026-07-28 前形成 RC1 结论；2026-07-31 前补齐测试证据包；P0/P1 为 0 或明确 no-go。 |
| HITL-P2-054 | 完成配置与运维文档 | 文档、Provider、前端、发布 | 文档、运维 | P1 | 待办 | 2026-07-29 | 2026-07-31 | HITL-P2-045、HITL-P2-052、HITL-P2-053 | 完成 provider 配置、SaaS 钉钉自建应用、callback URL、credential 权限、前端 feature flag / 已知限制、migration、回滚文档。 | 文档可由 QA 按步骤复现；已知限制和 fallback 范围清楚。 |
| HITL-P2-055 | 完成 PR 测试证据包 | QA、发布 | QA、发布 | P0 | 待办 | 2026-07-29 | 2026-07-31 | HITL-P2-053 | 汇总 CI、单测、集成测试、provider sandbox、migration dry run、安全测试结果。 | 证据集中到 PR 描述或附件；每个 ready-to-merge 范围内 provider 都有记录。 |
| HITL-P2-056 | 完成 merge readiness review | 发布、后端、前端、安全、Provider | 发布、Review | P0 | 待办 | 2026-07-31 | 2026-07-31 | HITL-P2-054、HITL-P2-055 | 做最终 ready-to-merge review，确认测试、文档、迁移、回滚、安全和配置均就绪。 | 无 P0/P1；CI 通过；回滚方案明确；未通过 gate 的 provider 已移出 scope 或降级。 |

## Stretch / 非阻塞任务

| 任务编号 | 标题 | 团队 | 标签 | 优先级 | 状态 | 开始日期 | 截止日期 | 依赖 | 描述 | 验收标准 |
|-|-|-|-|-|-|-|-|-|-|-|
| HITL-P2-S1 | workspace 级 email service 配置 | 后端、前端、SaaS | Stretch、Email | P3 | 待办 | 2026-07-24 | 2026-07-31 | HITL-P2-024 | 支持 workspace 级 email service 配置，第一期只支持 Resend。 | 仅在 P0 安全和 provider gate 完成后推进；不阻塞 2026-07-31 merge readiness。 |
| HITL-P2-S2 | 企业微信卡片内完整审批 | Provider、前端、后端 | Stretch、企业微信 | P3 | 待办 | 2026-07-24 | 2026-07-31 | HITL-P2-043、HITL-P2-044 | 尝试支持企业微信卡片内完整审批。 | 不作为首发硬门禁；通知 + Web fallback 已通过即可进入 ready-to-merge scope。 |
| HITL-P2-S3 | Provider 自助诊断增强 | Provider、前端 | Stretch、诊断 | P3 | 待办 | 2026-07-24 | 2026-07-31 | HITL-P2-045 | 在 credential test 基础上增加权限缺失、callback URL、sync scope 的诊断提示。 | 不阻塞 merge；作为后续体验增强。 |

## Go / No-go Gate

| 日期 | Gate | Go 条件 | No-go 条件 |
|-|-|-|-|
| 2026-07-13 | 契约冻结 | schema、API contract、mock fixture、provider contract、migration 方案均冻结，前端可以并行开发。 | 前端仍缺 mock / API contract，或后端模型复用边界不清。 |
| 2026-07-18 | Core alpha | 后端 Email-only HITL、Roster、resolver、OTP、原子提交闭环；前端核心页面 mock 主路径跑通。 | 核心模型、OTP、first-writer-wins 或前端主路径仍不可演示。 |
| 2026-07-21 | 前端主路径可联调 | Human Roster、Contact Directory、节点配置、Web approval OTP、Last Run 前端主路径完成。 | 前端仍缺关键页面或状态机，无法接真实 API。 |
| 2026-07-24 | Provider readiness | 纳入首发的 provider 至少完成 sync、send、identity verify、submit/fallback，前端配置入口具备可联调形态。 | 任一 provider 无法同步、发送或校验提交身份，且没有可接受 fallback。 |
| 2026-07-26 | Frontend RC handoff | 前端完成真实接口联调、provider UI 收敛、自测、i18n / type-check 和 QA handoff 包。 | 前端仍缺可测 build、关键页面未联通、provider 降级态不明确、i18n / type-check 未过。 |
| 2026-07-27 | QA entry | QA 同事进场，测试矩阵、环境、账号、provider sandbox、前端 RC build、缺陷 triage 节奏就绪。 | 仍缺可测环境、前端 RC build、关键 provider sandbox、测试账号或 RC 范围。 |
| 2026-07-28 | RC1 | P0/P1 清零；migration dry run、RBAC、安全和核心集成测试通过。 | 存在数据丢失、越权提交、旧 workflow 失效、审计关键字段缺失风险。 |
| 2026-07-31 | Merge readiness | CI、code review、测试证据、迁移说明、配置文档、监控建议、回滚方案、最小限流和发送日志均就绪。 | provider 大面积失败、SaaS abuse guardrail 未生效、审计缺关键字段，或仍有未关闭 P0/P1。 |
