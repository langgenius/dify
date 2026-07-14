## Context

本 change 的输入来源包括：`HITL：IM 通知与 Contact PRD`，以及本 change 讨论过程中的用户澄清。本文件只做领域发现，不提出实现方案；凡是能直接追溯到 PRD 或明确澄清的内容，按“明确事实”记录；凡是需要解释、补缀或推断的内容，一律标记为“未经确认”。

### 1. 业务参与者及其目标

| 参与者 | 目标 | 追溯来源 |
| --- | --- | --- |
| Organization 管理员 | 管理 Organization 级 Contact Directory、配置唯一 IM 渠道、测试连接、查看连接状态；其具体身份随部署形态变化：EE 为企业管理员，在 EE 后台管理；CE / SaaS 为 workspace owner / admin，在 workspace 内管理。 | PRD §5.1、§5.2、§6.2、§18.4；用户澄清 2026-07-13 |
| Workspace 管理员 | 管理当前 workspace 的 Contact、添加 Platform contact 或 External contact、处理成员移除后的联系人去留、配置 workspace IM override | PRD §5.3、§6.5、§7.2、§7.3、§18.2 |
| Workflow editor | 在 HITL 节点中配置静态通知对象、动态邮箱、一次性邮箱、是否允许 current initiator 审批、调试时仅通知自己 | PRD §5.4、§8.1-§8.6、§18.8 |
| Workflow 发起者 / current initiator | 在开启 `Allow Current Initiator to Approve` 且身份可解析时，作为额外审批主体参与审批 | PRD §8.5、§18.6 |
| Workspace contact / Platform contact | 接收通知、在命中 allowed approver 时通过 IM 或 Web 完成审批 | PRD §3.1、§7.4、§9.1-§9.4、§17.3-§17.5 |
| External contact / one-time Email / 未命中 Contact 的 dynamic Email 对象 | 通过 Email 收到请求，并通过 Email OTP 证明邮箱控制权后完成审批 | PRD §7.5、§8.3、§8.4、§9.3、§17.3-§17.5 |
| 审计查询主体（本期为管理后台系统管理员） | 事后回答“通知给了谁、谁打开过、谁提交了、为何允许或拒绝” | PRD §16.1-§16.3 |
| SaaS 团队 / 安全团队 | 为 dynamic Email、OTP、收件人数和发送量确定 abuse guardrails 与敏感信息边界 | PRD §4.1、§14、§16.4、§19 |

### 1.1 本 change 使用的术语边界（文档表达约定）

| 术语 | 在本 change 中的含义 |
| --- | --- |
| `RecipientSpecification` | 节点配置里指定的通知对象来源，例如静态 Contact、one-time Email、dynamic Email、current initiator |
| `ApprovalPrincipal` | 运行时真正被授权的审批主体；这是 allowed approver 的业务主体，不等于 email、IM channel 或 URL token |
| `DeliveryEndpoint` | 某个审批主体在当前 task 中的具体通知落点，例如 email、IM identity、console / web token |
| `IdentityProof` | 打开页面或提交表单时拿出来证明“当前访问者是谁”的证据，例如 Dify 登录态、IM identity、Email OTP |

### 2. PRD 中明确陈述的业务事实

| # | 明确事实 | 追溯来源 |
| --- | --- | --- |
| 1 | 本期 Contact 类型收敛为 `workspace contact`、`Platform contact`、`External contact` 三类。 | PRD §3.1 |
| 2 | 其他 workspace 的 member 不应被视为 external contact，而应视为 Platform contact。 | PRD §3.1、§18.1 |
| 3 | HITL 节点的静态通知对象包含两类：`Contact recipient` 和 `one-time Email`。其中 `Contact recipient` 只从当前 workspace 的 Contact 中选择。 | PRD §3.2、§8.2、§8.4 |
| 4 | CE / SaaS 中当前 workspace 即 Organization；EE 中整个部署内所有 workspace 共同属于同一个 Organization。 | PRD §3.3、§18.4 |
| 5 | External contact 不属于 Dify Account，且只归属当前 workspace。 | PRD §3.4、§18.1 |
| 6 | 本期 external contact 只能通过 Email 触达，且 Email 必填。 | PRD §3.4、§7.5 |
| 7 | 本期一个联系人只支持一个 IM identity，但未来应预留多 IM 并存扩展空间。 | PRD §3.5 |
| 8 | PRD 中的 `Recipient` 是运行时通知 / 审批对象快照类术语，来源可以是 Contact、one-time Email、dynamic Email、current initiator；它不等同于节点配置中的 `RecipientSpecification`。 | PRD §3.6、§18.1；基于本 change 术语边界重述 |
| 9 | SaaS 本期只支持 Slack 的 ISV / OAuth 接入，以及钉钉企业自建应用；其他 SaaS IM ISV 路径不在本期范围。 | PRD §4.1 |
| 10 | CE 在产品层面按“单 workspace”处理：默认只有一个 workspace，不提供多 workspace 产品能力；但在内部业务语义上，仍保留 workspace / tenant 这一层归属，用于复用 SaaS / EE 的 Contact、HITL task、成员关系等规则与模型。 | PRD §4.2、§18.3；基于当前变更内澄清重述 |
| 11 | EE workspace 不默认展示企业全量联系人，需由 workspace admin 从 Organization 添加。 | PRD §4.3、§7.2 |
| 12 | 本期只支持配置一个 Organization 级 IM 渠道；负责管理该渠道的 Organization 管理员身份随部署形态变化：EE 为企业管理员，CE / SaaS 为 workspace owner / admin。 | PRD §6.2、§18.4；用户澄清 2026-07-13 |
| 13 | IM 连接状态至少有 `Not configured`、`Configured`、`Connected`、`Permission issue`、`Callback error`、`Connection error` 六种。 | PRD §6.2 |
| 14 | 一期 IM identity 不采用手工输入 IM user ID，而是基于手动 IM 同步结果，由管理员从同步得到的 IM contact 中进行搜索和选择；搜索需要支持按 IM user ID 查询。 | PRD §6.3、§6.4、§14；用户澄清 2026-07-13、diff comment 2026-07-13 |
| 15 | IM 同步由 Organization 管理员手动触发：IM 配置完成后手动同步，后续如需刷新仍由管理员 / owner 手动发起，不做自动同步。 | PRD §6.4；用户澄清 2026-07-13 |
| 16 | IM 同步时，系统必须先按 IM 平台 user ID 匹配现有联系人；若未命中，再按 Email 匹配当前审批域内可解释的 `Contact / Platform contact`。若两者都未命中，该对象必须进入 unmatched list，等待管理员手动处理；系统不得自动将其创建为 external contact。 | PRD §6.4、§18.7；用户澄清 2026-07-13 |
| 17 | Workspace IM override 只影响当前 workspace 的联系人 IM 身份 / 通知行为，不覆盖 IM Integration 凭据。 | PRD §6.5、§18.4 |
| 18 | Workspace IM override 的运行时优先级高于全局 IM identity，高于 Email fallback。 | PRD §6.5 |
| 19 | external contact 创建、旧 Email recipient 迁移、dynamic Email 匹配和 recipient 去重统一使用“整条 email lower-case 后完全相等”的规则。 | PRD §7.5、§8.3、§11.3、§18.6 |
| 20 | external contact 的创建 / 编辑受 Contact 编辑权限约束；默认只有 owner / admin 可以创建或编辑 Contact，workflow editor 不能直接创建 external contact。 | PRD §7.3、§14、§18.10；用户澄清 2026-07-13 |
| 21 | 普通 member 不能查看完整 Contact，只能访问分配给自己的 HITL task。 | PRD §14、§18.10；用户澄清 2026-07-13 |
| 22 | Dynamic Email 本期只支持 string；array、object、number、boolean 都属于 `unsupported_type`。 | PRD §8.3、§10.3 |
| 23 | Dynamic Email 命中已有 Contact 后，需要升级为 Contact recipient，并按该 Contact 的可通知渠道发送。 | PRD §8.3、§18.6 |
| 24 | Dynamic Email 未命中 Contact 时，作为 one-time Email recipient 发送。 | PRD §8.3 |
| 25 | `Allow Current Initiator to Approve` 默认开启；业务主体类型仍然只有 `workspace user` 和 `end_user` 两类。`Service API` 是受信任调用入口，必须显式提供 `user`，系统会将其物化为 request-scoped `end_user` 并据此参与 current initiator 判断；`CLI` 只有在最终能解析为 `workspace user` 或 `end_user` 时才可用，否则 current initiator 不可用。 | PRD §8.5；用户澄清 2026-07-14 |
| 26 | 调试时开启 `Only notify me during debug` 后，实际通知对象替换为当前调试用户，且不影响正式运行。 | PRD §8.6 |
| 27 | 具备 IM binding 且 Email 可用的 recipient，本期默认并行发送 IM 与 Email，且 Email 不能关闭。 | PRD §9.1 |
| 28 | 同一个 recipient 即使收到 IM + Email，也只对应一个 allowed approver。 | PRD §9.1、§9.4、§18.6 |
| 29 | IM、Email、Web 审批页都必须提供最小任务上下文：App 名称、Workflow 名称、节点名称或请求标题、请求说明、发起人或来源、操作入口、有效期提示、短任务引用。 | PRD §9.2 |
| 30 | 审批页中的文件访问必须同时校验 task 可访问性、访问者身份、allowed approver 命中以及文件所属 task。 | PRD §9.3 |
| 31 | 同一 task 只能成功提交一次，服务端语义是 `first success wins`。 | PRD §9.4 |
| 32 | form / task 状态机只使用 `WAITING`、`SUBMITTED`、`TIMEOUT`、`EXPIRED`；其中 `node timed_out` 对应 `TIMEOUT`，`global expired` 对应 `EXPIRED`。 | PRD §10.1；用户澄清 2026-07-13 |
| 33 | `delivery_failed` 和 `canceled` 不进入 form status，而属于节点结果、workflow 结果或 delivery error reason。 | PRD §10.1、§10.4 |
| 34 | 当 notified recipients 为空且 current initiator 不可用时，节点应直接报错，不创建可等待的 HITL task。 | PRD §10.4 |
| 35 | HITL 节点配置中的静态 `Contact recipient` 存储联系人 ID；`one-time Email` 直接存储在当前节点配置中，不写入 Contact。 | PRD §8.2、§8.4、§11.1 |
| 36 | 导入导出 / DSL ID-Email 转换不在本期范围；本期只保留与兼容性直接相关的迁移。 | PRD §11.2、§15；用户澄清 2026-07-13 |
| 37 | 旧 Email recipient 迁移时，能匹配到当前审批域内 `Contact / Platform contact` 的对象不应迁移为 external contact。 | PRD §11.3、§18.7 |
| 38 | 本期不支持群聊通知，member 审批人的通知中心接口也不进入本期范围。 | PRD §2、§12.0、§12.3、§15；用户澄清 2026-07-13 |
| 39 | HITL 节点继续沿用 `Human Input` 作为节点名称。 | PRD §5.0；用户澄清 2026-07-13 |
| 40 | 成员从 CE / SaaS workspace 被移除时，不转为 external contact，而是遵守 §18.2 的成员移除补充规则。 | PRD §4.2、§18.2；用户澄清 2026-07-13 |
| 41 | 审计日志本期无 UI，只要求后端保留可通过数据库查询的审计数据。 | PRD §16.1、§16.2 |
| 42 | Web 独立页面审批按审批主体鉴权：具备 Dify 登录身份的 workspace contact / Platform contact 走 Dify 登录；不具备 Dify 登录身份的 external contact、one-time Email、未命中 Contact 的 dynamic Email 走 Email OTP。 | PRD §17.3、§17.5 |
| 43 | OTP 规则已明确：10 分钟有效、60 秒重发间隔、单 task 单 recipient 最多 5 次发送、单 OTP 最多 5 次尝试、验证成功即失效。 | PRD §17.5 |
| 44 | external contact 通过 Email 审批时，OTP 验证和表单提交可以在同一个请求里完成，但提交时仍需执行完整的 task 与 allowed approver 校验。 | PRD §17.5；用户澄清 2026-07-13 |
| 45 | task 创建时会冻结 `RecipientSpecification`、`ApprovalPrincipal` 和 `DeliveryEndpoint` 快照，用于历史展示、审计和排错；提交授权仍以提交当时的当前身份链路、Contact 状态和 IM Binding 状态为准，而不是历史 snapshot。 | PRD §17.2、§17.4、§18.9；基于本 change 术语边界重述 |
| 46 | 成员退出 workspace、账号被禁用、external contact 被删除、contact email 被修改、IM Binding 被修改后，历史 snapshot 要保留，但 pending task 的提交权限需要重新校验。 | PRD §18.2、§18.9；用户澄清 2026-07-14 |
| 47 | recipient canonicalization 以 Contact 为中心，同一人从多个来源命中时只保留一个 allowed approver，并保留多来源命中与多渠道投递记录。 | PRD §18.6 |

## Goals / Non-Goals

**Goals:**

- 产出一份只基于 PRD 文本的领域发现结果。
- 区分“明确事实”和“未经确认的假设”。
- 抽出会影响实现边界的冲突、缺口和待决问题。
- 覆盖正常、失败、权限变化、身份变化、重复操作和并发操作场景。

**Non-Goals:**

- 不提出 Entity、Aggregate、Repository、Bounded Context。
- 不讨论数据库、ORM、接口设计和现有代码结构。
- 不根据常见实现方式补齐 PRD 没写明的规则。
- 不替产品、架构、安全团队代做未决决策。

## Decisions

本 change 的关键决策只有两条：

1. 只把 PRD 中有直接文字依据的内容写成“明确事实”。
2. 任何需要解释、补全或跨段推理的结论，都显式标记为“未经确认”。

### 3. 隐含假设，并标记为“未经确认”

| # | 假设 | 为什么是“未经确认” | 追溯来源 |
| --- | --- | --- | --- |
| 1 | raw dynamic Email、form snapshot、submission content 的展示范围和脱敏边界尚未最终确定。 | PRD 明确标注“本期暂不在此处收敛”。 | PRD §16.4 |
| 2 | SaaS abuse guardrails 的具体阈值和触发规则不在本 PRD 内部定义。 | PRD 把该主题留给 SaaS 团队单独确认。 | PRD §4.1、§14、§19 |
| 3 | 跨 workspace Contact 搜索的权限模型只有“拥有 Manage contacts 权限的人可搜索”的粗口径，没有完整权限矩阵。 | PRD 只给出最小口径，未说明更多角色差异。 | PRD §14、§18.10 |

### 4. 相互冲突或语义不完整的需求

| # | 问题 | 冲突 / 缺口说明 | 追溯来源 |
| --- | --- | --- | --- |
| 1 | IM 消息最小上下文与消息内容列表存在张力 | §9.2 前半段要求提供 App、Workflow、节点、来源、有效期等最小上下文；后半段 IM 消息内容列表又把多项具体字段划掉，导致最终消息体边界不清。 | PRD §9.2 |
| 2 | 观测性与隐私边界同时被强调，但边界值未定 | 运行日志要求记录 raw variable value、delivery 结果、submission content；敏感信息处理章节又明确脱敏边界待定。 | PRD §10.5、§16.4 |

### 5. 需要产品或架构人员回答的问题

| # | 问题 | 为什么必须回答 | 追溯来源 |
| --- | --- | --- | --- |
| 1 | IM / Email 中最小任务上下文哪些字段必须展示，哪些可以只在审批页展示？ | 当前 PRD 对“必须提供上下文”和“消息体字段精简”同时给出信号。 | PRD §9.2、§9.3 |
| 2 | raw dynamic Email、form snapshot、submission content 在运行日志、Last Run、数据库审计中的可见范围和保留期是什么？ | 没有这个答案，日志与审计实现会直接碰撞隐私和安全边界。 | PRD §10.5、§16.4 |
| 3 | 跨 workspace Contact 搜索的完整权限矩阵是什么？ | 当前只有“拥有 Manage contacts 权限的人可搜索”的粗粒度说法。 | PRD §14、§18.10 |
| 4 | SaaS abuse guardrails 的具体阈值、拒绝策略和例外流程是什么？ | Dynamic Email、OTP 和多收件人通知都依赖这组限制。 | PRD §4.1、§14、§19 |

### 6. 至少 15 个具体业务场景

| # | 场景 | 类型 | 追溯来源 |
| --- | --- | --- | --- |
| 1 | SaaS / CE 上线后，现有 workspace members 被初始化到 Contact，并在后续新增 member 时自动加入。 | 正常 | PRD §4.1、§4.2、§7.1、§11.4 |
| 2 | EE workspace admin 从 Organization 搜索并多选添加其他 workspace 的 member 进入当前 Contact。 | 正常 / 权限 | PRD §4.3、§7.2、§7.3 |
| 3 | Workspace admin 尝试创建 external contact，但 Email 能匹配到当前审批域内的 Contact / Platform contact，因此创建被拒绝并要求按 Platform contact 处理。 | 失败 / 身份归类 | PRD §7.5、§18.1 |
| 4 | Dynamic Email 变量解析出合法邮箱，且该邮箱命中已有 Contact，于是收件人被升级为 Contact recipient，并按 IM + Email 双渠道发送。 | 正常 / 身份归并 | PRD §8.3、§9.1、§18.6 |
| 5 | Dynamic Email 变量解析出合法邮箱，但未命中任何 Contact，于是它作为 one-time Email recipient 发送。 | 正常 | PRD §8.3、§17.5 |
| 6 | Dynamic Email 变量值不是 string，且没有其他有效 recipient，节点直接报错 `No valid recipients found`。 | 失败 | PRD §8.3、§10.3、§10.4 |
| 7 | Dynamic Email 中一个邮箱非法、另一个邮箱合法；系统跳过非法值并记录日志，但仍为合法 recipient 创建 task。 | 失败 / 部分成功 | PRD §8.3、§10.3、§10.5 |
| 8 | 同一个人同时通过静态 recipient 和 current initiator 命中，系统只保留一个 allowed approver，但在日志中保留两个命中来源。 | 重复操作 / 归并 | PRD §8.5、§18.6 |
| 9 | 同一个 Contact 同时具备 IM binding 和 Email，可并行收到 IM 与 Email；无论从哪个渠道提交，都只完成同一个 task。 | 正常 / 重复渠道 | PRD §9.1、§9.4、§18.6 |
| 10 | Recipient 没有 IM binding 但有 Email，因此只发送 Email。 | 正常 | PRD §9.1 |
| 11 | 所有 recipient 都没有可用通知渠道，且 current initiator 也不可用，节点直接报错而不是创建等待中的 task。 | 失败 | PRD §10.3、§10.4 |
| 12 | Workflow debug 时开启 `Only notify me during debug`，所有原始 recipient 被调试用户替换，但正式运行不受影响。 | 正常 / 调试 | PRD §8.6、§15 |
| 13 | CLI 发起 workflow 时无法解析到 `workspace user` 或 `end_user`，且未配置 notified recipients，于是节点直接报错。 | 失败 / 身份变化 | PRD §8.5、§10.4、§18.6；用户澄清 2026-07-14 |
| 14 | Service API 发起 workflow 时显式提供 `user`，系统将其物化为当前 app 下的 request-scoped `end_user`，并据此参与 current initiator 判断。 | 正常 / 身份变化 | 用户澄清 2026-07-14 |
| 15 | CLI 发起 workflow 时，调用方最终成功解析为 `workspace user` 或 `end_user`，因此 current initiator 可以参与 allowed approver 计算。 | 正常 / 身份变化 | 用户澄清 2026-07-14 |
| 16 | External contact 通过 Email 审批时，可以在同一个请求里完成 OTP 验证和表单提交。 | 正常 / 外部身份 | PRD §9.3、§17.3-§17.5；用户澄清 2026-07-13 |
| 17 | External contact 超过 OTP 重试上限或链接过期，再次尝试提交时被拒绝。 | 失败 | PRD §17.5、§17.6 |
| 18 | Workspace contact 收到任务后，在提交前被移出 workspace；他再次打开或提交时被拒绝。 | 权限变化 / 身份变化 | PRD §17.2、§17.4、§18.2、§18.9 |
| 19 | IM recipient 收到卡片后，其 IM Binding 在提交前被修改；旧 IM identity 再提交时应被拒绝。 | 身份变化 | PRD §17.4、§18.2、§18.9 |
| 20 | EE 管理员移除 workspace member 时不勾选 `Keep as Platform contact`，该联系人从当前 workspace Contact 中移除，后续新节点不可再选择。 | 正常 / 权限变化 | PRD §18.2 |
| 21 | EE 管理员移除 workspace member 时勾选 `Keep as Platform contact`，该联系人继续保留在当前 workspace Contact 中，但类型改为 Platform contact。 | 正常 / 身份变化 | PRD §18.2 |
| 22 | 两个 allowed approver 分别从 IM 和 Email 几乎同时提交同一个 task，第一个成功者完成 task，后到者收到 `This task has already been completed.` | 并发操作 | PRD §9.4、§17.6 |
| 23 | External contact 在 task 创建后被删除，旧 pending task 的旧链接或旧 proof 不再允许继续提交。 | 权限变化 / 身份变化 | PRD §18.2、§18.9；用户澄清 2026-07-14 |
| 24 | External contact 被删除后，又以相同 normalized email 重新创建新的 external contact；新 contact 不继承旧 pending task 的审批授权。 | 权限变化 / 身份变化 | PRD §18.2、§18.9；用户澄清 2026-07-14 |
| 25 | Contact email 在 task 创建后发生变更，旧 email 对应的 OTP、proof 或 link 不能继续作为有效提交凭证。 | 权限变化 / 身份变化 | PRD §18.9；用户澄清 2026-07-14 |

## Risks / Trade-offs

- [消息上下文边界不清] -> 先产出统一“最小任务上下文”清单，再分别映射到 IM、Email 和 Web。
- [跨 workspace Contact 搜索权限矩阵未细化] -> 在进入实现前补齐角色与搜索范围定义，避免把粗粒度权限直接落地成默认行为。
- [敏感信息边界待定] -> 在日志、Last Run 和审计落地前增加安全评审，明确保留期、可见范围和脱敏规则。
- [SaaS abuse guardrails 缺失] -> 在开放 dynamic Email 与 OTP 之前先补齐阈值、告警和拒绝策略，否则容易把运行时风险留到上线后处理。
