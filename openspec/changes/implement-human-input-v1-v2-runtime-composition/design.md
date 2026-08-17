## Context

当前 graph registry 已支持同一 node type 注册多个版本，但 Human Input 只有 Graphon v1 node class。`DifyNodeFactory` 在完成通用 node-data validation 后，又无条件用 legacy `DifyHumanInputNodeData` 构造 `DifyHITLCallback`，因此 v2 payload 仍泄漏进 v1 validation 和 delivery semantics。

Human Input v2 已有 `HumanInputNodeData`、`ResolvedForm`、`RecipientResolver`、`HumanInputForm`、grant/endpoint domain 和 form creation service，但尚无 workflow-owned v2 node/callback composition。现有 v2 form 又要求 `workflow_pause_id`；Graphon callback 执行时 pause row 尚未创建，并且一个 workflow pause 可以包含多个并行 HITL reason，因此 pause 不是 form 的正确 owner。

## Goals / Non-Goals

### Goals

- 严格、稳定地按 persisted raw version 分派 Human Input v1/v2 runtime。
- 注册真正独立的 Human Input v2 node class。
- 让 v2 Node 与 HITL callback 的全部外部读写只通过注入接口发生。
- 以 `workflow_run_id + workflow_node_execution_id` 标识 v2 runtime form owner。
- 保证 callback 重入及并发 create 不产生重复 form graph 或 delivery attempt。
- 通过 persisted workflow owner 与 workflow pause reason 建立 submission/resume correlation，不让 form 反向持有 pause ID。
- 固定 frozen waiting、submitted 和 node-timeout state 的 callback entry contract；node timeout 进入 `__timeout`，global expiry 不恢复 workflow，callback re-entry 必须作为 invalid resume 拒绝。

### Non-Goals

- 不实现或修改 public Web、Console、Service API、OpenAPI 或 IM controller。
- 不修改 OTP proof、submission authorization、submission persistence、commit-before-enqueue ordering 或 resume task payload；只替换内部可信 workflow correlation。
- 不实现 `all_workspace_contacts` runtime expansion、workspace-contact snapshot port 或 production database adapter；该 marker 继续沿用既有 `UnsupportedRecipientSpecificationError` fail-closed path。
- 不实现 timeout scanner、global-expiry scheduler 或 workflow resume task wiring。
- 不修改 notification producer、Email/IM provider adapter 或 delivery worker。
- 不修改 v2 aggregate/read projection 的既有 `display_in_ui` 字段、业务语义或对外 SSE/pause payload shape。

## Decisions

### 1. Human Input version 在通用 Pydantic coercion 前解析

Human Input version resolver 直接读取 raw node mapping：

- missing `version` 或 exact string `"1"` -> legacy v1 binding
- exact string `"2"` -> v2 binding
- 其他 string、`null`、number、boolean、collection -> stable Human Input configuration error

resolver 不调用 `str(raw_version)`，Human Input 也不允许通过 registry 的 `latest` fallback 接受未知版本。其他 node type 的既有 version resolution 不在本 change 中改变。

非法版本统一抛出 `HumanInputNodeVersionError`，其稳定错误 code 为 `invalid_human_input_node_version`。不同 raw value 可以作为内部诊断信息，但不得通过类型 coercion 改变 dispatch 结果；该异常继续进入现有 workflow configuration-error surface，不新增对外 API shape。

### 2. 注册独立 Human Input v2 node class

新增的 v2 node class：

- `node_type` 仍为 `human-input`
- `version()` 精确返回 `"2"`
- concrete node data 为 strict v2 `HumanInputNodeData`
- 只依赖 Graphon 的 version-neutral HITL callback protocol

v1 继续使用现有 Graphon `HumanInputNode`。`NodeFactory` 先解析 Human Input binding，再使用 binding 的 node class、node-data validation 和 callback builder；v2 callback builder 不解析或合成 legacy `delivery_methods`。

### 3. Node 与 callback 外部能力全部通过接口注入

依赖方向固定为：

`Node -> HITL callback protocol -> v2 runtime application protocol -> injected ports`

Node 只调用注入的 callback。v2 callback 只调用注入的 runtime application protocol，不直接 import 或构造 repository、SQLAlchemy session、ORM model、controller、Celery task、global database handle 或 service locator。

v2 runtime application 至少通过接口获得以下外部能力：

- 按 runtime owner load/create-once form lifecycle state
- 读取 request-scoped Contact directory、initiator 和 delivery capability snapshot
- 提供 clock 和 identifier generation
- 以一个原子 use case 持久化 form、grant、endpoint 和 initial attempt

production composition root 负责 adapter wiring，并复用既有 form creation、notification producer 和 publisher capability。本 change 拥有 `NodeFactory -> v2 runtime application` 的 handoff，但不修改 producer、publisher 或 worker 的内部行为。

### 4. Runtime form owner 使用 workflow run 与 workflow node execution

v2 `HumanInputForm` 删除 `workflow_pause_id`，runtime form 必须保存：

- `workflow_run_id`
- `workflow_node_execution_id`，其语义为 `workflow_node_executions.id`，不是同表的 runtime `node_execution_id` 字段

持久化约束为：

- `workflow_node_execution_id` unique，保证一个 node execution 最多一个 runtime form
- `workflow_run_id` 非 unique 并建立查询索引，允许一个 run/一个最终 pause 包含多个并行 forms
- runtime form 两个 owner 字段都非空
- delivery-test rows 允许两个 workflow owner 字段都为空

### 5. Callback creation 是按 runtime owner 的原子 create-once

callback 第一次执行时使用 `(tenant_id, workflow_run_id, workflow_node_execution_id)` 调用 runtime form port：

- owner 尚无 form：原子创建 form、grants、endpoints 和 initial attempts
- owner 已有 waiting form：返回现有 form 并再次请求 pause
- 并发调用竞争：唯一 owner 只产生一个 winning creation，loser 重新加载同一 form

callback 不采用 `load` 后无约束 `create` 的 check-then-act。重入不得再次运行有副作用的 endpoint capability issuance 或 initial delivery materialization。

Graphon `session_id` 继续携带 form ID，workflow pause repository 在 callback 返回后照常保存多个 reason；form 不反向关联 pause ID。

### 6. Submission/resume correlation 不由 form 持有

`HumanInputForm` 删除 `workflow_pause_id` 后，submission handler 和 resume adapter 不再用 caller-supplied pause ID 与 form 字段做相等性校验。可信 correlation 从持久化关系重建：

- form 提供 `tenant_id + form_id + workflow_run_id + workflow_node_execution_id`
- owning `workflow_node_executions` row 必须属于同一个 workflow run
- active `WorkflowPause` 必须属于同一个 workflow run
- 该 pause 必须存在 `form_id` 匹配当前 form 的 `WorkflowPauseReason`

submission handler 必须在 authorized submission commit 前验证这些 persisted facts，并把验证后的 immutable resume identity 用于 commit 后 enqueue。HTTP/controller DTO、authorization proof、submission transaction 和 commit-before-enqueue ordering 不因该调整改变。

### 7. Frozen lifecycle state 决定 callback 重入结果

callback 读取 runtime port 返回的 frozen state：

- waiting -> 返回同一 form ID 的 `PauseRequested`
- node timeout -> 进入 `Expired(selected_handle="__timeout")`
- global expiry -> 拒绝 callback re-entry，不产生 branch selection
- submitted -> 仅使用 persisted `selected_action_id`、`input_snapshot`、`canonical_values` 和 frozen form definition 返回 `Completed`

callback reload 不重新解释 authoring recipients、form blocks、actions 或 interaction surfaces。node-timeout scheduler 负责把 form 转成 timeout state 并触发 workflow resume；global-expiry orchestration 负责终止 workflow，而不是恢复 node。本 change 为 submitted、node-timeout 和 invalid global-expiry re-entry 添加 injected callback entry tests，但不实现 controller、scheduler 或 resume task wiring。

## Risks / Trade-offs

- runtime owner 约束必须由 domain、ORM model、mapper 和 repository 一致表达；风险通过 mapper round-trip 和多 form owner tests 控制。
- create-once 跨越 form graph 与 initial attempts，repository port 必须拥有事务边界；callback 不自行重试部分写入。
- pause correlation 跨越 form owner、workflow node execution、active pause 和 pause reason；resume resolver 必须一次性验证完整 owner chain，不能信任 caller-supplied pause identity。
- submitted callback decision 必须来自 persisted submission facts 与 frozen form definition，不能在 reload 时重新读取 authoring node data。
- `all_workspace_contacts` 与 `display_in_ui` 保持既有行为，避免把独立 recipient/projection policy 混入本 change。

## Validation

- strict raw version matrix，包括 raw number、boolean、`null`、mapping 和 list。
- registry 证明 v1/v2 分别解析到不同 node class，unknown version 不走 `latest`。
- callback fake-port tests 证明首次创建、waiting reload、并发 create-once 和初始副作用只发生一次。
- 一个 workflow run 中两个并行 v2 Human Input node executions 创建两个 forms，并可进入同一个 workflow pause。
- submission/resume correlation 在 form 不持有 pause ID 时仍能通过 persisted owner chain 找到 matching active pause，并拒绝跨 run/form mismatch。
- frozen submitted state 从 persisted `selected_action_id`、`input_snapshot`、`canonical_values` 与 form definition 返回 `Completed`，不重新解释 authoring configuration。
- frozen node timeout 从 callback test entry 走 `__timeout`；global expiry callback re-entry 被拒绝且不产生 branch selection。
- architecture tests 证明 v2 node/callback 不 import infrastructure 或 transport modules。
- scope regression 证明 `all_workspace_contacts` 继续 fail closed，既有 `display_in_ui` aggregate/projection round-trip 不变。
- v1 published/debug/pause behavior regression 保持不变。

## Deferred Wiring

- `all_workspace_contacts` runtime expansion、production snapshot adapter 与 NodeFactory composition
- node-timeout reload trigger、workflow resume task 与 global-expiry workflow-stop orchestration
- submitted outcome 的 controller/resume-task trigger
- endpoint-derived `display_in_ui` aggregate cleanup 与 SSE/pause consumer
- public/console/service/IM read and submit controllers
