# HITL Phase 2 PRD Review

来源：<https://langgenius.feishu.cn/wiki/GMFdwe40Oi2rC9klP2HcNjnHnwd>  
本次复读基于 `revision_id = 1918`（读取时间：2026-07-10，Asia/Shanghai）。

## 直接结论

这版 PRD 相比上一版已经明显收敛，尤其是：

- `Human Roster` 已统一重命名为 `Contact`
- `Workspace IM override` 已从非目标改为本期范围
- `Dynamic Email`、`Current initiator`、`form/task` 状态层级、`Web 独立页面审批` 都补进了显式决策
- `Magic link` 基本被收回，外部邮箱路径开始统一收敛到 `Email OTP`

但仍然**不建议直接无保护进入实现**。主要原因已从“规则缺失”转为“规则虽有，但仍有若干跨章节冲突、未落成矩阵、以及边界不完整”。当前最值得继续盯住的点是：

- `RBAC` 仍未完整定义
- `Connection status` 虽有枚举，但没有生命周期
- `Contact / Organization / Dify member` 的边界仍有灰区
- `Web 鉴权链路` 已收敛，但不同审批主体的失败路径和回退策略还不完整
- `abuse guardrails` 仍未量化

下面按你要求的 10 个维度更新。

## 1. 显式需求

- 系统已从 `Human Roster` 切换到 `Contact` 概念，且产品信息架构中明确将左侧模块拆为 `Agent` 与 `Contact` 两个独立模块。
  引用：§2 “提供 Contact，作为 HITL 可通知联系人的来源。”；§5 “Agent 与 Contact 模块拆分”；§5.3 “Workspace：Contact”

- `Contact` 的产品类型本期收敛为三类：`Dify member`、`Organization contact`、`External contact`。
  引用：§3.1 “本期 Contact 类型收敛为三类：Dify member、Organization contact、External contact。”

- `Organization` 在本期被定义为统一抽象：`CE / SaaS` 中当前 workspace 即 `Organization`，`EE` 中整个部署内所有 workspace 共同属于同一个 `Organization`。
  引用：§3.3 “本期用 Organization 统一 CE / SaaS / EE 的产品抽象：CE / SaaS 中，当前 workspace 即 Organization；EE 中，整个部署内所有 workspace 共同属于同一个 Organization。”

- 本期明确支持 `Workspace IM override`，但它只覆盖 workspace 内 contact 的 `IM identity / 通知行为`，不覆盖 IM Integration 的凭据。
  引用：§2 非目标中 “~~workspace级别的 im identify override~~ Workspace IM override 本期进入范围。”；§6.5 “Workspace IM override 本期需要支持，但它不是 IM 平台接入凭据 override。”

- `IM credential` 的产品作用域已明确为 `Organization` 级，而不是 workspace 级凭据 override。
  引用：§18.4 “IM channel 接入配置中的 App ID、App Secret…统一归属 Organization。”；同节 “不再采用：~~Workspace / tenant-level credential override 优先于 deployment-level credential 的凭据优先级。~~”

- `Connection status` 已被明确扩展为 `Not configured / Configured / Connected / Permission issue / Callback error / Connection error`。
  引用：§6.2 “Connection status 需要从粗粒度 Error 拆成可排查的产品状态”；同节列出六个状态

- `Dynamic Email` 本期只支持单个合法 email，不支持数组变量批量输入；并且命中现有 `Contact` 后要升级为 `Contact recipient` 而不是继续当作裸邮箱。
  引用：§8.3 “不再支持…通过数组变量一次传入多个 dynamic Email recipients。”；§8.3 “Dynamic Email 命中 Contact 后升级为 Contact recipient”

- `email matching` 规则已被明确为：对完整 email 执行 lower-case 后做完全相等比较；本期不做 `+tag` 消解或点号折叠。
  引用：§7.5 “先对完整 email 字符串执行 lower-case，再做完全相等比较。”；同节 “本期不做 provider-specific 规则：~~+tag 消解、点号折叠…~~”

- 默认通知规则已明确为：具备 `IM binding + Email` 的 recipient 并行走 `IM + Email`；Email 默认不可关闭。
  引用：§2 “默认通过 IM + Email 双渠道触达；Email 默认不可关闭。”；§9.1 “默认双渠道触达”

- `Current initiator` 与 `allowed approver` 的关系已被明确为：`Current initiator` 是独立 allowlist 来源，但通知发送产生的审批主体仍以 `Contact` 为中心记录。
  引用：§8.5 “Current initiator 与 allowed approver”；§9.4 “提交主体”

- `Web 独立页面审批` 与 `IM 卡片审批` 已被拆成两条鉴权链路：
  - `IM 卡片审批`：IM identity -> IM Binding -> Contact
  - `Web 独立页面审批`：按审批主体走 Dify 登录或 Email OTP
  引用：§17.3 “IM 卡片审批与 Web 独立页审批是两条鉴权链路”；§17.5 “不同审批主体的 Web 鉴权”

- `form/task` 状态机在产品文案上已明确只保留 `WAITING / SUBMITTED / TIMEOUT / EXPIRED`，`canceled / delivery_failed` 不进入 form status。
  引用：§10.1 “form/task 状态层级”；同节 “本期 form status 只使用 WAITING、SUBMITTED、TIMEOUT、EXPIRED。canceled 不进入 form status；delivery_failed 不进入 form status。”

- `导入导出 / DSL ID-Email 转换` 已被明确移出本期目标。
  引用：§11.2 “导入导出不作为本期目标”；§15 “Milestone 4 范围调整：移出本期 ~~DSL 导入导出 ID / Email 转换~~”

- `Success metrics / failure metrics` 已明确不在本期范围；`SaaS abuse guardrails` 单独成章，但仍待 SaaS 团队确认。
  引用：§18.11 “Success metrics和Failure metrics / 暂不考虑”；§19 “Saas Abuse guardrails / 由saas团队确认”

## 2. 隐藏假设

- [PRODUCT_DECISION] PRD 假设 `Organization` 作为统一抽象足以覆盖 `SaaS / CE / EE`，但这实际上隐含了“当前阶段不处理 SaaS/CE 未来多 workspace 语义”的假设。
  引用：§3.3 “CE / SaaS 中，当前 workspace 即 Organization”；§18.3 “CE 默认只有一个 workspace”

- [ENGINEERING_DECISION] PRD 假设“审批主体以 Contact 为中心”足以消解 IM / Email 双渠道重复通知问题，但这依赖 `Contact`、`IM Binding`、`normalized email` 的映射始终可逆。
  引用：§8.5 “allowed approver 以 Contact 为中心记录”；§18.6 “Contact-centric canonicalization”

- [PRODUCT_DECISION] PRD 假设 `Organization contact` 在 Web 独立页审批时可以可靠走 `Dify 登录`，这隐含了这些对象在实际产品里都拥有可用 Dify 身份的前提。
  引用：§17.5 “Dify member / Organization contact：Web 独立页要求 Dify 登录”

- [PRODUCT_DECISION] PRD 假设 `Email always-on` 对所有部署形态和客户约束都成立，但没有给出任何合规例外或部署级开关。
  引用：§2 “Email 默认不可关闭。”；§9.1 “Email 默认不可关闭”

- [ENGINEERING_DECISION] PRD 假设 `dynamic authorization` 能覆盖 pending task 的所有身份漂移问题，但没有写清与 snapshot 的边界如何在查询、展示、重发中共存。
  引用：§18.9 “pending task 的提交资格采用动态授权”；同节 “历史 task 永远保留创建时快照”

- [PRODUCT_DECISION] PRD 假设 `DingTalk self-managed integration` 虽然运维重，但仍是 SaaS 可接受路径；这实际上把大量接入负担转给租户管理员。
  引用：§4.1 “每个 tenant / workspace 需要自行创建钉钉企业自建应用”；同节 “必须提供 Test connection”

## 3. 模糊术语

- [BLOCKER] `Organization contact` 与 `Dify member`、`workspace member` 的边界还不够干净，尤其是在“离开 workspace 但仍在 organization 中”时。
  引用：§3.1 “Organization contact 表示仍属于当前 Organization 联系人池，但不一定是当前 workspace member。”；§18.2 “若联系人已不在当前 workspace，仍在 dify 系统中，联系人类型自动转为 dify member”

- [BLOCKER] `valid Contact` 仍是隐式术语。PRD 在动态授权链中大量使用它，但没有单独定义“valid”的判定条件集合。
  引用：§17.4 “动态授权判定链：… current IM Binding -> valid Contact -> allowed approver -> allow / deny”

- [ENGINEERING_DECISION] `Connection status` 现在有枚举，但“什么时候从 Configured 进入 Connected / Permission issue / Callback error / Connection error”仍是模糊的。
  引用：§6.2 “Connection status 需要从粗粒度 Error 拆成…”；同节没有给出状态迁移条件

- [BLOCKER] `Contact list / 联系人列表 / Contact` 在文档里交替出现，集合概念与单条记录概念仍有轻微混用风险。
  引用：§5 “后续文档中的联系人名录相关表述统一更新为 Contact；当需要强调集合含义时，使用 Contact list / 联系人列表。”；§3.2 标题 “Contact”

- [PRODUCT_DECISION] `Only notify me during debug` 的“me”在多人协作、代理触发、无可通知渠道时的语义仍不够明确。
  引用：§8.6 “实际通知对象替换为当前调试用户。”；全文未定义调试用户无有效渠道时的行为

## 4. 缺失的状态迁移

- [BLOCKER] `Connection status` 虽然有状态枚举，但缺少正式状态迁移图。
  引用：§6.2 列出六种状态；未说明 `Save/Test connection/Disable` 如何驱动迁移

- [ENGINEERING_DECISION] `IM Binding` 仍缺生命周期：手工配置、同步建立、覆盖、删除、失效、恢复之间没有状态机。
  引用：§6.3 “配置 IM identity”；§6.4 “IM 成员同步”；§18.2 “IM Binding 修改 / 删除”

- [PRODUCT_DECISION] `unmatched list` 仍缺生命周期与可逆性定义。
  引用：§6.4 “管理员可手动处理 unmatched 成员，例如忽略、稍后处理，或作为 external contact 添加。”

- [BLOCKER] `URL / token lifecycle` 虽然列出了 `issued / opened / verified / submitted / expired / revoked` 的概念，但没有定义重发、刷新、再次打开、再次验证后的状态转移。
  引用：§17.4 “URL / Token 生命周期”

- [BLOCKER] `Workspace member 离开`、`转为 external contact`、`从 Contact 移除` 三条分支仍缺一张统一状态图。
  引用：§18.2 “管理员可选择：转为 external contact / 从 Human Roster 移除”；同章仍混用 `Contact` 与旧术语

- [ENGINEERING_DECISION] `Workspace IM override` 现在已进入范围，但 create / update / reset / delete 对 pending task 和已发通知的影响只在 §18.9 的表格里部分定义，没有完整生命周期文案。
  引用：§6.5 “Workspace IM override 本期进入范围”；§18.9 表格 “Workspace IM override 修改”

## 5. 缺失的错误 / 边界场景

- [BLOCKER] `Current initiator` 在 API / CLI 场景下“没有明确身份”时仍未定义节点行为。
  引用：§8.5 “CLI/API 发起时，若调用方有明确身份，可作为 allowed approver。”；未覆盖“无明确身份”

- [BLOCKER] `Dynamic Email` 只明确不支持数组，但没有明确多值字符串、逗号分隔、空白值、重复值的前端与运行时拒绝策略。
  引用：§8.3 “不再支持…数组变量一次传入多个 dynamic Email recipients”；§10.3 “Dynamic Email 解析异常类型”

- [BLOCKER] `dynamic Email 命中多个 Contact` 或命中跨 workspace 同邮箱主体时的唯一归属规则没有单独写明。
  引用：§8.3 “命中 Contact 后升级为 Contact recipient”；§18.6 “优先匹配已存在联系人”

- [BLOCKER] `Dify member / Organization contact` 若不能完成 Dify 登录，是否允许退化为 Email OTP，PRD 当前明确否定统一 OTP，但没有定义失败后是否还有补救路径。
  引用：§17.5 “Dify member / Organization contact：Web 独立页要求 Dify 登录”；§17.5 同节未定义登录失败后替代路径

- [PRODUCT_DECISION] `企业微信` 被标为“不支持卡片内审批，只能做选择”，但复杂表单、文件表单、超出 action 数量限制时的用户体验路径仍未定义。
  引用：§18.5 企业微信行 “不支持 / 只能做选择（对应 Dify 表单的 action，并且 action 数量有限制）”

- [BLOCKER] `No one can approve this step yet` 已出现在节点预览示意，但真正的保存校验、运行时错误、可发布性规则还没写全。
  引用：§8.7 节点预览示意图；§10.4 “无可通知对象时报错”

- [PRODUCT_DECISION] `文件访问权限` 已增加原则，但没有具体说明文件对象本身的授权失败提示、日志记录和重试策略。
  引用：§9.3 “文件访问必须同时校验 task、访问者身份、allowed approver 和文件所属 task。”

## 6. 安全与权限问题

- [PRODUCT_DECISION] 完整 `RBAC` 矩阵已不再作为本期 blocker，但细粒度权限依然未定：谁能查看完整 Contact、谁能看 raw dynamic value、谁能管理 external contact，仍需后续确定。
  引用：§18.10 “不再作为当前 PRD blocker：~~在本期完整定义所有后台操作权限矩阵。~~”；同节 “普通 member 是否能查看完整 Contact…后续结合 RBAC 再定”

- [BLOCKER] 外部邮箱审批已基本收敛到 `Email OTP`，但 `OTP` 的速率限制、次数限制、锁定规则、重发策略仍未定义。
  引用：§17.5 “Email OTP 规则”；§19 “Saas Abuse guardrails / 由saas团队确认”

- [BLOCKER] `raw dynamic Email`、`form snapshot`、`submission content` 的可见范围与脱敏边界仍未收敛。
  引用：§16.4 “敏感信息边界待定”；同节 “后续需要结合安全与研发方案单独确认”

- [BLOCKER] 审计可见性虽然开始收敛到 `enterprise admin / workspace admin / workflow 编排者`，但不同主体可见字段范围没有定义。
  引用：§16.2 “审计可见性”；§16.2 “审计主体”

- [BLOCKER] 文件访问安全原则已写出，但对象级授权模型仍未定义，例如外部联系人是否能看其被要求审批的文件预览。
  引用：§9.3 “文件访问必须同时校验 task、访问者身份、allowed approver 和文件所属 task。”

- [PRODUCT_DECISION] `Email always-on` 在受监管场景、私有化场景是否允许例外，仍无权限/合规策略。
  引用：§2 “Email 默认不可关闭。”；全文未给出例外

## 7. 平台能力风险

- [BLOCKER] `IM 能力矩阵` 仍未填完，尤其 `通讯录同步` 仍为空，意味着产品已经决定依赖它，但没有明确哪些 provider 真支持。
  引用：§18.5 矩阵中 `通讯录同步` 列为空

- [ENGINEERING_DECISION] PRD 虽然把 `fallback URL` 从“身份 fallback”中剥离了，但仍在模板映射和产品规则中保留该术语，容易继续混淆“通知入口”和“鉴权链路”。
  引用：§18.5 “不能渲染卡片时，发送 request message + fallback URL。”；§18.8 表格列 “IM fallback”

- [BLOCKER] SaaS 钉钉仍是高运维负担路径，产品虽然补了约束，但没有给出失败后的支持边界、可观测性或 self-serve 预期。
  引用：§4.1 “必须提供 Test connection”；同节仍要求租户自备 app id / secret

- [BLOCKER] `Dify 登录` 被用作 `Organization contact` 的独立页鉴权前提，但对“跨 workspace 的内部人是否默认都有 Dify 登录路径”没有产品确认。
  引用：§17.5 “Dify member / Organization contact：Web 独立页要求 Dify 登录”

- [PRODUCT_DECISION] `企业微信` 能力限制已知，但没有补充对应的 PM 降级策略，例如强制转网页审批、禁止复杂表单、还是只支持 approve/reject。
  引用：§18.5 企业微信行说明

## 8. 应明确写出的 Non-goals

- [PRODUCT_DECISION] `Magic link` 不再是本期外部邮箱审批方案。
  引用：§9.3 “~~Magic link。~~ / Email OTP。”；§17.5 “不再采用：~~External contact…Magic link 或 Email OTP。~~”

- [PRODUCT_DECISION] `导入导出 / DSL ID-Email 转换` 不属于本期目标。
  引用：§11.2 “导入导出不作为本期目标”；§15 “Milestone 4 范围调整”

- [PRODUCT_DECISION] 不支持多个 IM 绑定、通知优先级、个人通知偏好、复杂审批规则、群聊通知。
  引用：§2 非目标对应条目

- [PRODUCT_DECISION] `Success metrics / failure metrics` 不属于本期目标。
  引用：§18.11 “暂不考虑”

- [PRODUCT_DECISION] 完整后台操作权限矩阵不作为本期 PRD blocker。
  引用：§18.10 “不再作为当前 PRD blocker：~~在本期完整定义所有后台操作权限矩阵。~~”

- [PRODUCT_DECISION] 不支持把 `dynamic Email` 解析为 Contact entity / member id / group id。
  引用：§2 非目标 “动态 recipient 解析为 Contact entity / member id / group id。”

- [PRODUCT_DECISION] 不支持把数组变量一次传入多个 `dynamic Email recipients`。
  引用：§8.3 “不再支持…数组变量一次传入多个 dynamic Email recipients。”

## 9. Blocking questions for product

- [BLOCKER] `Organization contact` 与 `Dify member` 的产品边界最终如何面向用户解释？它们是展示层类型、鉴权层类型，还是数据层类型？
  引用：§3.1 Contact 类型；§17.5 “Dify member / Organization contact：Web 独立页要求 Dify 登录”

- [BLOCKER] `Current initiator` 在 API / CLI 无明确身份时，节点究竟是禁止运行、禁止审批，还是降级为“无 initiator approver”？
  引用：§8.5 “若调用方有明确身份，可作为 allowed approver。”

- [BLOCKER] `Organization contact` 在 Web 独立页上若无法完成 Dify 登录，是否允许任何补救路径？
  引用：§17.5 “Organization contact：Web 独立页要求 Dify 登录”

- [BLOCKER] `Contact 管理权限` 的最小可交付口径是什么？当前只说“拥有管理 Contact 权限的人可以访问 Contact”，但没有更细。
  引用：§18.10 “拥有该权限的人可以访问 Contact，并可搜索跨 workspace 的 Dify member。”

- [BLOCKER] `OTP` 的限流、失效时间、错误提示、重试次数、锁定策略是什么？
  引用：§17.5 “Email OTP 规则”；§19 “Saas Abuse guardrails”

- [BLOCKER] `Connection status` 中 `Permission issue / Callback error / Connection error` 的产品判定条件是什么？
  引用：§6.2 “Connection status 状态机”

- [BLOCKER] `通讯录同步` 哪些 provider 本期真正支持？如果不支持，UI 上是隐藏还是禁用？
  引用：§6.4 “如果当前 IM 能力支持通讯录读取，可提供同步能力。”；§18.5 `通讯录同步` 列为空

- [BLOCKER] `Contact remove / convert / disable` 三条路径对 pending task 的统一 UX 是什么？目前文案分散在生命周期和变更矩阵中。
  引用：§18.2 联系人生命周期；§18.9 变更影响矩阵

- [BLOCKER] `企业微信` 的 action 数量限制是否会导致功能范围收缩？需要明确哪些表单或操作不支持。
  引用：§18.5 企业微信行

## 10. Engineering decisions that should not be left to implementation agents

- [ENGINEERING_DECISION] `Contact-centric canonicalization` 的 canonical key、优先级、日志归并和 UI 呈现必须统一设计。
  引用：§18.6 “多来源命中同一人的归并展示”；§18.6 “Contact-centric canonicalization”

- [ENGINEERING_DECISION] `form status / workflow outcome / delivery reason` 三层状态模型必须明确拆层，不能在实现时临场决定。
  引用：§10.1 “form/task 状态层级”

- [ENGINEERING_DECISION] `Organization-level credential` 与 `Workspace IM override` 的数据模型和运行时优先级必须先定稿。
  引用：§6.5 “override 只用于当前 workspace 内联系人 IM 身份 / 通知行为的覆盖”；§18.4 “IM 凭据作用域”

- [ENGINEERING_DECISION] `Connection status` 到 provider 错误、权限错误、回调错误的映射规则必须统一。
  引用：§6.2 “Connection status 状态机”

- [ENGINEERING_DECISION] `Dynamic authorization chain` 必须以统一校验链实现，而不是让每个入口各自拼接。
  引用：§17.4 “动态授权判定链”

- [ENGINEERING_DECISION] `URL / token lifecycle` 的一次性使用、重放保护、失效和重发策略必须单独设计。
  引用：§17.4 “URL / Token 生命周期”

- [ENGINEERING_DECISION] `OTP` token 方案、rate limit、错误码、审计字段不能留给实现层自行发明。
  引用：§17.5 “Email OTP 规则”；§16.4 “敏感信息边界待定”

- [ENGINEERING_DECISION] `审计 schema`、可见字段、脱敏边界、PII 存储策略必须统一设计。
  引用：§16.2 “审计可见性 / 审计主体”；§16.4 “敏感信息边界待定”

- [ENGINEERING_DECISION] `文件访问授权` 需要明确对象级校验模型，不应只靠 task token + allowed approver 做隐式实现。
  引用：§9.3 “文件访问必须同时校验 task、访问者身份、allowed approver 和文件所属 task。”

- [ENGINEERING_DECISION] `迁移` 与 `旧 DSL 兼容读取` 规则必须统一，而不是散落在节点实现和 workflow 兼容层。
  引用：§5.0 “旧 workflow DSL 需要保持兼容”；§11.3 “旧 Email recipient 迁移匹配”
