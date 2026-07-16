## Context

本 change 的输入来源包括：`HITL：IM 通知与 Contact PRD`，以及本 change 讨论过程中的用户澄清。本文件只做领域发现，不提出实现方案；凡是能直接追溯到 PRD 或明确澄清的内容，按“明确事实”记录；凡是需要解释、补缀或推断的内容，一律标记为“未经确认”。

### 1. 业务参与者及其目标

| 参与者 | 目标 | 追溯来源 |
| --- | --- | --- |
| Organization 管理员 | 管理 Organization 级 Contact Directory、配置唯一 IM 渠道、测试连接、查看连接状态；其具体身份随部署形态变化：EE 为企业管理员，在 EE 后台管理；CE / SaaS 为 workspace owner / admin，在 workspace 内管理。 | PRD §5.1、§5.2、§6.2、§18.4；用户澄清 2026-07-13 |
| Workspace 管理员 | 管理当前 workspace 的 Contact、添加 organization contact 或 External contact、处理成员移除后的联系人去留、配置 workspace IM override；在 EE 中，从当前 Organization 引入其他 workspace 成员时，该对象会落成为 `Platform contact` | PRD §5.3、§6.5、§7.2、§7.3、§18.2 |
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
| 1 | 本期联系人先按来源区分为 `organization contact` 与 `External contact`；凡属于当前 `Organization` 的成员，对应的联系人都属于 `organization contact`。 | PRD §3.1、§3.3、§18.1；基于当前变更内澄清重述 |
| 2 | `organization contact` 在当前 workspace 内的正式类型是 `workspace contact`；同一 `Organization` 内但不属于当前 workspace 的正式类型是 `Platform contact`。其他 workspace 的 member 不应被视为 `External contact`。 | PRD §3.1、§18.1；基于当前变更内澄清重述 |
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
| 16 | IM 同步时，系统必须先按 IM 平台 user ID 匹配现有联系人；若未命中，再按 Email 匹配当前 `Organization` 内可解释的 `organization contact`。若两者都未命中，该对象必须进入 unmatched list，等待管理员手动处理；系统不得自动将其创建为 `External contact`。 | PRD §6.4、§18.7；用户澄清 2026-07-13、2026-07-16 |
| 17 | Workspace IM override 只影响当前 workspace 的联系人 IM 身份 / 通知行为，不覆盖 IM Integration 凭据。 | PRD §6.5、§18.4 |
| 18 | Workspace IM override 的运行时优先级高于全局 IM identity，高于 Email fallback。 | PRD §6.5 |
| 19 | external contact 创建、旧 Email recipient 迁移、dynamic Email 匹配和 recipient 去重统一使用“整条 email lower-case 后完全相等”的规则。 | PRD §7.5、§8.3、§11.3、§18.6 |
| 20 | external contact 的创建 / 编辑受 Contact 编辑权限约束；默认只有 owner / admin 可以创建或编辑 Contact，workflow editor 不能直接创建 external contact。 | PRD §7.3、§14、§18.10；用户澄清 2026-07-13 |
| 21 | 普通 member 不能查看完整 Contact，只能访问分配给自己的 HITL task。 | PRD §14、§18.10；用户澄清 2026-07-13 |
| 21a | 任何情况下都不允许跨 `Organization` 搜索 Contact。只有 EE 存在 `Platform contact` 搜索场景：owner / admin 可以在同一 `Organization` 内搜索当前 workspace 之外的成员。CE / SaaS 中 `Organization = workspace`，因此不存在 `Platform contact` 搜索。 | 用户澄清 2026-07-16 |
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
| 37 | 旧 Email recipient 迁移时，能匹配到当前 `Organization` 内 `organization contact` 的对象不应迁移为 `External contact`。 | PRD §11.3、§18.7；基于当前变更内澄清重述 |
| 38 | 本期不支持群聊通知，member 审批人的通知中心接口也不进入本期范围。 | PRD §2、§12.0、§12.3、§15；用户澄清 2026-07-13 |
| 39 | HITL 节点继续沿用 `Human Input` 作为节点名称。 | PRD §5.0；用户澄清 2026-07-13 |
| 40 | 成员从 CE / SaaS workspace 被移除时，不转为 external contact，而是遵守 §18.2 的成员移除补充规则。 | PRD §4.2、§18.2；用户澄清 2026-07-13 |
| 41 | 审计日志本期无 UI，只要求后端保留可通过数据库查询的审计数据。 | PRD §16.1、§16.2 |
| 42 | Web 独立页面审批按审批主体鉴权：具备 Dify 登录身份的 `organization contact` 子类，即 `workspace contact` 与 `Platform contact`，走 Dify 登录；不具备 Dify 登录身份的 `External contact`、one-time Email、未命中 Contact 的 dynamic Email 走 Email OTP。 | PRD §17.3、§17.5；基于当前变更内澄清重述 |
| 43 | OTP 规则已明确：10 分钟有效、60 秒重发间隔、单 task 单 recipient 最多 5 次发送、单 OTP 最多 5 次尝试、验证成功即失效。 | PRD §17.5 |
| 44 | external contact 通过 Email 审批时，OTP 验证和表单提交可以在同一个请求里完成，但提交时仍需执行完整的 task 与 allowed approver 校验。 | PRD §17.5；用户澄清 2026-07-13 |
| 45 | task 创建时会冻结 `RecipientSpecification`、`ApprovalPrincipal` 和 `DeliveryEndpoint` 快照，用于历史展示、审计和排错；提交授权仍以提交当时的当前身份链路、Contact 状态和 IM Binding 状态为准，而不是历史 snapshot。 | PRD §17.2、§17.4、§18.9；基于本 change 术语边界重述 |
| 46 | 成员退出 workspace、账号被禁用、external contact 被删除、contact email 被修改、IM Binding 被修改后，历史 snapshot 要保留，但 pending task 的提交权限需要重新校验。 | PRD §18.2、§18.9；用户澄清 2026-07-14 |
| 47 | recipient canonicalization 以 Contact 为中心，同一人从多个来源命中时只保留一个 allowed approver，并保留多来源命中与多渠道投递记录。 | PRD §18.6 |
| 48 | `Message Template` 决定 Email 与 IM fallback message 的文案，以及 fallback link 的呈现方式与位置；具体链接文案遵循 DSL 模板，而不是额外的硬编码字段清单。 | 用户澄清 2026-07-16 |
| 49 | 当 IM provider 可完整映射表单时，IM card 至少需要展示 App 名称、节点名称和渲染后的 `form_content`。 | 用户澄清 2026-07-16 |
| 50 | Web 独立审批页继续完整渲染 `Form Content`，并与现有 standalone form 实现保持一致。 | 用户澄清 2026-07-16 |

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
| 1 | raw dynamic Email、form snapshot、submission content 本期保留原值，不做额外 HITL 级脱敏。产品运行记录面按现有权限原样展示；对应底层存储的直接查询同样可见原值；审计查询面也不额外做 HITL 级脱敏。 | 用户澄清 2026-07-14 | PRD §16.4；用户澄清 2026-07-14 |
| 2 | SaaS abuse guardrails 的具体阈值和触发规则不在本 PRD 内部定义。 | PRD 把该主题留给 SaaS 团队单独确认。 | PRD §4.1、§14、§19 |

### 4. 相互冲突或语义不完整的需求

| # | 问题 | 冲突 / 缺口说明 | 追溯来源 |
| --- | --- | --- | --- |
| 1 | IM / Email / Web 三个展示面的最小上下文在上游 PRD 中仍未完全同步 | 本地已确认规则是：`Message Template` 负责 Email 与 IM fallback 的文案和 fallback link；IM card 至少展示 App 名称、节点名称、渲染后的 `form_content`；Web 独立页继续完整渲染 `Form Content`。当前剩余差异主要是上游 PRD 尚未回写这一口径。 | PRD §9.2、§9.3；用户澄清 2026-07-16 |
| 2 | 观测性与隐私边界同时被强调，但上游 PRD 尚未回写已确认口径 | 本地已确认运行记录、底层直接查询和审计查询都保留原值，不做额外 HITL 级脱敏；当前差异只剩上游 PRD 尚未同步。 | PRD §10.5、§16.4 |

### 5. 需要产品或架构人员回答的问题

| # | 问题 | 为什么必须回答 | 追溯来源 |
| --- | --- | --- | --- |
| 4 | SaaS abuse guardrails 的具体阈值、拒绝策略和例外流程是什么？ | Dynamic Email、OTP 和多收件人通知都依赖这组限制。 | PRD §4.1、§14、§19 |

### 6. 至少 15 个具体业务场景

| # | 场景 | 类型 | 追溯来源 |
| --- | --- | --- | --- |
| 1 | SaaS / CE 上线后，现有 workspace members 被初始化到 Contact，并在后续新增 member 时自动加入。 | 正常 | PRD §4.1、§4.2、§7.1、§11.4 |
| 2 | EE workspace admin 从 Organization 搜索并多选添加其他 workspace 的 member 进入当前 Contact。 | 正常 / 权限 | PRD §4.3、§7.2、§7.3 |
| 3 | Workspace admin 尝试创建 `External contact`，但 Email 能匹配到当前 `Organization` 内的 `organization contact`，因此创建被拒绝；若该对象不在当前 workspace，则应按 `Platform contact` 处理。 | 失败 / 身份归类 | PRD §7.5、§18.1；基于当前变更内澄清重述 |
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

- [Message Template / IM card / Web 三个展示面实现不一致] -> 在实现层共享一套 surface mapping 规则，确保 DSL 模板、IM card 最小字段和 Web 完整 `Form Content` 不发生语义漂移。
- [Platform contact 搜索边界被误放大] -> 将搜索入口硬性限制为 EE owner / admin 且只限同一 Organization；任何部署形态都不允许跨 Organization 搜索；CE / SaaS 不存在 Platform contact 搜索。
- [敏感信息边界待定] -> 在日志、Last Run 和审计落地前增加安全评审，明确保留期、可见范围和脱敏规则。
- [SaaS abuse guardrails 缺失] -> 在开放 dynamic Email 与 OTP 之前先补齐阈值、告警和拒绝策略，否则容易把运行时风险留到上线后处理。

## 7. 将确认规则拆成实现 backlog

本节只把已确认的业务规则拆成实现工作单元与退出条件，不引入实体、表结构、接口或模块设计。任何仍依赖第 5 节待决问题的事项，都显式保留 blocker。

### 7.1 `contact-directory-governance` backlog

| Backlog ID | 工作单元 | 覆盖规则 | 退出条件 | 依赖 |
| --- | --- | --- | --- | --- |
| `CDG-1` | 联系人分类与审批域作用域收敛 | `organization contact` 与 `External contact` 的来源边界，以及 `workspace contact` / `Platform contact` 作为 `organization contact` 子类的分类规则；CE / SaaS / EE 作用域差异 | 新增与编辑流程都能区分 `organization contact` 与 `External contact`，并在 `organization contact` 内正确落成 `workspace contact` 或 `Platform contact` | 无 |
| `CDG-2` | 成员生命周期与 pending task 重校验 | 成员移除、保留为 `Platform contact`、账号禁用 / 删除、历史 snapshot 保留 | 新配置选择资格和 pending task 提交资格均按当前成员状态重算，历史展示与审计仍能回溯 | 无 |
| `CDG-3` | IM Integration 归属、workspace override 与优先级 | Organization 级唯一 IM channel、部署形态差异、workspace override 优先级 | Organization 级凭据与 workspace override 职责边界固定，运行时优先级可验证为 override > global identity > email fallback | 无 |
| `CDG-4` | 手动 IM sync 与 unmatched 处理 | 手动同步、按 IM user ID / email 匹配、unmatched list、禁止自动 external contact | IM identity 只能从同步结果中选择；未命中对象进入 unmatched list；系统不会自动创建 `External contact` | 无 |
| `CDG-5` | Contact 编辑权限、可见性与 Platform contact 搜索限制 | owner / admin 可编辑、workflow editor 禁止创建 external contact、member 不可浏览完整 Contact、仅 EE owner / admin 可搜索 `Platform contact`、任何部署都禁止跨 Organization 搜索 | Contact 管理入口、workflow 配置入口、普通 member 访问入口和 `Platform contact` 搜索入口都遵守同一权限边界 | 无 |

### 7.2 `hitl-recipient-resolution` backlog

| Backlog ID | 工作单元 | 覆盖规则 | 退出条件 | 依赖 |
| --- | --- | --- | --- | --- |
| `HRR-1` | `RecipientSpecification` 配置边界固化 | 静态 Contact recipient、one-time Email、dynamic Email、current initiator 的配置态边界 | 节点配置只保存 specification，不把 delivery endpoint 或 proof 混进配置层 | 无 |
| `HRR-2` | Dynamic Email 校验、canonicalization 与 Contact 升级 | string-only、normalized email、命中 Contact 升级、未命中走 one-time Email、非法值记录失败原因 | 运行时先校验再匹配 Contact，并对每个失败值留下可审计原因 | `Q-4` |
| `HRR-3` | `ApprovalPrincipal` 归并与多来源命中记录 | static recipient、dynamic Email、current initiator、多渠道投递 | 同一人从多个来源命中时只保留一个 canonical principal，同时保留 source hit 和 delivery records | 无 |
| `HRR-4` | 双渠道默认通知与无渠道失败 | IM + Email 并发发送、Email 必发、无可用渠道 fail fast | 有 IM binding 且有 email 的对象默认双发；所有 recipient 都无渠道时节点直接失败 | `Q-4` |
| `HRR-5` | Debug-only recipient override 与无通知对象错误 | `Only notify me during debug`、`No notified recipients available` | 调试运行只影响 debug session；正式运行配置不被改写；空 recipient 场景有确定错误 | 无 |

### 7.3 `hitl-approval-access-control` backlog

| Backlog ID | 工作单元 | 覆盖规则 | 退出条件 | 依赖 |
| --- | --- | --- | --- | --- |
| `HAC-1` | current initiator 解析与业务主体收敛 | WebApp、Service API request-scoped `end_user`、CLI resolvable / unavailable | current initiator 只能落在 `workspace user` 或 `end_user`，且 Service API / CLI 不会产生第三种主体 | 无 |
| `HAC-2` | 审批鉴权链路按主体类型分流 | Dify 登录、Email OTP、IM identity 映射 | Web / IM / Email 三条鉴权链路都基于当前主体类型重校验，而不是历史 link | 无 |
| `HAC-3` | snapshot 保留与当前状态重校验 | task snapshot、成员状态变化、contact email 变化、IM binding 变化 | 打开页面与提交表单都按当前 task / identity / contact 状态判定，snapshot 仅用于展示与审计 | 无 |
| `HAC-4` | 并发提交的单次成功语义 | `first success wins`、后到请求返回已完成 | 多渠道、多入口并发提交下只有一个请求能成功完成 task | 无 |
| `HAC-5` | 审计最小事实与拒绝原因保留 | 通知对象、delivery attempt、访问尝试、身份校验结果、拒绝原因 | 审计数据足以回答“通知给了谁、谁访问过、谁提交了、为什么被拒绝” | `Q-2` |

## 8. 术语边界的实现约束

第 1.1 节给出了术语定义；本节把这些定义转成实现时必须遵守的边界，避免后续把四类对象混成一个数据结构。

| 概念 | 创建时机 | 必须承载的信息 | 明确不能承载的信息 | 主要用途 |
| --- | --- | --- | --- | --- |
| `RecipientSpecification` | workflow editor 保存节点配置时 | 静态 Contact 引用、one-time Email、dynamic Email 表达式、`Allow Current Initiator to Approve` 这类配置态来源 | 运行时匹配出的 principal、具体 delivery channel、任何一次性的 OTP / link proof | 作为节点配置的输入，供 task 创建时解析 |
| `ApprovalPrincipal` | task 创建时解析 recipient 后 | 当前 task 中真正被授权的业务主体、canonical key、命中来源列表 | 历史 IM card token、Email OTP、裸 URL token | 作为 allowed approver 的唯一业务主体和并发判重单位 |
| `DeliveryEndpoint` | task 创建并决定投递渠道时 | 某个 principal 的 email、IM identity、web link 等具体通知落点，以及每次 delivery attempt 的结果 | 是否拥有审批权的最终判断、可替代 identity proof 的永久凭证 | 驱动 IM / Email / Web 投递和事后排错 |
| `IdentityProof` | 打开审批页或提交审批时 | Dify 登录态、当前 IM identity、Email OTP 验证结果等“当前是谁”的证据 | task 创建时的 snapshot、静态 recipient 配置、单独等价于 allowed approver 的业务主体 | 参与当前时刻的访问控制与提交鉴权 |

实现约束如下：

1. `RecipientSpecification` 到 `ApprovalPrincipal` 的转换只能发生在 task 创建或重新解析 recipient 的业务流程里，不能在保存节点配置时偷跑。
2. `DeliveryEndpoint` 可以一对多挂在一个 `ApprovalPrincipal` 下，但 `ApprovalPrincipal` 不能因为多渠道投递而被复制。
3. `IdentityProof` 只能证明“当前访问者是谁”，不能绕过 `ApprovalPrincipal` 与 task 当前状态校验。
4. 历史 snapshot 可以引用旧的 `RecipientSpecification` / `ApprovalPrincipal` / `DeliveryEndpoint`，但它们都不能单独授予新的提交权限。

## 9. 联系人变化对 pending task 的影响真值表

| 变化事件 | 历史 snapshot 保留 | 旧链接 / 旧页面可继续打开 | 旧 proof 可继续提交 | 新节点还能继续选择 | 说明 |
| --- | --- | --- | --- | --- | --- |
| SaaS / CE 成员被移出 workspace | 是 | 否 | 否 | 否 | 失去当前 workspace 成员资格后，pending task 与新配置都必须按当前成员状态拒绝 |
| EE 成员被移出 workspace 且勾选 `Keep as Platform contact` | 是 | 是，但需重新鉴权 | 是，但需重新命中当前 `Platform contact` 身份 | 是，类型变为 `Platform contact` | 该变化不是删除主体，而是切换 Contact 类型；旧 snapshot 保留，当前授权按最新类型重算 |
| Dify Account 被禁用或删除 | 是 | 否 | 否 | 否 | 禁用 / 删除后不再具备有效登录主体，pending task 与新配置都要失效 |
| external contact 被删除 | 是 | 否 | 否 | 否 | 旧的 email proof 或 link 不能替代当前 contact 存在性 |
| 删除后以相同 normalized email 重建 external contact | 是 | 否 | 否 | 是，作为新 contact | 新 contact 不继承旧 pending task 授权，必须作为新主体处理 |
| contact email 变更 | 是 | 可以打开历史页面，但必须重新走当前 email 身份校验 | 否 | 是，后续通知使用新 email | 旧 email 对应的 OTP、proof、link 均失效；后续只能按当前有效 email 身份继续 |
| IM Binding 修改 | 是 | 可以打开历史页面，但 IM 卡片提交需映射到当前 binding | 否 | 是，后续通知使用新 binding | 历史 delivery record 保留，但旧 IM identity 不能继续提交 |

## 10. 首批验收用例编组

以下用例是进入实现前优先拉通的第一批验收集，用于覆盖 `tasks.md` 4.2 要求的高风险场景。

| Batch ID | 场景 | 覆盖能力域 | 主要 owner | 验收重点 |
| --- | --- | --- | --- | --- |
| `A-1` | 手动 IM sync 后才能选择 IM identity，未命中对象进入 unmatched list | `contact-directory-governance` | Product + Backend Contact | 不允许自由文本 IM user ID；未命中对象不会自动变成 `External contact` |
| `A-2` | workflow editor 无法创建 external contact，普通 member 无法浏览完整 Contact | `contact-directory-governance` | Backend Contact + Web Console | Contact 编辑权限与可见性限制在所有入口一致生效 |
| `A-3` | Service API 显式提供 `user` 时，current initiator 物化为 request-scoped `end_user` | `hitl-approval-access-control` | Backend HITL Runtime | 不回退到 API token 持有者身份；allowed approver 基于 request-scoped `end_user` 计算 |
| `A-4` | CLI 无法解析为 `workspace user` / `end_user` 且无其他 recipient 时，节点直接失败 | `hitl-approval-access-control` | Backend HITL Runtime | current initiator unavailable 时不会创建等待中的 task |
| `A-5` | external contact 在同一请求里完成 OTP 验证与表单提交 | `hitl-approval-access-control` | Backend HITL Runtime + Web Approval | OTP 验证成功后仍要继续做 allowed approver 与 task 状态校验 |
| `A-6` | external contact 删除后，旧 pending task 链接与 proof 失效 | `hitl-approval-access-control` | Backend HITL Runtime | 历史 snapshot 保留，但删除后的主体不能继续打开或提交旧 task |
| `A-7` | 以相同 normalized email 重建 external contact，不继承旧 pending task 授权 | `hitl-approval-access-control` | Backend HITL Runtime | 新旧 contact 身份严格隔离，旧 task 不会被新 contact 接管 |
| `A-8` | contact email 变更后，旧 email proof / OTP / link 失效 | `hitl-approval-access-control` | Backend HITL Runtime + Security | 当前有效 email 成为唯一可用的 Email proof 来源 |
| `A-9` | IM 与 Email 并发提交同一 task，后到请求收到已完成提示 | `hitl-approval-access-control` | Backend HITL Runtime + QA | `first success wins` 在双渠道并发下稳定成立 |

## 11. 上游 PRD 冲突决策矩阵

本节只记录“上游 PRD 当前写法”与“本地 domain discovery 结论”之间的冲突或错位，用于用户决策。它不是回写动作，也不替代上游 PRD。

| 冲突 ID | 上游 PRD 当前口径 | 本地 domain discovery 结论 | 若不决策的风险 | 需要谁拍板 |
| --- | --- | --- | --- | --- |
| `C-1` | `5.0` 仍写“对现有 `Human Input` 节点进行原地改造”，且围绕旧节点升级描述迁移与兼容 | 用户已裁决：代码实现层面使用新节点与新 DSL；产品 UI 层面不同时展示新旧节点，继续沿用 `Human Input` 命名。迁移策略为：不含 HITLv1 的 workflow 只能添加 HITLv2；含 HITLv1 的 workflow 允许继续编辑和添加 HITLv1；提供 v1 -> v2 升级能力；CE / EE 提供批量迁移脚本；legacy 可见性 flag 仅作为可选后续项 | 若本地材料不统一到“双层口径”，节点策略、DSL、迁移、回滚和前后端入口仍会被误读成单一叙事 | 已由用户拍板，后续只需保持本地材料一致 |
| `C-2` | `6.3` 仍保留“具体参数待确定”，没有把 IM identity 明确收敛到“手动 IM sync 结果中搜索选择” | 用户已确认本地结论成立：一期不允许自由文本 IM user ID；只能从手动 sync 结果中搜索选择，且搜索至少支持 IM user ID。当前剩余差异仅是上游 PRD 尚未更新 | 若后续本地材料回退到“自由输入”，管理后台、workspace Contact、provider sync 与审计会再次分叉 | 已由用户拍板，本地保持一致即可 |
| `C-3` | `8.5` 虽补了 API / CLI initiator 说明，但仍停留在“若调用方有明确身份”这类宽口径 | 用户已裁决为 4 条明确规则：`Service API` 必须显式提供 `user`；该 `user` 物化为 request-scoped `end_user`；`CLI` 只有在可解析为 `workspace user` / `end_user` 时 initiator 才可用；若 initiator 不可用且无其他 recipients，节点直接报错。审批主体仍只有 `workspace user` 与 `end_user` 两类 | 若本地材料不按四条规则统一，recipient canonicalization、审计、无 recipient 报错路径仍会各自发明 caller identity 规则 | 已由用户拍板，后续只需保持本地材料一致 |
| `C-4` | `12.3` 仍写“可优先考虑提供审批人是 member 的通知中心接口” | 用户已裁决：通知中心不进入本期；完整站内通知中心与 CLI 待办后续专题讨论 | 若本地范围说明不收口，里程碑、后端 issue 拆分与 QA 范围会继续把通知中心误当成本期 deliverable | 已由用户拍板，后续只需保持本地材料一致 |
| `C-5` | `18.10` 只有粗粒度 `Manage contacts` 口径，尚未固定最小可交付权限边界 | 用户已接受本地最小权限口径：owner / admin 默认可编辑 Contact；workflow editor 不能直接创建 `External contact`；regular member 不能查看完整 Contact；任何部署都禁止跨 `Organization` 搜索；只有 EE 存在 `Platform contact` 搜索，且仅开放给 owner / admin | 若本地材料不保持一致，Contact 管理、节点配置、member 访问和 `Platform contact` 搜索范围会继续在实现层临时裁剪 | 已由用户拍板，后续只需保持本地材料一致 |
| `C-6` | `18.2` / `4.2` 仍保留 “member 离开后是否转 external contact” 的历史痕迹与分支文案 | 用户已裁决：removed member 不自动转 external contact；新的 HITL 节点配置不能再选择该成员；历史 workflow 引用与 task snapshot 保留；所有 pending task 在打开页面和提交表单时都必须重新校验当前 membership 与审批资格；若该成员已不属于当前 workspace，则旧 pending task 不允许继续审批或提交 | 若本地材料不统一到这套生命周期口径，审计解释和 pending task submit authorization 仍会在“内部成员”与“外部邮箱对象”之间混淆 | 已由用户拍板，后续只需保持本地材料一致 |

推荐的最小决策顺序：

1. `C-1`、`C-2`、`C-3`、`C-4`、`C-5` 已由用户裁决；本地材料应统一按这些结论更新。
2. 当前本地冲突矩阵里的 `C-1` 到 `C-6` 都已由用户拍板；剩余未决项集中在外部 owner 确认，而不是本地规则分歧。

## 12. 走查清单（4.1 预组织）

本节把 `4.1` 需要的 cross-functional walkthrough 预先组织成 checklist。它不代表已经完成走查，只是把“谁需要确认什么”压缩成最少列表，便于用户逐项决策。

| 走查项 | 关联规则 / 场景 | 主要 owner | 当前状态 | 需要确认的最小问题 |
| --- | --- | --- | --- | --- |
| `R-1` 通知与审批展示面规则 | 事实 `#29/#48/#49/#50`、场景 `4/9/10/16` | Product + Design | `confirmed_by_user_pending_material_sync` | 已确认：`Message Template` 决定 Email 与 IM fallback 的文案和 fallback link；IM card 至少展示 App 名称、节点名称、渲染后的 `form_content`；Web 独立页继续完整渲染 `Form Content` 并保持现有实现一致 |
| `R-2` 敏感信息可见范围 | `Q-2`、冲突 `#2`、`A-5/A-6/A-8` | Security + Backend | `confirmed_by_user_pending_upstream_sync` | 已确认：对 `raw dynamic Email`、`form snapshot`、`submission content`，本期保留原值，不做额外 HITL 级脱敏。产品运行记录面按现有权限原样展示；对应底层存储的直接查询同样可见原值；审计查询面也不额外做 HITL 级脱敏 |
| `R-3` Contact 最小权限边界 | `CDG-5`、`A-2`、事实 `#21a`、冲突 `C-5` | Product + RBAC | `confirmed_by_user_pending_material_sync` | 已接受：owner / admin 可编辑 Contact；workflow editor 不能建 `External contact`；regular member 不能看完整 Contact；任何部署都禁止跨 `Organization` 搜索；只有 EE owner / admin 可搜索 `Platform contact`；CE / SaaS 因 `Organization = workspace` 不存在 `Platform contact` 搜索 |
| `R-4` 手动 IM sync 与 IM identity 选择 | `CDG-4`、`A-1`、冲突 `C-2` | Product + Admin Console | `confirmed_by_user_pending_upstream_sync` | 已接受“手动 sync + 从 sync 结果搜索选择 IM identity + 禁止自由文本 IM user ID”；上游 PRD 尚未更新 |
| `R-5` Current initiator 主体模型 | `HAC-1`、`A-3/A-4`、冲突 `C-3` | Product + Architecture | `confirmed_by_user_pending_upstream_sync` | 已接受四条明确规则：Service API 显式 `user`、物化为 request-scoped `end_user`、CLI 仅在可解析时可用、无 initiator 且无 recipients 直接报错 |
| `R-6` removed member 生命周期 | `CDG-2`、真值表 `§9`、冲突 `C-6` | Product + Architecture | `confirmed_by_user_pending_upstream_sync` | 已接受：removed member 不自动转 external contact；新配置不可再选择；历史 workflow 引用与 task snapshot 保留；所有 pending task 在打开页面和提交表单时重新校验 membership 与审批资格；若该成员已不属于当前 workspace，则旧 pending task 不允许继续审批或提交 |
| `R-7` 通知中心范围 | 冲突 `C-4`、PRD `12.3` | Product | `confirmed_by_user_pending_upstream_sync` | 已确认本期完全移出 member 通知中心接口、完整站内通知中心和 CLI 待办能力 |
| `R-8` 节点策略 | 冲突 `C-1`、周边材料中的新节点口径 | User + Product + Architecture | `confirmed_by_user_pending_material_sync` | 已确认“双层口径”：代码实现用新节点 / 新 DSL；产品 UI 不同时展示新旧节点，沿用 `Human Input` 命名；迁移策略按用户给定方案执行 |
| `R-9` abuse guardrails | `Q-4`、`A-5`、`BE-HITL-029` | SaaS + Security | `pending_external_owner_decision` | 当前本地不做决定，后续再补充。仍待 SaaS / Security 明确 dynamic Email、OTP、收件人数和发送量阈值，以及拒绝策略和例外流程 |

建议的走查顺序：

1. 先把已拍板的 `R-8`、`R-4`、`R-5`、`R-7`、`R-3`、`R-6`、`R-1` 同步到所有 repo-local review materials。
2. 当前剩余未决项只剩 `R-9` 的 abuse guardrails。
