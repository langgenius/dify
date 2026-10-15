# Builder 完整 Workflow 原生测试与风险确认设计

日期：2026-10-14（用户本地日期）。源码基线：`13368bd5fa91a613c65ccc1bd328fcadac732cf2`。

状态：用户已认可对话中的统一方向并要求开始；本文是待用户审阅的书面架构设计，尚未批准实现计划。本文中的“必须”描述交付要求，不表示当前系统已经具备该能力。本轮只进行源码审计、设计与工单记录，没有运行新的业务调用、测试、CI、构建或部署。

关联：ENG-1196（完整测试链路）、ENG-1189（Code 执行基座）、ENG-1184（真实调用授权）、ENG-1177（New Agent 资源绑定）。ENG-1117 继续暂停。前端不实现；前端缺口先记录，待后端/API 全部在 Dev 验证后再处理前端工单。

## 1. 用户目标与范围调整

生成的完整 Workflow 应能由 Builder agent 测试。是否等待确认由即将执行的实际操作、账户、数据和费用范围决定，而不由节点类型白名单决定。New Agent 与 Code、Template、条件、Iteration、Tool 一起进入本次链路和首批贯通验收。

闭环为：生成计划 → 搜索并绑定真实资源 → 保存合法草稿 → 原生 Test Run → 在风险操作前等待确认 → 从暂停处继续 → 对照预期检查业务结果 → 修复并发起新的验证 Run。

PRD 的依据是本地《Dify App Builder - PRD.md》§5.2.3（搜索 Workspace New Agent、版本、权限、真实绑定）、§5.8.2（完整流程测试、边界样例、修复和复测）、§9（真实调用单独授权）。用户本次明确扩展原 §10 的有限节点覆盖目标，并调整 §9.1 的测试策略：有真实执行条件时使用原生执行；有风险则确认后执行。Mock/Dry Run 保留为明确选择的模式，不能默认用模拟成功代替真实通过。

不扩大 Builder 可以创建的 App 模式。对于其已支持的生成模式，测试使用该模式的原生节点注册表、数据类型和执行语义，不维护另一个“允许测试节点”清单。平台本身缺少实现、配置或权限时，返回具体原因和恢复动作；不把它们统称为安全问题。

## 2. 当前实现与实际缺口

| 当前事实 | 本次必须改变的边界 |
| --- | --- |
| `DifyPort.run_draft` 已进入 `AppGenerateService` 的 debugger 原生运行路径。 | 保留该路径，不建立第二个 Workflow executor。 |
| Builder admission 主要支持标量、线性图；JSON Tool 和确认 Gmail read 是独立窄策略。 | 改为原生图校验、资源绑定和实际能力边界授权；支持分支、循环、文件与嵌套。 |
| `BuilderExecutionPolicyService.revalidate` 拒绝 resume、Celery 和非零 call depth。 | 显式支持可信上下文重载、暂停恢复和父子调用。普通运行不能成为丢失上下文后的回退路径。 |
| Builder 的 `resume` 动作目前只更新会话暂停标记。 | 恢复原生执行 checkpoint，与会话、任务和待确认操作共同校验。 |
| 原生 Workflow-as-Tool 禁用 pause state，并未传递 Builder 策略。 | 增加父子 continuation；子流程等待确认时父流程也必须可恢复。 |
| New Agent 有原生绑定和执行路径，但 Builder 资源目录缺少 New Agent。 | 增加按能力发现、展示、真实绑定和输入输出映射。 |
| Agent backend 仅有 running/succeeded/failed/cancelled；没有风险确认恢复协议。 | API 与 Agent backend 一起补齐版本化授权/暂停/继续协议。不能把现有 dangerous/approved 配置标志当作这项能力。 |
| New Agent 可以直接调用插件 daemon，也可调用核心工具、模型与 shell。 | 共同策略必须到达这些实际执行位置，不能只守外层 Agent/Tool 节点。 |
| Dify CodeExecutor 硬编码 `enable_network=True`；现有 sandbox 输出和请求隔离仍有缺口。 | 按次配置原生 Code/Jinja collaborator，并交付 ENG-1189 的实际隔离和取消能力。 |

基线源码入口：

- `api/services/dify_builder/dify_port.py:732`、`execution_policy_service.py:609`。
- `api/core/workflow/node_factory.py:392`、`api/core/tools/workflow_as_tool/tool.py:119`。
- `api/core/workflow/nodes/agent_v2/{binding_resolver,runtime_request_builder,dify_tools_builder,agent_node}.py`。
- `api/clients/agent_backend/client.py`、`dify-agent/src/dify_agent/{protocol/schemas.py,server/routes/runs.py}`。
- `api/core/helper/code_executor/code_executor.py:85`。

审计实际使用安装的 Graphon **0.7.0**；不能拿同目录旁的 Graphon 0.6.0 源码证明当前行为。本地 sandbox 源码位于 `/Users/chongbinyao/dify/dify-sandbox`，本轮读取版本为 `5631afef06ec88f80c28129aec7fd22a30006b14`；历史报告中的“没有本地源码”已经过时。

## 3. 选择的架构

曾考虑直接放行普通 Test Run 并确认整个流程，或建立另一套测试执行器。前者无法在 New Agent 动态调用时确认具体动作，也不能控制修复重放；后者会造成两套执行语义和维护成本。

采用**原生运行时 + 统一测试上下文 + 执行位置的授权守卫 + 持久化 continuation**。授权策略判断操作能否继续，原生引擎判断节点如何执行；隔离环境约束代码和进程实际能访问的资源。

新策略、编排和协议实现放在现有领域所有者及 `api/services/dify_builder/` 下；`api/core/` 只做现有调用者的必要适配。Agent runtime 的实现放在 `dify-agent/` 对应所有者，sandbox 的实现放在其现有 runner/service 所有者。复用数据库、任务队列和普通发布流程。

### 3.1 统一测试上下文

服务端创建不可由模型或客户端自填的上下文，绑定：

- tenant、actor、app、Builder session/command、execution request、根 native Run。
- 本次 graph/input revision、资源引用、模型/工具安装版本、Agent 发布 snapshot。
- 原生 node execution、iteration index、父子 invocation path、逻辑操作 ID、实际 dispatch attempt。
- 授权引用、测试模式、共享预算、截止时间、取消标记与证据关联。

跨异步/API 边界的可信授权上下文使用不透明引用；正常 Prompt、配置和业务输入仍按原有协议传输。接收方通过完整 owner chain 重建可信状态。子图、Iteration、并行分支、Workflow Tool、New Agent 和其内部调用继承该上下文，预算不能在每个子节点重置。深度、总调用数、成本、并发和输出均有有限上限。

普通业务运行维持原有行为；带 Builder 测试标识的执行一旦缺少上下文，必须停止并报告上下文丢失，不能切到普通运行绕过授权。

### 3.2 运行状态与事件

测试请求状态为 `prepared → running → waiting → running → terminal`。`waiting` 明确区分 approval/configuration/interaction；terminal 明确区分 succeeded/failed/cancelled/unknown。保留原生 Workflow Run 状态，不把 Builder 等待状态伪装成原生成功。

每次等待都持久化 pending operation、当前 frame/子调用 checkpoint、预算和已完成操作记录。恢复必须重新校验 owner、权限、revision、授权和剩余预算，并只继续同一代执行。取消使整个调用树停止派发新操作，触发各实际运行时取消；已经发出的外部操作不能声称已撤回。

只有持久化所有者确认 checkpoint 已提交后才能对外报告“可恢复等待”。恢复以 continuation generation 原子 claim，配合可恢复的任务派发，不能用先查询再更新保证唯一性。checkpoint 写入失败、claim 后进程退出或 enqueue 回执丢失均须有明确恢复结果。

原生恢复会重新调度 pending node，不会恢复 Python generator 的指令位置。因此节点/Agent 内部也需要持久化子操作进度、必要输入和结果、文件引用、模型/工具历史及逻辑操作游标；脱敏审计 receipt 不能替代这份执行状态。同一 Run 恢复时用已完成子操作的真实记录重建状态，不再次派发。跨修复 Run 选择旧响应的行为则按 §4.3 标记为模拟，二者不能混淆。

授权等待使用结构化控制结果，不能成为模型可吞掉的普通工具错误、节点默认值或失败分支。GraphEngine layer/event 回调只用于观测；当前实现会捕获部分回调异常，因此真正的授权判断必须在实际 I/O 前同步执行。

原生 Graphon checkpoint/恢复接口可复用，但子调用和通用审批暂停需要显式适配。若必须扩展 Graphon 的 pause schema，修改并发布兼容当前 0.7 系列的上游依赖、更新锁定版本；禁止改 `.venv` 安装文件或以旧版 sibling checkout 替代。

## 4. 授权策略与真实操作记录

### 4.1 如何判断是否需要确认

| 操作 | 行为 |
| --- | --- |
| 已批准任务中的本地计算、条件、循环、模板、隔离临时文件 | 自动执行，受共享预算约束。 |
| 模型调用、真实 HTTP/Tool、读取新的账户或知识/文件范围 | 先检查已有明确授权；不在授权范围内则等待确认。模型选择本身不替代调用的数据/费用授权。 |
| 发消息、发送邮件、写库、建单等真实写入 | 展示具体账户、动作、目标、参数和次数后确认；批准可以覆盖明确且有界的一批操作。 |
| 无法确定内部副作用的插件动作或脚本 | 展示完整调用、执行身份、数据/网络范围及“不透明内部行为”的事实；请求对这一次有界调用的授权，不把未知当安全，也不建立逐插件白名单。 |
| 缺少凭据、权限、合法资源或运行能力 | 等待配置或返回具体运行能力错误；用户确认不能凭空补出凭据或平台权限。 |

延续 PRD 的 destructive 操作边界：删除生产数据、不可逆迁移等本期不由 Builder 执行，解释具体动作并提供替代测试路径。普通发邮件/建测试单属于可明确授权的真实写入，不因此一律禁止。

### 4.2 确认的内容和有效范围

确认记录包含非敏感账户别名、credential reference/revision、资源版本、动作、目标、规范化参数摘要及完整参数摘要哈希、输入/图 revision、数据与费用范围、有效期、最大逻辑调用数和最大 dispatch 次数。授权来源只能是认证用户的明确操作；模型输出、Prompt、插件返回或配置里的 `approved=true` 不构成批准。

对动态调用，在实际参数确定后再准备确认。批量授权必须有可检查的具体目标集合或明确边界，不能使用“允许这个 Agent 做任何事”。范围内无需每一轮重复确认；扩大范围、改变执行身份或相关输入/实现版本后重新确认。并发分支通过服务端原子预留共享额度。

凭据由原有运行时服务端解析。对话、确认摘要、日志、截图和 Trace 不包含 secret 明文。OAuth refresh 若是这次实际调用所需，纳入同一披露范围和尝试记录，不能在等待确认前提前触发。

工具声明、metadata/runtime 构造和 credential readiness 检查也必须遵守这一点，不能为了准备确认而提前刷新 OAuth 或发业务请求。

### 4.3 幂等、修复与不确定结果

持久化三个不同概念：用户批准的 scope、某个逻辑 effect intent、一次实际 dispatch attempt。队列重投、并发 claim、输出校验重试不能产生新的 effect intent 来绕过已用额度。现有 Gmail-only consent 的单次 phase 模型可保留兼容，但不能把一条旧 consent 的“已确认”状态扩展成整图授权。

实际 I/O 前短事务完成权限/范围重验和原子 claim；网络调用在事务外。返回后追加完成证据。已知未派发可以安全继续；已派发、响应丢失、worker 死亡或结果不确定时标记 unknown，停止自动重试。支持服务商幂等键/结果查询时使用它们；无法确认时向用户展示不确定事实，不声称跨服务 exactly-once。

自动修复创建新 graph revision 和新验证 Run，并关联原 Run。外部动作的已完成记录不会随新 Run 清空。需要再次真实执行时必须获得新的明确授权；若选择复用旧响应，仅作为有标记的模拟/已记录输入，不能算新的真实调用通过。

## 5. New Agent：发现、绑定、内部执行

### 5.1 发现和绑定

扩展现有 Workspace 资源目录，按名称、描述、标签、能力摘要检索已发布 Agent，并提供版本/snapshot、维护信息、输入输出 Schema、工具与知识/文件依赖、用户和 Workflow 的使用/引用权限以及匹配理由。返回计划资源槽位所需真实 ID，不只返回名称。

应用计划时通过现有绑定服务持久化 tenant → app → workflow → node → binding → agent → snapshot 的完整关系；校验两个方向的输入输出映射。不复制一个内联 Agent，不生成废弃的老 Agent 节点。未认证 Tool 仍可先绑定并写入现有“待配置”说明；执行到该位置才等待配置。

当前 roster 首次执行会取 active published snapshot，因此仅在计划里记版本还不等于固定版本。应用和启动时必须核对展示的 snapshot；有效版本已变化则重新展示确认，不能静默跟随最新。已启动且暂停的执行继续其已固定的 generation；恢复时仍检查当前引用权限、撤销状态和版本可用性。

找不到匹配、未发布、Schema 不符或没有权限时，返回精确资源状态和选择/配置动作，不生成虚假的“已绑定”。ENG-1177 的 A1/v3 是原票验收契约，不假定当前测试 Workspace 已经存在同一个 A1。

### 5.2 Agent runtime 必须参与同一协议

扩展现有 API/Agent backend 协议，增加测试上下文引用、pending approval、版本化暂停/恢复和取消事件；客户端与服务端协商协议能力，滚动升级期间不静默退回旧的不受控运行。Agent 运行等待期间释放工作线程/网络连接，持久化模型历史和 pending tool call，批准后继续这一条调用而非重新让模型规划一次。

协议不兼容必须在模型、工具、eager retrieval 或 bootstrap I/O 之前拒绝启动。涉及运行中 shell stdin 的等待需要持久化真实 job/lease 身份；进程已丢失时返回 unavailable/unknown，不能重新执行原脚本来假装继续。

在 Agent 的模型访问、direct plugin daemon client、`dify.core.tools`、Workflow-as-Tool、知识检索、文件传输和 shell/CLI 执行前接入相同授权所有者。eager retrieval、CLI 安装/bootstrap 和运行中的 stdin 也可能在正常工具调用之外产生操作，必须纳入相同控制。核心工具回调必须传递真实父调用路径和深度，不能重置为 0。内部多轮、并行调用、Agent 输出校验重试共享同一预算和 effect ledger。

New Agent 生成的脚本或不透明插件调用可以作为明确披露的一次有界执行获得批准。批准完整脚本不等于能证明每封隐藏邮件都单独确认过；报告应写清授权粒度。脚本内容、运行依赖、输入文件或能力范围变化会使待执行批准失效。未经约束的 shell、宿主网络和持久化共享目录不能因外层 Agent 已批准就自动开放。

### 5.3 Agent 测试环境

CodeSandbox 与 Agent runtime 是两个执行基座。现有 Agent Home/Workspace 有持久化语义，不能直接当作一次性测试隔离。Builder 测试通过现有 Agent backend 创建测试专用会话/工作目录和受限 lease，使用固定 Agent snapshot、明确输入文件与 server-side SecretRef；不覆盖原 Agent 会话或共享工作目录。

对 Agent 自身支持的 shell/CLI，复用其运行时的可约束网络、文件、进程和取消能力，固定执行环境并记录实际后端。需要真实网络时确认可执行的命令/工具动作及其数据、目标网络和费用边界，并由实际运行环境执行这些边界；没有该能力时明确等待运行环境配置。不能用 ENG-1189 的 CodeSandbox 验收结果冒充 Agent 隔离已通过。

## 6. ENG-1189：保持原生 Code 的可用性

沿用 `/v1/sandbox/run`、Python/JavaScript runner、原生 Code transformer/output schema 和 Jinja 语义。新执行 collaborator 按次传递 endpoint、网络策略、语言、依赖版本、预算和取消关联，禁止修改进程全局 endpoint/cwd/policy。

默认计算不携带业务凭据、不允许直接外呼。真实外部操作优先通过受授权的原生 HTTP/Tool/model owner；需要代码直接联网的流程必须提供实际可执行的数据/网络范围和对应确认，不能把确认翻译成无边界的 `enable_network=True`。这是运行能力要求，不能通过 AST 猜测代码是否“安全”来代替。

sandbox 必须交付有界 input/code/stdout/stderr/disk/CPU/wall/memory/PID/FD/concurrency，隔离请求的可变文件和进程状态，使用明确工作目录及不可变依赖。保留正常 Python/JS 导入和已安装依赖；额外依赖通过固定环境制品准备，不在测试请求内任意安装/刷新。

取消必须到达实际进程树，等待有界退出，清理 root/UID/FD；清理失败的执行环境隔离停用后再恢复容量。输出超限、超时或截断返回明确失败，不能当作部分输出成功。历史候选 1/1.5 GiB、5s 等参数仅是待测起点，最终值由正常语言/依赖负载和隔离测试测定。

按实际服务镜像、依赖和部署配置进行一次发布级资格验证，并在运行时检查是否仍匹配；不为每个节点或官方插件建立独立人工准入流程。普通 sandbox endpoint 的行为不因测试服务上线而改变。

## 7. API、事件与后端交付边界

复用现有 session actions、执行请求、real-call-consents 的路由所有者，增加明确版本化的通用测试/授权 payload。保留已发布 Gmail-read v1 的严格语义和旧 receipt；新 schema 使用判别字段和兼容迁移，不把旧批准升级为新权限。

需要提供以下后端契约：

| 操作 | 必须提供的语义 |
| --- | --- |
| 启动测试 | 绑定 graph/input revision、资源和模式；返回 request/command ID，分配后再返回真实 native Run ID。 |
| 读取状态/事件 | 返回真实 Run、当前等待原因、pending operation 的脱敏披露、版本、剩余预算和证据引用。支持重连，等待不能丢失。 |
| 确认/拒绝 | 绑定 pending operation/scope digest/version/idempotency key；参数变化返回 conflict，不在请求内接受新的执行输入。 |
| 继续 | 从 checkpoint 继续同一代执行，重验配置、权限和预算；重复提交只产生一次实际调度。 |
| 取消 | 取消整个调用树，显示已完成/已派发/未派发动作和清理结果；无成功假象。 |

新 controller DTO 依照 `api/controllers/API_SCHEMA_GUIDE.md` 使用 Pydantic 和统一响应，schema/接口文档与实现一起更新。执行策略不进入未认证的 `/system-features`。

本轮不编写前端确认弹窗或恢复 UI。后端 E2E 通过已授权测试客户端/正常认证路径执行，浏览器截图展示原生 Run 和结果；额外记录可读 API receipt 和完整 Trace。API 测试不能冒称“确认 UI 已完成”，前端缺口在交付记录中明确列出。

## 8. 验收：完整链路与失败路径

每个用例区分 fixture、模拟返回和真实执行。截图、Trace、授权记录与 native Run/node execution 必须能互相核对；截图不是执行权限或调用次数的唯一证明。

### 8.1 首批必须贯通的业务场景

1. **ENG-1177 原场景**：在具备权限、已发布的测试 Agent 上，按合同风险能力发现资源、展示版本/权限、绑定真实 New Agent；保存 `Start → New Agent → End`，传入 contract_text/jurisdiction，核对 risks/summary。A1/v3 不存在时准备明确标记的自有 fixture，不能声称复现了原 Workspace。
2. **统一组合场景**：`Start → Code → Iteration（内部 New Agent）→ Tool → End`，使用合成输入；真实运行 Python/JS、容器节点和 Agent。Agent 内部触发一次可确认调用，确认后从 pending call 继续，校验结构化输出及外层 Tool 结果。新 Agent 和嵌套授权均为必验，不留到后续票。
3. **动态调用和批量范围**：至少一个运行时才确定参数的内部 Tool 调用，以及有界两次调用范围；范围内无需重复确认，第三次/新目标等待确认。并行预留不能超额。
4. **普通原生节点覆盖矩阵**：从当前受支持模式的注册表生成清单，覆盖逻辑/转换、模型、HTTP/Tool、文件/知识、容器、交互、触发和已有节点兼容路径。触发节点用明确测试事件，交互节点用真实等待/继续；不注册生产监听来凑测试通过。

### 8.2 必须通过的负例

- 未批准、拒绝、撤销、过期、越权、目标/参数/凭据或未启动 Agent snapshot 改变：实际相应调用为 0。
- 拒绝或取消不能触发自动 Fix、默认值/失败分支或改用另一工具来绕过这次决定；是否调整计划由用户选择。
- API → Agent direct daemon/core Tool/子 Workflow/shell 各路径不能丢失上下文，也不能吞掉审批等待后换一条路径继续。
- 浏览器断线、worker 重启、队列重投、并行 claim、Iteration 和 Agent 输出校验重试：不重复已派发操作。
- checkpoint 存储失败不会报告“可恢复等待”；claim 后崩溃或 enqueue 回执丢失不会产生两次恢复。旧版/不兼容 Agent backend 在任何模型、工具、检索或 bootstrap 调用前停止。
- 工具声明构造不提前刷新 OAuth；shell job 丢失不重跑脚本；依赖、输入文件和相关执行范围变化使待执行批准失效。
- 副作用完成后下游失败并进入 Fix：旧 Run/已完成操作记录保留，新验证不会自动重放副作用。
- 外部结果不确定：显示 unknown 并停止自动重放；选择模拟旧响应后不能标记真实通过。
- sandbox 实际输出/输入/资源上限、取消/进程树/清理，以及 Python/Node 串并行跨请求/跨租户隔离；网络 canary 先证明可观测，再验证拒绝路径零外呼。
- Agent test binding 与原会话/文件隔离；实际后端取消与清理；CodeSandbox 和 Agent runtime 分别验收。
- 当前普通 Workflow 和既有 Builder Template/JSON/Gmail v1 策略回归，不把新能力默认赋给旧请求。

真实账户/外部请求只有在账号和具体调用准备好、用户确认明确次数/目标后才执行。本次“开始”批准工程推进，不自动消费一次真实发送或读取授权。

## 9. 工作分解、依赖与交付顺序

四张票共享本文的测试上下文、effect ledger 和 continuation 契约，避免各自建立不同授权模型。工程按以下依赖拆分，独立源码审计/实现/审查尽可能使用 GPT 子 agent 并行：

1. **契约与持久化**（1196/1184）：统一执行状态、scope/intent/attempt、预算与父子 continuation；兼容旧 receipt，明确迁移与服务接口。
2. **并行执行基座**：1189 负责 Code/Jinja 请求隔离；1177 负责资源发现/版本绑定；Agent backend 负责测试上下文、真实调用前授权与暂停/继续协议。三条 lane 依赖同一契约，不能各自发明上下文。
3. **原生串联**（1196/1184/1177）：接入实际 HTTP/model/Tool/OAuth/Agent/shell owner 和子 Workflow；支持共享预算、取消和恢复，逐路径补齐 coverage matrix。
4. **验证与发布**：独立审查、正常 Linux CI/镜像验证、Local 完整 E2E；通过后 push 并按正常 Helm 流程部署 Dev，核对实际 Pods/源码/镜像，再执行 Dev E2E。

实现计划必须明确各 lane 的代码归属、前置测试、集成点和可独立审阅的提交顺序，禁止并行修改同一所有者。不要直接续跑旧 1189 Task2 或采用旧“只准入几个节点”的关闭标准。

四票启动时 In Progress；每张票保留自己的验收记录。Local 与 Dev 验收通过、完整截图/Trace/授权与实际部署证据写入 Linear 后，才将相应交付改为 In Review。部分 lane 通过不能代替整个统一链路通过，也不重开或顺带实现暂停中的 ENG-1117。

## 10. 审查结论与尚待工程验证的事实

本设计已经固定产品行为、授权粒度、状态/证据语义、关键所有者和验收标准。需要实现阶段验证的是原生 checkpoint 的具体扩展、Agent 协议升级、实际执行基座能执行的资源边界和合适预算；这些是明确工程交付项，不能视为当前已有能力。

书面设计批准后编写实施计划，再按计划进入产品实现。当前没有新的 Local/Dev 通过结论，现有 Dev 的实时状态也未因本轮源码审计而得到重新验证。
