# HITL Phase 2 Schedule Plan

来源 PRD：<https://langgenius.feishu.cn/wiki/GMFdwe40Oi2rC9klP2HcNjnHnwd>  
读取版本：revision 1389  
生成日期：2026-07-09  
目标交付窗口：2026-07-31（PR ready to merge，不要求 SaaS 生产上线）

## 排期结论

7 月底目标调整为代码合并准备就绪，可以按“通用 HITL/Roster/Email 能力先闭环，IM provider adapter 并行接入”的方式推进。关键约束是：2026-07-10 必须冻结 PRD 中仍未定稿的安全、身份、RBAC、provider 能力矩阵和新旧节点策略；2026-07-24 必须完成 provider readiness gate，否则 2026-07-31 只能将已通过 gate 的渠道纳入 ready-to-merge 范围。

## 首发范围

| 部署形态 | 首发 provider | 首发定义 |
|-|-|-|
| EE | Slack、飞书 / Lark、Microsoft Teams、钉钉、企业微信 | 管理后台可配置 provider credential；可发送 HITL 通知；可完成身份校验与提交；支持卡片审批的 provider 优先卡片内提交，不支持时走 Web 审批页 fallback。 |
| SaaS | Slack ISV / OAuth、钉钉企业自建应用 | Slack 走 OAuth 安装；钉钉由 tenant / workspace 配置企业自建应用凭据；均接入统一 HITL task、delivery record、审计和 Email 双发链路。 |

本排期默认 CE 只复用通用 Human Roster、Email、HITL task 和迁移能力，不作为 provider 首发验收门禁。

## 核心假设

| 假设 | 说明 |
|-|-|
| Email 必发 | 与 PRD 保持一致：有 IM binding 时发送 IM + Email；无 IM binding 时发送 Email。 |
| EE 单部署选择一个 IM provider | PRD 中“企业版一期只支持配置一个 IM 渠道”按“每个 EE deployment 同时启用一个 provider”理解；首发清单表示支持的可选 provider 集合。 |
| IM identity 通过手动 IM 同步建立 | 首发需要支持管理员手动触发 IM 同步；同步 scope 是 Organization。EE / CE 中一个部署对应一个 Organization，SaaS 中一个 workspace 对应一个 Organization。 |
| Email recipient 提交时使用 Email OTP | Email 发送的 Web Form URL 沿用现有 token，不新增额外 token；External / one-time / dynamic Email 在提交表单时必须包含 Email OTP。 |
| 企业微信允许降级形态 | PRD 标注企业微信卡片能力有限，首发可按通知 + Web 审批页 fallback 验收，除非产品明确要求企业微信卡片内完整审批。 |

## 已定决策与待确认项

| 决策项 | 状态 / 截止日期 | 影响范围 | 排期处理 |
|-|-|-|-|
| 新节点还是原 Human Input 原地改造 | 已确定 | DSL、迁移、回滚、前端入口、后端 runtime path | 使用新节点和新 DSL 定义；保留旧节点代码和逻辑不变；Workflow 执行时根据 DSL 中的 node version 选择实现。 |
| External / one-time / dynamic Email 鉴权方式 | 已确定 | Email 审批页、OTP、风控、审计 | 使用 Email OTP；现有 Email Web Form URL token 继续用于定位表单，提交表单时必须携带 OTP。 |
| Dynamic Email 是否反查 Account / Contact | 已确定 | recipient resolution、去重、审计、allowed approver | 不反查 Account / Contact，只发送邮件；审计记录变量值、校验结果和邮件投递结果。 |
| Current initiator identity schema | 已确定 | WebApp、Service API、CLI、匿名 session、去重、审计 | WebApp、Service API 和 CLI 都有身份，均可作为 current initiator；匿名 WebApp session 仅在原会话内有效。 |
| RBAC 权限矩阵 | 已确定 | Contact Directory、Human Roster、IM credential、IM binding | 默认 workspace admin 管理 Human Roster；enterprise admin 管理 EE Contact Directory 与 IM Integration。 |
| Provider 能力矩阵 | 已确定 | 卡片审批、fallback URL、IM 身份校验、通讯录同步 | 所有首发 provider 都支持通讯录同步；除企业微信外，其余 provider 基本可映射 Dify HITL 表单页。企业微信按有限交互或 Web fallback 验收。 |
| SaaS abuse guardrails | 已确定 | dynamic Email、发送量、OTP、租户限流、发送日志 | 首发做最小限流和日志记录；有时间则追加 workspace 级 email service 配置，第一期只支持 Resend。 |

## 主排期计划表

| 阶段 | 日期 | 负责方向 | 工作内容 | 交付物 / 验收门禁 |
|-|-|-|-|-|
| 范围冻结 | 2026-07-10 | Product、Backend、Frontend、Security、SaaS | 冻结首发范围、节点策略、Email 鉴权、RBAC、provider 首发定义、provider 能力矩阵。 | PRD delta / decision log 完成；所有 blocker 有 owner 和默认裁决。 |
| 架构与 schema | 2026-07-10 至 2026-07-13 | Backend、Architecture | 确认 Contact、Human Roster、IM Binding、Recipient snapshot、HITL task、Delivery Record、Recipient Resolution Record、Audit Record 的表结构与服务边界。 | Migration 草案、领域对象映射、状态机和回滚策略通过评审。 |
| 契约与 mock handoff | 2026-07-10 至 2026-07-13 | Backend、Frontend、Provider owners | 输出 DSL / DTO / API shape / error code / feature flag / permission matrix / provider mock contract，使前端可不等待后端完整实现就开始开发。 | Human Roster、Contact Directory、IM Integration、recipient selector、OTP、Last Run、provider 状态的 mock response 和接口契约齐备。 |
| 后端核心开发 | 2026-07-13 至 2026-07-18 | Backend | 实现 Roster CRUD、external contact 校验、recipient resolver、dedupe、HITL task 持久化、delivery record、request message template、Email delivery、OTP 和原子提交。 | 单测覆盖 resolver / lifecycle / task transition / 并发提交；Email-only HITL 可端到端运行。 |
| 前端核心开发 | 2026-07-13 至 2026-07-21 | Frontend | 基于 contract / mock 并行实现 Human Roster、Contact Directory / IM Integration、HITL 节点 Notification Policy、recipient selector、dynamic Email chip、one-time Email、debug only notify me、Web approval OTP、Last Run delivery 展示。 | 前端核心页面和状态先以 mock 跑通；节点配置可保存、回显、调试；关键 i18n key、空态、错误态和权限态齐备。 |
| Web approval 与鉴权 | 2026-07-14 至 2026-07-18 | Backend、Frontend、Security | 实现独立审批页、打开页校验、提交二次校验、Email OTP、重复提交处理、错误态文案。 | 外部联系人 / one-time Email / dynamic Email 可安全打开和提交；转发链接不能在无 OTP 时越权提交。 |
| Provider framework | 2026-07-14 至 2026-07-19 | Backend、Provider owners | 抽象 provider adapter、credential model、Organization-scoped IM sync、callback / request URL、test connection、message payload、identity verification、fallback URL。 | Provider contract 冻结；mock provider 和手动同步流程测试通过；Secret 不进入日志。 |
| Provider 后端 adapter | 2026-07-15 至 2026-07-23 | Provider owners、Backend | 并行实现 Slack、钉钉、飞书 / Lark、Teams、企业微信后端接入与通讯录同步。 | 每个 provider 至少完成 credential 保存、Organization-scoped sync、test connection、发送通知、回调 / 提交、失败记录。 |
| Provider 前端配置与状态 UI | 2026-07-18 至 2026-07-24 | Frontend、Provider owners | 并行实现各 provider credential 配置入口、test connection、sync status、provider availability、fallback 文案和错误态。 | 通过 gate 的 provider UI 可用；未通过 gate 的 provider 可隐藏或降级；配置步骤与文档一致。 |
| 前后端 API 联调 | 2026-07-22 至 2026-07-25 | Frontend、Backend、Provider owners | 将前端 mock 替换为真实 API；接入真实 RBAC、feature flag、provider availability、test connection、sync status、OTP 和 Last Run 数据。 | Roster、Contact Directory、节点配置、OTP 页面、Last Run、provider 管理 UI 均可在联调环境跑通。 |
| 日志与审计 | 2026-07-18 至 2026-07-23 | Backend、Frontend | 实现 Last Run delivery 展示、recipient resolution 展示、失败原因、submitted_by、审计数据落库。 | 能回答“通知给谁、是否送达、谁提交、为何允许或拒绝”。 |
| 迁移与兼容 | 2026-07-20 至 2026-07-26 | Backend、Frontend | SaaS / CE workspace member 初始化到 Roster；旧 Email recipient 兼容读取；运行中 task snapshot 不受配置变更影响；输出 dry run 和回滚证据供 QA 进场使用。 | migration dry run 通过；旧 workflow 不失效；回滚路径明确；证据可交给 QA。 |
| 功能冻结 | 2026-07-24 | All | 停止新增功能，只接受 P0/P1 缺陷、安全问题和 provider 兼容修复。 | Provider readiness gate 完成；未通过 provider 从 7 月底 ready-to-merge 范围移出或降级到 fallback。 |
| 前端 RC 稳定与 QA handoff | 2026-07-25 至 2026-07-26 | Frontend、Backend、Provider owners | 收敛 provider 配置入口、fallback 状态、HITL 节点配置、Roster、Contact Directory、Web approval OTP、Last Run 展示；完成前端 smoke、i18n、type-check、已知限制和可测 build。 | 2026-07-26 前交付前端 RC build、feature flag / 配置说明、smoke checklist、关键页面截图或录屏，QA 可在 2026-07-27 接手。 |
| 集成 QA | 2026-07-27 至 2026-07-28 | QA、Backend、Frontend、Provider owners | 覆盖 Roster、Email、Web approval、各 provider、debug、migration、RBAC、异常状态、并发提交。 | RC1 缺陷清零到可接受阈值；所有 P0/P1 关闭。 |
| 安全与 abuse hardening | 2026-07-24 至 2026-07-29 | Security、SaaS、Backend | Email OTP 有效期、重试次数、提交校验、最小限流、发送日志、发送人数限制、dynamic Email 限制、secret redaction、审计敏感字段处理；有时间则补 workspace 级 Resend email service 配置。 | Security sign-off；SaaS guardrail 生效；敏感信息不出日志；Resend 配置不作为 7.31 merge 硬门禁。 |
| Merge readiness | 2026-07-29 至 2026-07-30 | Backend、Frontend、Docs、Product、Security | PR 描述、配置文档、provider 配置指南、迁移说明、回滚方案、监控告警建议、已知限制说明。 | Ready-to-merge review 通过；后续灰度、发布和回滚责任人明确。 |
| Final PR hardening | 2026-07-30 至 2026-07-31 | Backend、Frontend、QA、Provider owners | 处理最后一轮 code review、补齐测试证据、确认 CI、provider sandbox E2E、migration dry run 和安全准入。 | 2026-07-31 达到 PR ready to merge；SaaS 生产上线另行排期。 |

## Provider 并行排期

| Provider | 部署形态 | 日期 | 必须完成 | Provider gate |
|-|-|-|-|-|
| Slack | EE 企业自建应用；SaaS ISV / OAuth | 2026-07-15 至 2026-07-21 | EE 自建应用 credential、SaaS OAuth 安装、Organization-scoped sync、发送 HITL 卡片、获取 Slack 用户身份、卡片提交、Email 双发、delivery record。 | 2026-07-24 前完成 EE 企业自建应用和 SaaS ISV / OAuth 两条 E2E，且同步结果可落到对应 Organization。 |
| 钉钉 | EE 企业自建应用；SaaS 企业自建应用 | 2026-07-15 至 2026-07-22 | EE 与 SaaS tenant / workspace 自建应用凭据配置、Organization-scoped sync、回调校验、发送卡片 / 消息、用户身份映射、Web fallback、delivery record。 | 2026-07-24 前完成 EE 企业自建应用和 SaaS 企业自建应用 E2E；SaaS 需补齐租户接入文档。 |
| 飞书 / Lark | EE 企业自建应用 | 2026-07-16 至 2026-07-22 | 企业自建应用 credential、Organization-scoped sync、回调 / 请求 URL、卡片通知、用户身份校验、提交鉴权、delivery record。 | 2026-07-24 前完成 EE 企业自建应用 E2E。 |
| Microsoft Teams | EE 企业自建应用 | 2026-07-16 至 2026-07-23 | 企业自建 Teams App credential、Organization-scoped sync、Adaptive Card / fallback message、身份校验、提交回调、delivery record。 | 2026-07-24 前完成 EE 企业自建应用 sandbox E2E。 |
| 企业微信 | EE 企业自建应用 | 2026-07-17 至 2026-07-23 | 企业自建应用 credential、Organization-scoped sync、消息发送、身份校验、有限交互或 Web fallback、delivery record、错误态。 | 2026-07-24 前完成 EE 企业自建应用通知 + Web 审批页 E2E；卡片内完整审批不作为硬门禁。 |

## 验收清单

| 类别 | 验收标准 |
|-|-|
| Human Roster | workspace member 初始化、新成员自动进入、成员离开后不可新选、external contact 校验、Dify Account 不误建 external contact。 |
| HITL 节点 | 使用新节点和新 DSL；执行时根据 node version 路由到新旧实现；支持静态 contact、external contact、one-time Email、dynamic Email、current initiator、debug only notify me；配置可保存、导入、回显。 |
| 通知 | Email 必发；有 IM binding 时 IM + Email 双发；部分失败继续，全部不可触达按规则失败；失败原因可见。 |
| 审批与鉴权 | 打开页校验 task 状态；提交页再次校验 task 状态、approver 身份和 Email OTP；重复提交只有一个成功；链接转发不能在无 OTP 时越权提交。 |
| 日志与审计 | 记录 resolved recipients、delivery records、recipient resolution、submitted_by、submitted_at、提交渠道、拒绝 / 失败原因。 |
| Provider | 首发 provider 均通过 Organization-scoped sync、发送、身份校验、提交、失败记录、credential test、回调校验 E2E。 |
| 迁移与兼容 | 旧节点代码和逻辑保持不变；旧 Email recipient 不导致已发布 workflow 失效；运行中 task 使用创建时 snapshot；migration dry run 可回滚。 |
| 安全 | secret 不进日志；Email / IM 正文不完整入审计；Email OTP 有效期、重试次数、提交校验、最小限流和发送日志生效；敏感表单字段有脱敏策略。 |
| Stretch scope | 有时间则支持 workspace 级 email service 配置；第一期只支持 Resend；不作为 2026-07-31 ready-to-merge 硬门禁。 |

## 风险与降级策略

| 风险 | 影响 | 截止点 | 降级策略 |
|-|-|-|-|
| PRD blocker 未在 2026-07-10 冻结 | 后端模型、DSL、鉴权和 RBAC 返工 | 2026-07-10 | 按本文默认裁决推进；延期未冻结项到后续版本。 |
| Provider 能力与预期不一致 | 单个 provider 不能完整映射 Dify HITL 表单页，或身份校验存在限制 | 2026-07-24 | 降级到 request message + Web 审批页；企业微信按有限交互或 Web fallback 验收；仍需通过身份校验。 |
| SaaS 钉钉企业自建应用配置成本高 | SaaS 首发接入和支持成本上升 | 2026-07-22 | ready-to-merge 范围可限定为试点租户路径；配置文档和自检工具先行。 |
| URL 鉴权实现复杂 | Email / fallback 审批安全风险 | 2026-07-18 | 不允许无 OTP 的 Email recipient 提交；未完成安全闭环则该 recipient 类型不进入 ready-to-merge 范围。 |
| RBAC 缺失 | Contact Directory / Roster 泄露跨 workspace 信息 | 2026-07-10 | 默认最小权限：普通 member 不可浏览完整 Roster；workspace admin 管理 workspace；enterprise admin 管理 deployment。 |
| Dynamic Email 滥用 | SaaS 邮件滥发和安全投诉 | 2026-07-12 | merge 前启用最小限流和发送日志；workspace 级 Resend email service 配置作为 stretch scope。 |
| 迁移影响旧 workflow | 线上 workflow 失效或回滚困难 | 2026-07-24 | 不自动改写已发布 DSL；兼容读取优先；旧节点保留运行路径。 |

## Go / No-go 标准

| 日期 | Gate | Go 条件 | No-go 条件 |
|-|-|-|-|
| 2026-07-13 | 契约冻结 | schema、API contract、mock fixture、provider contract、migration 方案均冻结，前端可以并行开发。 | 前端仍缺 mock / API contract，或后端模型复用边界不清。 |
| 2026-07-18 | Core alpha | 后端 Email-only HITL、Roster、task、approval page、OTP 和原子提交端到端跑通；前端核心页面 mock 主路径跑通。 | 核心模型、Email 审批、OTP、first-writer-wins 或前端主路径仍无法闭环。 |
| 2026-07-21 | 前端主路径可联调 | Human Roster、Contact Directory、节点配置、Web approval OTP、Last Run 前端主路径完成。 | 前端仍缺关键页面或状态机，无法接真实 API。 |
| 2026-07-24 | Feature freeze | 所有首发 provider 至少完成 Organization-scoped sync 和 sandbox E2E；前端配置入口具备可联调形态；P0 安全项关闭。 | 任一 provider 无法同步、发送或校验提交身份，且没有可接受 fallback。 |
| 2026-07-26 | Frontend RC handoff | 前端完成 provider 接入收敛、HITL 节点配置、Roster、Contact Directory、OTP 页面、Last Run 展示和 QA handoff 包。 | 前端仍缺可测 build、关键页面未联通、provider 降级态不明确、i18n / type-check 未过。 |
| 2026-07-27 | QA entry | QA 同事进场，测试矩阵、环境、账号、provider sandbox、前端 RC build、缺陷 triage 节奏就绪。 | 仍缺可测环境、前端 RC build、关键 provider sandbox、测试账号或 RC 范围。 |
| 2026-07-28 | RC1 | P0/P1 清零；迁移 dry run 和回滚演练通过。 | 仍有数据丢失、越权提交、旧 workflow 失效风险。 |
| 2026-07-31 | Merge readiness | CI、code review、测试证据、迁移说明、配置文档、监控建议、回滚方案、最小限流和发送日志均就绪。 | provider 大面积失败、SaaS abuse guardrail 未生效、审计缺失关键字段，或仍有未关闭的 P0/P1。 |
