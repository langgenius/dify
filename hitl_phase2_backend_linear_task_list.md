# HITL Phase 2 后端 Linear 任务清单

目标：生成后续可同步到 Linear 的后端 issue 列表；本文件只写入本地，不写入 Linear。

## 信息来源

| 来源 | 读取结果 |
|-|-|
| PRD | [HITL：IM 通知与 Contact PRD](https://langgenius.feishu.cn/wiki/GMFdwe40Oi2rC9klP2HcNjnHnwd)，最新读取到 `revision_id = 1959`，读取时间 2026-07-10。 |
| Linear Project | [HITL IM 支持](https://linear.app/dify/project/hitl-im-支持-cd5c0fe0752d)，项目 ID `882439e3-f6f5-4474-9fee-255e11e16c51`，团队 `WTA`。 |
| Linear 里程碑 | `冻结产品文档` 2026-07-10；`确定前后端交互协议及 DSL schema` 2026-07-14；`连调` 2026-07-22；`测试` 2026-07-27。 |
| 现有 Linear issue | `WTA-1255 HITL IM 集成接口及 DSL 设计` 仍为待办；旧 IM 表单消息探索任务大多已取消；`WTA-735 为 Graphon 的 HITL 抽象一套接口` 已完成。 |
| 后端代码基线 | 已有 `human-input` 节点、`HumanInputForm`、`HumanInputDelivery`、`HumanInputFormRecipient`、Email delivery、form token、file upload token、暂停恢复、多 surface 表单提交。Phase 2 应扩展现有模型和运行时，不重复建设基础 HITL。 |

## 拆分原则

1. 只包含后端工作，不包含前端、QA 明细和纯产品任务。
2. 保留 `WTA-1255` 作为已有契约任务，建议更新描述和验收标准，不再新建重复契约 issue。
3. 按 PRD 里程碑和 Linear 现有 milestone 对齐；后端实现类任务归入 `连调`，不放进 `确定前后端交互协议及 DSL schema`。
4. `导入导出 / DSL ID-Email 转换` 已被 PRD 移出本期，不放入本期后端任务。
5. 任务描述以 Linear issue 可直接复制为目标；依赖字段使用本文件临时编号，真正导入 Linear 后再替换为 Linear issue id。

## 里程碑归属口径

| Linear 里程碑 | 后端任务归属 |
|-|-|
| 冻结产品文档 | 只放 PRD / scope / blocker 收敛任务，不放数据模型设计或代码实现。 |
| 确定前后端交互协议及 DSL schema | 只放前后端解耦所需的 DSL schema、API contract、错误码、mock fixture、provider contract。 |
| 连调 | 放后端数据模型、migration、Contact / IM / HITL runtime 实现、provider adapter、审计、Last Run 和安全鉴权等实现任务。 |
| 测试 | 放后端测试支持、migration dry run、provider sandbox 证据、安全回归和 ready-to-test 交付物。 |

## 依赖梳理口径

| 任务类型 | 依赖原则 |
|-|-|
| PRD / scope 收敛 | 不依赖实现任务，用来冻结本期边界和阻塞项。 |
| DSL / API / mock 契约 | 只依赖 PRD / scope 和高层 DSL 决策，不依赖数据库设计、migration 或 runtime 实现。完成后前端可以基于 mock 并行开发。 |
| 数据模型 / migration | 依赖 PRD / scope 和 DSL 决策，属于后端实现前置任务，挂 `连调` milestone。 |
| Runtime / provider / 安全实现 | 依赖数据模型、API contract 和对应基础能力，按可并行方向拆分。 |
| 测试准入 | 依赖核心实现和 provider adapter，输出 dry run、sandbox、安全回归和 ready-to-test 证据。 |

## 建议同步策略

| 本地编号 | Linear 操作 | 说明 |
|-|-|-|
| BE-HITL-001 | 更新现有 `WTA-1255` | 保留已有契约 issue，补齐 DSL、API、错误码、mock、provider contract 的验收口径。 |
| 其他任务 | 新建 issue | 新建在项目 `HITL IM 支持`，团队 `WTA`，按对应 milestone 挂载。 |

## 任务总览

| 本地编号 | 标题 | Linear 操作 | 里程碑 | 优先级 | 截止日期 | 依赖 |
|-|-|-|-|-|-|-|
| BE-HITL-001 | HITL IM 集成接口及 DSL 设计 | 更新 `WTA-1255` | 确定前后端交互协议及 DSL schema | 高 | 2026-07-14 | - |
| BE-HITL-002 | 确认后端范围与 PRD 决策回写差异 | 新建 | 冻结产品文档 | 高 | 2026-07-10 | - |
| BE-HITL-003 | 设计 Contact / IM / HITL 数据模型与迁移方案 | 新建 | 连调 | 高 | 2026-07-14 | BE-HITL-001、BE-HITL-002 |
| BE-HITL-004 | 定义后端 API contract、错误码和 mock fixture | 新建 | 确定前后端交互协议及 DSL schema | 高 | 2026-07-14 | BE-HITL-001、BE-HITL-002 |
| BE-HITL-005 | 实现 Organization / Approval Domain 解析策略 | 新建 | 连调 | 高 | 2026-07-17 | BE-HITL-003 |
| BE-HITL-006 | 实现 Contact Directory / Workspace Contact migration | 新建 | 连调 | 高 | 2026-07-18 | BE-HITL-003、BE-HITL-005 |
| BE-HITL-007 | 实现 Contact / External Contact 管理 API | 新建 | 连调 | 高 | 2026-07-19 | BE-HITL-006 |
| BE-HITL-008 | 实现 IM Binding 与 Workspace IM override 数据层 | 新建 | 连调 | 高 | 2026-07-19 | BE-HITL-003、BE-HITL-006 |
| BE-HITL-009 | 实现 IM Integration credential 与连接状态机 | 新建 | 连调 | 高 | 2026-07-19 | BE-HITL-003、BE-HITL-005 |
| BE-HITL-010 | 实现 IM 通讯录同步与 unmatched list | 新建 | 连调 | 高 | 2026-07-20 | BE-HITL-008、BE-HITL-009 |
| BE-HITL-011 | 扩展 HITL 节点 Notification Policy 与兼容 adapter | 新建 | 连调 | 高 | 2026-07-18 | BE-HITL-001、BE-HITL-004 |
| BE-HITL-012 | 实现 recipient resolver v2 与 Contact-centric 去重 | 新建 | 连调 | 高 | 2026-07-19 | BE-HITL-006、BE-HITL-008、BE-HITL-011 |
| BE-HITL-013 | 扩展 HITL task snapshot、allowed approver 与 resolution records | 新建 | 连调 | 高 | 2026-07-20 | BE-HITL-012 |
| BE-HITL-014 | 实现 Request Message Template 与 Email always-on 发送策略 | 新建 | 连调 | 高 | 2026-07-20 | BE-HITL-011、BE-HITL-013 |
| BE-HITL-015 | 实现 Email OTP 与 Web 独立页鉴权后端 | 新建 | 连调 | 高 | 2026-07-20 | BE-HITL-013、BE-HITL-014 |
| BE-HITL-016 | 实现提交时动态授权与原子提交 | 新建 | 连调 | 高 | 2026-07-20 | BE-HITL-013、BE-HITL-015 |
| BE-HITL-017 |   | 新建 | 连调 | 中 | 2026-07-21 | BE-HITL-016 |
| BE-HITL-018 | 实现 delivery records 状态机与投递失败规则 | 新建 | 连调 | 高 | 2026-07-20 | BE-HITL-013、BE-HITL-014 |
| BE-HITL-019 | 实现审计数据落库与脱敏边界 | 新建 | 连调 | 高 | 2026-07-21 | BE-HITL-013、BE-HITL-016、BE-HITL-018 |
| BE-HITL-020 | 实现 Last Run / Debug 后端日志投影 | 新建 | 连调 | 中 | 2026-07-21 | BE-HITL-012、BE-HITL-018、BE-HITL-019 |
| BE-HITL-021 | 实现节点级错误、warning 和 timeout / expired 分流 | 新建 | 连调 | 高 | 2026-07-21 | BE-HITL-012、BE-HITL-016、BE-HITL-018 |
| BE-HITL-022 | 实现 IM provider runtime、callback 与身份校验框架 | 新建 | 连调 | 高 | 2026-07-20 | BE-HITL-009、BE-HITL-013、BE-HITL-016 |
| BE-HITL-023 | 实现 Slack 后端 adapter | 新建 | 连调 | 高 | 2026-07-22 | BE-HITL-010、BE-HITL-022 |
| BE-HITL-024 | 实现钉钉后端 adapter | 新建 | 连调 | 高 | 2026-07-22 | BE-HITL-010、BE-HITL-022 |
| BE-HITL-025 | 实现飞书 / Lark 后端 adapter | 新建 | 连调 | 高 | 2026-07-22 | BE-HITL-010、BE-HITL-022 |
| BE-HITL-026 | 实现 Microsoft Teams 后端 adapter | 新建 | 连调 | 高 | 2026-07-22 | BE-HITL-010、BE-HITL-022 |
| BE-HITL-027 | 实现企业微信后端 adapter 与 Web fallback | 新建 | 连调 | 中 | 2026-07-22 | BE-HITL-010、BE-HITL-022 |
| BE-HITL-028 | 实现旧 Email recipient 与 SaaS / CE Contact 初始化迁移 | 新建 | 测试 | 高 | 2026-07-24 | BE-HITL-006、BE-HITL-012、BE-HITL-013 |
| BE-HITL-029 | 实现 SaaS abuse guardrails 后端基础能力 | 新建 | 测试 | 高 | 2026-07-24 | BE-HITL-014、BE-HITL-015、BE-HITL-018 |
| BE-HITL-030 | 实现审批人是 member 的通知中心后端接口 | 新建 | 测试 | 中 | 2026-07-25 | BE-HITL-013、BE-HITL-016 |
| BE-HITL-031 | 后端联调支持与测试证据包 | 新建 | 测试 | 高 | 2026-07-27 | BE-HITL-018、BE-HITL-019、BE-HITL-023、BE-HITL-024、BE-HITL-025、BE-HITL-026、BE-HITL-027、BE-HITL-028、BE-HITL-029 |

## Issue 明细

### BE-HITL-001：HITL IM 集成接口及 DSL 设计

| 字段 | 内容 |
|-|-|
| Linear 操作 | 更新现有 `WTA-1255` |
| 团队 | `WTA` |
| 项目 | `HITL IM 支持` |
| 里程碑 | `确定前后端交互协议及 DSL schema` |
| 优先级 | 高 |
| 状态 | 待办 |
| 截止日期 | 2026-07-14 |
| 标签 | backend、contract、dsl、api |
| 描述 | 基于 PRD revision 1959 冻结后端 DSL、API contract、recipient selector、Notification Policy、provider contract、错误码、feature flag 和兼容策略。需要明确旧 `human-input` / 现有 Email delivery / WebApp delivery 如何兼容，避免 Phase 2 重建一套基础 HITL。 |
| 验收标准 | 1. DSL 覆盖 static Contact、one-time Email、dynamic Email、current initiator、debug only notify me、Request Message Template、Notification Policy。<br>2. API contract 覆盖 Contact、IM Integration、IM Binding、Workspace IM override、OTP、Last Run、delivery records。<br>3. 错误码覆盖 dynamic Email 解析异常、无可通知对象、OTP 失败、权限失败、task 已完成或过期。<br>4. 明确旧 published workflow 不自动改写，新旧运行路径分流策略清楚。 |

### BE-HITL-002：确认后端范围与 PRD 决策回写差异

| 字段 | 内容 |
|-|-|
| Linear 操作 | 新建 |
| 团队 | `WTA` |
| 项目 | `HITL IM 支持` |
| 里程碑 | `冻结产品文档` |
| 优先级 | 高 |
| 状态 | 待办 |
| 截止日期 | 2026-07-10 |
| 标签 | backend、prd、scope |
| 描述 | 对 PRD revision 1959 做后端实现范围确认，标出已进入本期、已移出本期、仍需产品或安全确认但不阻塞实现的事项。 |
| 验收标准 | 1. 明确 Workspace IM override 本期做，但不覆盖 IM Integration credential。<br>2. 明确导入导出 / DSL ID-Email 转换移出本期。<br>3. 明确 Web 独立页审批按审批主体鉴权，不再按统一 OTP 或 Magic Link。<br>4. 明确 form/task status 复用 `WAITING / SUBMITTED / TIMEOUT / EXPIRED`。<br>5. 输出后端 scope note，可贴到 `WTA-1255` 或项目文档。 |

### BE-HITL-003：设计 Contact / IM / HITL 数据模型与迁移方案

| 字段 | 内容 |
|-|-|
| Linear 操作 | 新建 |
| 团队 | `WTA` |
| 项目 | `HITL IM 支持` |
| 里程碑 | `连调` |
| 优先级 | 高 |
| 状态 | 待办 |
| 截止日期 | 2026-07-14 |
| 标签 | backend、database、migration |
| 依赖 | BE-HITL-001、BE-HITL-002 |
| 描述 | 设计 Contact Directory、Workspace Contact、External Contact、IM Binding、Workspace IM override、IM Integration credential、recipient snapshot、delivery record、resolution record、audit record 的后端数据模型。需要复用现有 `HumanInputForm`、`HumanInputDelivery`、`HumanInputFormRecipient`，只做必要扩展。 |
| 验收标准 | 1. 表结构、唯一约束、索引、状态枚举和 owner scope 明确。<br>2. CE / SaaS 当前 workspace 即 Organization，EE deployment 为 Organization 的映射清楚。<br>3. Contact 类型覆盖 workspace member、Organization contact、External contact。<br>4. `HumanInputFormRecipient` 明确作为 task recipient snapshot，不被误建模为 Contact。<br>5. migration dry run 与 rollback 方案明确。 |

### BE-HITL-004：定义后端 API contract、错误码和 mock fixture

| 字段 | 内容 |
|-|-|
| Linear 操作 | 新建 |
| 团队 | `WTA` |
| 项目 | `HITL IM 支持` |
| 里程碑 | `确定前后端交互协议及 DSL schema` |
| 优先级 | 高 |
| 状态 | 待办 |
| 截止日期 | 2026-07-14 |
| 标签 | backend、api、contract、mock |
| 依赖 | BE-HITL-001、BE-HITL-002 |
| 描述 | 输出供前端并行开发使用的后端 API contract、response shape、error code、mock response 和 fixture。范围包括 Contact、IM Integration、IM Binding、Workspace override、recipient resolution preview、OTP、Last Run、provider status。 |
| 验收标准 | 1. 前端无需等待真实实现即可基于 mock 开发。<br>2. mock 字段与后续真实 API 保持一致。<br>3. provider connection status 六态可表达：Not configured、Configured、Connected、Permission issue、Callback error、Connection error。<br>4. API 明确权限失败、资源不存在、不可选择、不可提交、OTP 失败、provider 失败的稳定错误码。 |

### BE-HITL-005：实现 Organization / Approval Domain 解析策略

| 字段 | 内容 |
|-|-|
| Linear 操作 | 新建 |
| 团队 | `WTA` |
| 项目 | `HITL IM 支持` |
| 里程碑 | `连调` |
| 优先级 | 高 |
| 状态 | 待办 |
| 截止日期 | 2026-07-17 |
| 标签 | backend、domain、organization |
| 依赖 | BE-HITL-003 |
| 描述 | 实现从 `tenant_id / workspace_id` 到当前 Organization / Contact scope / IM credential scope 的解析策略。代码内部可保留审批域 resolver 边界，但对外使用 PRD 的 Organization / Contact 口径。 |
| 验收标准 | 1. CE / SaaS 使用当前 workspace 作为 Organization。<br>2. EE 使用 deployment 级 Organization，并能解析当前 workspace 的 Contact scope。<br>3. 后续 Contact、IM Integration、recipient resolver 和提交鉴权不直接散落判断部署形态。<br>4. 单测覆盖 CE / SaaS / EE 策略分支。 |

### BE-HITL-006：实现 Contact Directory / Workspace Contact migration

| 字段 | 内容 |
|-|-|
| Linear 操作 | 新建 |
| 团队 | `WTA` |
| 项目 | `HITL IM 支持` |
| 里程碑 | `连调` |
| 优先级 | 高 |
| 状态 | 待办 |
| 截止日期 | 2026-07-18 |
| 标签 | backend、contact、migration |
| 依赖 | BE-HITL-003、BE-HITL-005 |
| 描述 | 实现 Contact Directory 和 Workspace Contact 的持久化与初始化迁移。SaaS / CE workspace members 自动进入 Contact；EE 支持从 Organization Contact 添加到 workspace Contact。 |
| 验收标准 | 1. workspace member 新增后可进入 Contact。<br>2. CE / SaaS 成员移除后从新配置不可选择，历史引用可解释。<br>3. EE 支持 Organization contact 语义，不把其他 workspace 的 Dify member 建成 external contact。<br>4. normalized email 使用完整 email lower-case 后完全相等。<br>5. migration 可重复执行，索引和唯一约束能防止重复联系人。 |

### BE-HITL-007：实现 Contact / External Contact 管理 API

| 字段 | 内容 |
|-|-|
| Linear 操作 | 新建 |
| 团队 | `WTA` |
| 项目 | `HITL IM 支持` |
| 里程碑 | `连调` |
| 优先级 | 高 |
| 状态 | 待办 |
| 截止日期 | 2026-07-19 |
| 标签 | backend、api、contact、rbac |
| 依赖 | BE-HITL-006 |
| 描述 | 实现 Contact 列表、搜索、添加 Dify member、添加 External contact、删除 External contact、状态查询等 API。预留 `Manage contacts` 能力边界。 |
| 验收标准 | 1. 添加 External contact 前必须先按 normalized email 查找可见 Dify Account / Contact，命中时不能创建 external contact。<br>2. workflow editor 不能通过节点配置直接创建 External contact。<br>3. 普通 member 不获得完整 Contact 管理权限。<br>4. 删除 External contact 后新配置不可选择，历史 workflow 和历史 task snapshot 可读。 |

### BE-HITL-008：实现 IM Binding 与 Workspace IM override 数据层

| 字段 | 内容 |
|-|-|
| Linear 操作 | 新建 |
| 团队 | `WTA` |
| 项目 | `HITL IM 支持` |
| 里程碑 | `连调` |
| 优先级 | 高 |
| 状态 | 待办 |
| 截止日期 | 2026-07-19 |
| 标签 | backend、im、binding |
| 依赖 | BE-HITL-003、BE-HITL-006 |
| 描述 | 实现 Organization 全局 IM identity、Workspace IM override 的持久化、查询和解析优先级。Workspace override 只影响当前 workspace 内联系人 IM 身份 / 通知行为，不覆盖 provider credential。 |
| 验收标准 | 1. 运行时优先级为 workspace override > Organization IM identity > Email。<br>2. 同一个联系人在不同 workspace 可有不同 override。<br>3. pending task 提交时必须按当前 IM Binding 动态授权。<br>4. 删除或修改 binding 不破坏历史 snapshot，但会影响 pending task 提交资格。 |

### BE-HITL-009：实现 IM Integration credential 与连接状态机

| 字段 | 内容 |
|-|-|
| Linear 操作 | 新建 |
| 团队 | `WTA` |
| 项目 | `HITL IM 支持` |
| 里程碑 | `连调` |
| 优先级 | 高 |
| 状态 | 待办 |
| 截止日期 | 2026-07-19 |
| 标签 | backend、im、credential、security |
| 依赖 | BE-HITL-003、BE-HITL-005 |
| 描述 | 实现 IM Integration credential 存储、脱敏读取、test connection、connection status 和 reason。凭据归属 Organization，secret 不进入响应、日志、delivery record 或 audit。 |
| 验收标准 | 1. 支持 Not configured、Configured、Connected、Permission issue、Callback error、Connection error。<br>2. 保存凭据后进入 Configured，test connection 成功后进入 Connected。<br>3. 权限不足、callback 校验失败、凭据错误、provider 不可达能写入可排查 reason。<br>4. credential 轮换记录操作日志，旧回调失败可定位。 |

### BE-HITL-010：实现 IM 通讯录同步与 unmatched list

| 字段 | 内容 |
|-|-|
| Linear 操作 | 新建 |
| 团队 | `WTA` |
| 项目 | `HITL IM 支持` |
| 里程碑 | `连调` |
| 优先级 | 高 |
| 状态 | 待办 |
| 截止日期 | 2026-07-20 |
| 标签 | backend、im、sync、contact |
| 依赖 | BE-HITL-008、BE-HITL-009 |
| 描述 | 实现 IM directory sync 服务：从 provider 拉成员，优先按 provider user id 匹配已有 IM Binding，其次按 Email 匹配 Dify Account；未匹配进入 unmatched list，不自动创建 external contact。 |
| 验收标准 | 1. sync 结果包含 matched、created / updated bindings、unmatched、skipped、failed。<br>2. 未匹配 IM 成员不自动创建 external contact。<br>3. 能匹配 Dify Account 的对象不落为 external contact。<br>4. sync 失败可写入 provider status reason 和 audit / operation log。 |

### BE-HITL-011：扩展 HITL 节点 Notification Policy 与兼容 adapter

| 字段 | 内容 |
|-|-|
| Linear 操作 | 新建 |
| 团队 | `WTA` |
| 项目 | `HITL IM 支持` |
| 里程碑 | `连调` |
| 优先级 | 高 |
| 状态 | 待办 |
| 截止日期 | 2026-07-18 |
| 标签 | backend、dsl、workflow |
| 依赖 | BE-HITL-001、BE-HITL-004 |
| 描述 | 扩展现有 `HumanInputNodeData` / adapter，支持 Notification Policy、Notified recipients、dynamic Email、one-time Email、current initiator、debug only notify me、Request Message Template，同时保持旧 `delivery_methods` 兼容读取。 |
| 验收标准 | 1. 新 DSL 可被保存、发布、执行。<br>2. 旧 published workflow 的 `human-input` 不被自动改写。<br>3. 旧 Email / WebApp delivery 继续兼容。<br>4. 新旧 schema adapter 有单测覆盖。 |

### BE-HITL-012：实现 recipient resolver v2 与 Contact-centric 去重

| 字段 | 内容 |
|-|-|
| Linear 操作 | 新建 |
| 团队 | `WTA` |
| 项目 | `HITL IM 支持` |
| 里程碑 | `连调` |
| 优先级 | 高 |
| 状态 | 待办 |
| 截止日期 | 2026-07-19 |
| 标签 | backend、resolver、contact |
| 依赖 | BE-HITL-006、BE-HITL-008、BE-HITL-011 |
| 描述 | 实现 recipient resolver v2，解析 static Contact、one-time Email、dynamic Email、current initiator、debug override，并以 Contact 为中心归并 allowed approver。 |
| 验收标准 | 1. dynamic Email 只支持单个合法 email，不支持数组 / object / number / boolean。<br>2. dynamic Email 命中 Contact 时升级为 Contact recipient；未命中时按 one-time Email。<br>3. 同一个 Dify Account 只生成一个 allowed approver。<br>4. 同一个 normalized email 去重。<br>5. current initiator 与 notified recipients 命中同一人时合并。<br>6. 解析异常覆盖 variable_missing、variable_empty、unsupported_type、invalid_email、duplicated_email、matched_contact_unavailable、recipient_no_available_channel。 |

### BE-HITL-013：扩展 HITL task snapshot、allowed approver 与 resolution records

| 字段 | 内容 |
|-|-|
| Linear 操作 | 新建 |
| 团队 | `WTA` |
| 项目 | `HITL IM 支持` |
| 里程碑 | `连调` |
| 优先级 | 高 |
| 状态 | 待办 |
| 截止日期 | 2026-07-20 |
| 标签 | backend、runtime、database |
| 依赖 | BE-HITL-012 |
| 描述 | 扩展现有 `HumanInputForm` / `HumanInputFormRecipient` 作为 HITL task 和 recipient snapshot 的持久化实现，记录 allowed approvers、matched sources、recipient snapshot、auth requirement 和 recipient resolution records。 |
| 验收标准 | 1. task 创建时冻结 recipient snapshot，用于审计和历史展示。<br>2. snapshot 不作为提交授权的唯一依据。<br>3. resolution record 可用于 Last Run 展示 raw value、status、error code、resolved recipient type。<br>4. 兼容现有 form token 和 recipient token。 |

### BE-HITL-014：实现 Request Message Template 与 Email always-on 发送策略

| 字段 | 内容 |
|-|-|
| Linear 操作 | 新建 |
| 团队 | `WTA` |
| 项目 | `HITL IM 支持` |
| 里程碑 | `连调` |
| 优先级 | 高 |
| 状态 | 待办 |
| 截止日期 | 2026-07-20 |
| 标签 | backend、email、notification |
| 依赖 | BE-HITL-011、BE-HITL-013 |
| 描述 | 将现有 Email delivery 升级为通用 Request Message Template 语义。对于有 IM binding 且 Email 可用的 recipient，默认并行创建 IM 与 Email delivery attempt；Email 本期不可关闭。 |
| 验收标准 | 1. Email 内容包含足够任务上下文：app、workflow、node / request title、message、有效期、短 task reference。<br>2. 有 IM binding 时仍创建 Email delivery attempt。<br>3. 无 IM binding 时 Email 可单独触达。<br>4. Email 发送失败写入 delivery status 和 reason。 |

### BE-HITL-015：实现 Email OTP 与 Web 独立页鉴权后端

| 字段 | 内容 |
|-|-|
| Linear 操作 | 新建 |
| 团队 | `WTA` |
| 项目 | `HITL IM 支持` |
| 里程碑 | `连调` |
| 优先级 | 高 |
| 状态 | 待办 |
| 截止日期 | 2026-07-20 |
| 标签 | backend、security、otp |
| 依赖 | BE-HITL-013、BE-HITL-014 |
| 描述 | 实现 Web 独立审批页的后端鉴权：Dify Account / workspace member / Organization contact 走 Dify 登录；无 Dify Account 的 External contact、one-time Email、未命中 Contact 的 dynamic Email 走 Email OTP。 |
| 验收标准 | 1. OTP 支持发送、重发、校验、过期、次数限制和稳定错误码。<br>2. Email token 只用于定位 task / recipient，不单独代表审批权限。<br>3. 打开页面和提交表单都校验 task 状态、过期时间、allowed approver。<br>4. Magic Link 不作为本期方案。 |

### BE-HITL-016：实现提交时动态授权与原子提交

| 字段 | 内容 |
|-|-|
| Linear 操作 | 新建 |
| 团队 | `WTA` |
| 项目 | `HITL IM 支持` |
| 里程碑 | `连调` |
| 优先级 | 高 |
| 状态 | 待办 |
| 截止日期 | 2026-07-20 |
| 标签 | backend、security、concurrency |
| 依赖 | BE-HITL-013、BE-HITL-015 |
| 描述 | 重构提交路径，提交时按当前 Dify identity、Contact 状态、IM Binding 状态和 allowed approver 动态授权，并将提交更新改为 first-writer-wins 原子更新。 |
| 验收标准 | 1. 成员离开 workspace、Account disabled、External contact 删除、IM Binding 删除或 mismatch 时拒绝 pending task 提交。<br>2. 同一 task 并发提交只有一个成功，其余返回已完成。<br>3. `WAITING -> SUBMITTED` 原子化；`TIMEOUT / EXPIRED / SUBMITTED` 不可再提交。<br>4. 单测覆盖 race、身份不匹配、旧 binding 失效、task 已过期。 |

### BE-HITL-017：补齐文件访问授权与 HITL task 绑定校验

| 字段 | 内容 |
|-|-|
| Linear 操作 | 新建 |
| 团队 | `WTA` |
| 项目 | `HITL IM 支持` |
| 里程碑 | `连调` |
| 优先级 | 中 |
| 状态 | 待办 |
| 截止日期 | 2026-07-21 |
| 标签 | backend、file、security |
| 依赖 | BE-HITL-016 |
| 描述 | 在现有 HITL standalone upload token 基础上补齐审批页文件预览 / 下载授权：不能只依赖 URL token，必须同时校验 task 可访问、访问者身份已验证、访问者命中 allowed approver、文件属于该 HITL task。 |
| 验收标准 | 1. 文件访问在 task submitted / timeout / expired / revoked 后失效或受限。<br>2. 跨 task / 跨 tenant 文件不可访问。<br>3. 失败原因可区分 task expired、not assigned to you、file unavailable。<br>4. 不改变现有 WebApp / Service API 文件上传模型。 |

### BE-HITL-018：实现 delivery records 状态机与投递失败规则

| 字段 | 内容 |
|-|-|
| Linear 操作 | 新建 |
| 团队 | `WTA` |
| 项目 | `HITL IM 支持` |
| 里程碑 | `连调` |
| 优先级 | 高 |
| 状态 | 待办 |
| 截止日期 | 2026-07-20 |
| 标签 | backend、delivery、runtime |
| 依赖 | BE-HITL-013、BE-HITL-014 |
| 描述 | 补齐 per recipient / per channel delivery record。每个 recipient 每个渠道记录 pending、sent、failed、skipped、provider message id、error code、error message、sent_at。 |
| 验收标准 | 1. IM + Email 双发时生成两个 delivery attempt，但只对应同一个 allowed approver。<br>2. delivery_failed 不进入 `HumanInputFormStatus`。<br>3. 全部渠道失败且没有可继续等待入口时，节点失败并记录原因。<br>4. 部分失败时 task 继续等待，Last Run 可展示未通知对象和失败原因。 |

### BE-HITL-019：实现审计数据落库与脱敏边界

| 字段 | 内容 |
|-|-|
| Linear 操作 | 新建 |
| 团队 | `WTA` |
| 项目 | `HITL IM 支持` |
| 里程碑 | `连调` |
| 优先级 | 高 |
| 状态 | 待办 |
| 截止日期 | 2026-07-21 |
| 标签 | backend、audit、security |
| 依赖 | BE-HITL-013、BE-HITL-016、BE-HITL-018 |
| 描述 | 本期不提供审计 UI，但后端必须保留审计相关数据，使管理员可通过数据库查询回答通知对象、投递渠道、身份校验、提交人、提交结果和拒绝原因。 |
| 验收标准 | 1. 记录 task 所属 workspace、app、workflow、workflow run、node。<br>2. 记录运行时通知对象、recipient snapshot、channels、delivery result。<br>3. 记录提交人身份类型、提交渠道、是否为 allowed approver、提交时间和结果。<br>4. 非指定人提交、身份校验失败、成员退出、账号禁用、task 已提交或过期等拒绝事件有记录。<br>5. secret 不入库；Email / IM 正文不完整进入审计；表单敏感内容按策略脱敏或摘要。 |

### BE-HITL-020：实现 Last Run / Debug 后端日志投影

| 字段 | 内容 |
|-|-|
| Linear 操作 | 新建 |
| 团队 | `WTA` |
| 项目 | `HITL IM 支持` |
| 里程碑 | `连调` |
| 优先级 | 中 |
| 状态 | 待办 |
| 截止日期 | 2026-07-21 |
| 标签 | backend、last-run、debug |
| 依赖 | BE-HITL-012、BE-HITL-018、BE-HITL-019 |
| 描述 | 为前端 Last Run / Debug 提供后端数据投影，展示 resolved recipients、dynamic email raw value、delivery channel、sent / failed / skipped、failure reason、submitted_by、submitted_at。 |
| 验收标准 | 1. Last Run API 可展示 recipient resolution records 和 delivery records。<br>2. Debug 变量池没有值时，后端支持手动变量值进入 resolver。<br>3. raw dynamic value 的可见范围与脱敏策略一致。<br>4. 输出结构稳定，可供前端联调。 |

### BE-HITL-021：实现节点级错误、warning 和 timeout / expired 分流

| 字段 | 内容 |
|-|-|
| Linear 操作 | 新建 |
| 团队 | `WTA` |
| 项目 | `HITL IM 支持` |
| 里程碑 | `连调` |
| 优先级 | 高 |
| 状态 | 待办 |
| 截止日期 | 2026-07-21 |
| 标签 | backend、runtime、workflow |
| 依赖 | BE-HITL-012、BE-HITL-016、BE-HITL-018 |
| 描述 | 按 PRD 固化节点执行失败、partial warning、timeout、global expired 的后端行为。form/task status 固定为 WAITING、SUBMITTED、TIMEOUT、EXPIRED。 |
| 验收标准 | 1. notified recipients 为空且 current initiator 不可用时，节点直接失败，不创建等待 task。<br>2. 全部 recipient 无法通知时节点失败。<br>3. 部分 recipient 可通知时 task 继续等待，并记录未通知对象。<br>4. 节点 timeout 进入 timeout handle；global expired 中止 workflow run，不进入 timeout handle。 |

### BE-HITL-022：实现 IM provider runtime、callback 与身份校验框架

| 字段 | 内容 |
|-|-|
| Linear 操作 | 新建 |
| 团队 | `WTA` |
| 项目 | `HITL IM 支持` |
| 里程碑 | `连调` |
| 优先级 | 高 |
| 状态 | 待办 |
| 截止日期 | 2026-07-20 |
| 标签 | backend、provider、im、security |
| 依赖 | BE-HITL-009、BE-HITL-013、BE-HITL-016 |
| 描述 | 实现统一 IM provider runtime：credential resolver、capability matrix、message rendering、callback signature / replay protection、IM identity extraction、card submit、Web fallback URL。 |
| 验收标准 | 1. Provider adapter 具备统一接口：test connection、sync members、send request、verify callback、extract identity、handle submit。<br>2. 支持卡片内审批的 provider 走 IM identity -> IM Binding -> Contact -> allowed approver。<br>3. 不支持卡片内审批时发送 request message + Web 审批页 URL，Web 页面按审批主体鉴权。<br>4. callback 失败写入 delivery / audit reason，secret 不进日志。 |

### BE-HITL-023：实现 Slack 后端 adapter

| 字段 | 内容 |
|-|-|
| Linear 操作 | 新建 |
| 团队 | `WTA` |
| 项目 | `HITL IM 支持` |
| 里程碑 | `连调` |
| 优先级 | 高 |
| 状态 | 待办 |
| 截止日期 | 2026-07-22 |
| 标签 | backend、provider、slack |
| 依赖 | BE-HITL-010、BE-HITL-022 |
| 描述 | 实现 Slack 后端 adapter，覆盖 SaaS Slack ISV / OAuth 和 EE 企业自建 App 的 credential、通讯录同步、消息发送、身份校验、卡片提交、Email 双发记录。 |
| 验收标准 | 1. OAuth / self-built credential 可 test connection。<br>2. sync 可建立或更新 IM Binding。<br>3. Slack card submit 可通过 IM identity 动态授权。<br>4. 失败写入 delivery status、provider reason 和 audit。 |

### BE-HITL-024：实现钉钉后端 adapter

| 字段 | 内容 |
|-|-|
| Linear 操作 | 新建 |
| 团队 | `WTA` |
| 项目 | `HITL IM 支持` |
| 里程碑 | `连调` |
| 优先级 | 高 |
| 状态 | 待办 |
| 截止日期 | 2026-07-22 |
| 标签 | backend、provider、dingtalk |
| 依赖 | BE-HITL-010、BE-HITL-022 |
| 描述 | 实现钉钉后端 adapter，覆盖 SaaS / EE 企业自建应用 credential、通讯录同步、消息发送、callback 校验、用户身份映射和 Web fallback。 |
| 验收标准 | 1. 租户自建应用 credential 可配置并 test connection。<br>2. 通讯录同步不自动创建 external contact。<br>3. 卡片内审批或 fallback URL 均能记录 delivery / audit。<br>4. 权限缺失和 callback error 可定位到 connection status reason。 |

### BE-HITL-025：实现飞书 / Lark 后端 adapter

| 字段 | 内容 |
|-|-|
| Linear 操作 | 新建 |
| 团队 | `WTA` |
| 项目 | `HITL IM 支持` |
| 里程碑 | `连调` |
| 优先级 | 高 |
| 状态 | 待办 |
| 截止日期 | 2026-07-22 |
| 标签 | backend、provider、lark |
| 依赖 | BE-HITL-010、BE-HITL-022 |
| 描述 | 实现飞书 / Lark EE 企业自建 App adapter，覆盖 credential、通讯录同步、卡片通知、身份校验、提交回调和失败记录。 |
| 验收标准 | 1. 企业自建 App 可 test connection。<br>2. 卡片提交按 IM identity 动态授权。<br>3. fallback URL 不被当作 IM 身份链路，按 Web 独立页鉴权。<br>4. sandbox E2E 记录可进入后端测试证据包。 |

### BE-HITL-026：实现 Microsoft Teams 后端 adapter

| 字段 | 内容 |
|-|-|
| Linear 操作 | 新建 |
| 团队 | `WTA` |
| 项目 | `HITL IM 支持` |
| 里程碑 | `连调` |
| 优先级 | 高 |
| 状态 | 待办 |
| 截止日期 | 2026-07-22 |
| 标签 | backend、provider、teams |
| 依赖 | BE-HITL-010、BE-HITL-022 |
| 描述 | 实现 Microsoft Teams EE 企业自建 Teams App adapter，覆盖 credential、成员同步、Adaptive Card 或 fallback message、身份校验、提交回调和 delivery record。 |
| 验收标准 | 1. Teams App credential 可 test connection。<br>2. Adaptive Card 支持的表单路径可提交；不支持时走 Web fallback。<br>3. 身份校验失败、权限不足、callback error 均有稳定 reason。<br>4. sandbox E2E 记录可进入后端测试证据包。 |

### BE-HITL-027：实现企业微信后端 adapter 与 Web fallback

| 字段 | 内容 |
|-|-|
| Linear 操作 | 新建 |
| 团队 | `WTA` |
| 项目 | `HITL IM 支持` |
| 里程碑 | `连调` |
| 优先级 | 中 |
| 状态 | 待办 |
| 截止日期 | 2026-07-22 |
| 标签 | backend、provider、wecom |
| 依赖 | BE-HITL-010、BE-HITL-022 |
| 描述 | 实现企业微信 EE 企业自建应用 adapter。PRD 标注企业微信卡片内审批能力有限，本期以后端通知 + Web 审批页 fallback 为硬门禁，卡片内完整审批不作为必交。 |
| 验收标准 | 1. 企业微信 credential 可 test connection。<br>2. 可发送 request message + Web approval URL。<br>3. Web fallback 按审批主体鉴权，不依赖企业微信身份 fallback。<br>4. 卡片能力限制在 provider capability 中明确表达。 |

### BE-HITL-028：实现旧 Email recipient 与 SaaS / CE Contact 初始化迁移

| 字段 | 内容 |
|-|-|
| Linear 操作 | 新建 |
| 团队 | `WTA` |
| 项目 | `HITL IM 支持` |
| 里程碑 | `测试` |
| 优先级 | 高 |
| 状态 | 待办 |
| 截止日期 | 2026-07-24 |
| 标签 | backend、migration、compatibility |
| 依赖 | BE-HITL-006、BE-HITL-012、BE-HITL-013 |
| 描述 | 实现旧 Email recipient 迁移和 SaaS / CE Contact 初始化迁移。本期不做导入导出 / DSL ID-Email 转换。 |
| 验收标准 | 1. 旧 Email recipient 匹配当前 workspace member 时迁移为 member / Contact recipient。<br>2. 匹配到 Dify Account 但不属于当前 workspace 时，不自动创建 external contact。<br>3. 无法匹配 Dify Account 时保留 one-time Email。<br>4. 不自动改写已发布 workflow；运行中 task 使用创建时 snapshot。<br>5. dry run、rollback 和重复执行有记录。 |

### BE-HITL-029：实现 SaaS abuse guardrails 后端基础能力

| 字段 | 内容 |
|-|-|
| Linear 操作 | 新建 |
| 团队 | `WTA` |
| 项目 | `HITL IM 支持` |
| 里程碑 | `测试` |
| 优先级 | 高 |
| 状态 | 待办 |
| 截止日期 | 2026-07-24 |
| 标签 | backend、saas、security、rate-limit |
| 依赖 | BE-HITL-014、BE-HITL-015、BE-HITL-018 |
| 描述 | PRD 将具体阈值交给 SaaS 团队确认；后端需要先提供可配置的基础 guardrail 能力，覆盖 OTP、dynamic Email、单 task 收件人数、发送量和发送日志。 |
| 验收标准 | 1. OTP 重试、重发、校验失败可限流。<br>2. dynamic Email 发送和单 task recipient 数量有可配置上限入口。<br>3. 发送日志足以支持 abuse 排查。<br>4. 阈值未最终确认时可使用保守默认值或 feature flag，不阻塞后续调整。 |

### BE-HITL-030：实现审批人是 member 的通知中心后端接口

| 字段 | 内容 |
|-|-|
| Linear 操作 | 新建 |
| 团队 | `WTA` |
| 项目 | `HITL IM 支持` |
| 里程碑 | `测试` |
| 优先级 | 中 |
| 状态 | 待办 |
| 截止日期 | 2026-07-25 |
| 标签 | backend、api、notification-center |
| 依赖 | BE-HITL-013、BE-HITL-016 |
| 描述 | 按 PRD Milestone 4 提供“审批人是 member”的最小通知中心后端接口：查询待处理 HITL task、查看 task 状态、提交 task。完整站内通知中心和 CLI 待办能力后续专题讨论。 |
| 验收标准 | 1. 只覆盖 Dify member / workspace member 审批人。<br>2. 查询结果只返回当前登录用户可审批 task。<br>3. 提交仍复用动态授权和原子提交逻辑。<br>4. 不扩展完整 CLI 待办能力。 |

### BE-HITL-031：后端联调支持与测试证据包

| 字段 | 内容 |
|-|-|
| Linear 操作 | 新建 |
| 团队 | `WTA` |
| 项目 | `HITL IM 支持` |
| 里程碑 | `测试` |
| 优先级 | 高 |
| 状态 | 待办 |
| 截止日期 | 2026-07-27 |
| 标签 | backend、test、release |
| 依赖 | BE-HITL-018、BE-HITL-019、BE-HITL-023、BE-HITL-024、BE-HITL-025、BE-HITL-026、BE-HITL-027、BE-HITL-028、BE-HITL-029 |
| 描述 | 整理后端联调环境、provider sandbox、migration dry run、单测 / 集成测试结果、安全回归记录和已知限制，供 2026-07-27 测试 milestone 接手。 |
| 验收标准 | 1. 后端 API contract 与前端联调范围一致。<br>2. 每个纳入范围的 provider 有 sandbox E2E 或明确降级 / out-of-scope 结论。<br>3. migration dry run 和 rollback 记录齐备。<br>4. P0/P1 后端缺陷为 0 或有明确 no-go。<br>5. 测试证据可贴入 PR 描述或 Linear 项目文档。 |

## 不进入本次后端 Linear 清单的事项

| 事项 | 原因 |
|-|-|
| 前端 Contact / IM Integration / HITL 节点配置 / Last Run UI | 用户本次要求只包含后端工作。 |
| QA 具体执行用例 | QA 可以单独维护测试明细；本清单只保留后端测试支持与证据包。 |
| 导入导出 / DSL ID-Email 转换 | PRD revision 1959 明确移出本期 Milestone 4。 |
| 完整站内通知中心和 CLI 待办能力 | PRD 仅建议优先考虑 member 通知中心接口，完整能力后续专题讨论。 |
| SaaS 除 Slack 外的其他 IM ISV / Marketplace 接入 | PRD 非目标；本期 SaaS 仅 Slack ISV / OAuth 与钉钉企业自建应用。 |
