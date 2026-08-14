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
- 完成 `all_workspace_contacts` 的纯 runtime expansion 和去重逻辑，并保留 production provider wiring seam。
- 固定 frozen timeout/global-expiry state 到 `__timeout__` 的 callback entry contract。
- 移除 `display_in_ui` 对 v2 aggregate/projection 的反向业务控制。

### Non-Goals

- 不实现或修改 public Web、Console、Service API、OpenAPI 或 IM controller。
- 不修改 OTP proof、submission authorization、submission persistence 或 resume enqueue。
- 不实现 production workspace-contact database adapter，也不在 production composition 中启用 `all_workspace_contacts`。
- 不实现 timeout scanner、global-expiry scheduler 或 workflow resume task wiring。
- 不修改 notification producer、Email/IM provider adapter 或 delivery worker。
- 不修改对外 SSE/pause payload shape；derived `display_in_ui` 的 consumer wiring 延后。

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
- 读取 `all_workspace_contacts` 所需的 current workspace Contact snapshot
- 提供 clock 和 identifier generation
- 以一个原子 use case 持久化 form、grant、endpoint 和 initial attempt

production composition root 负责 adapter wiring。当前 change 只 wiring 已有 form/runtime capability；`all_workspace_contacts` production snapshot provider 保留为后续显式 wiring 点。

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

callback 第一次执行时使用 `(workspace_id, workflow_run_id, workflow_node_execution_id)` 调用 runtime form port：

- owner 尚无 form：原子创建 form、grants、endpoints 和 initial attempts
- owner 已有 waiting form：返回现有 form 并再次请求 pause
- 并发调用竞争：唯一 owner 只产生一个 winning creation，loser 重新加载同一 form

callback 不采用 `load` 后无约束 `create` 的 check-then-act。重入不得再次运行有副作用的 endpoint capability issuance 或 initial delivery materialization。

Graphon `session_id` 继续携带 form ID，workflow pause repository 在 callback 返回后照常保存多个 reason；form 不反向关联 pause ID。

### 6. `all_workspace_contacts` 在 runtime resolution 中展开

workflow adapter 将 marker 转成 typed runtime recipient specification，而不是 fail-closed。runtime application 通过 `WorkspaceContactSnapshotPort` 一类窄接口取得 current-workspace-scoped candidate snapshot；每个 candidate 同时携带 canonical Contact snapshot 与其 workspace-relative `WORKSPACE` / `PLATFORM` / `EXTERNAL` classification。runtime core 而不是 adapter 负责：

- 只选择分类为 `WORKSPACE` 且 available 的 Contacts
- 排除 `PLATFORM` 和 `EXTERNAL` Contacts
- 返回 immutable request-scoped snapshot

resolver 按稳定 Contact ID 顺序展开 marker，并为 expanded Contact 保留 `ALL_WORKSPACE_CONTACTS` matched-source fact。所有 recipient 随后进入既有 canonical subject dedup：同一个 Contact 同时来自 marker 和显式 Contact 时只产生一个 approver，并保留两个 matched sources；同一 canonical endpoint 只产生一次 delivery。Contact 与同 Email 的独立 `EmailAddress` recipient 仍是不同 subject，不因本规则合并。

本 change 使用 fake/in-memory port 完成 domain/application tests；SQLAlchemy adapter 和 production injection 由后续 change 实现。

### 7. Frozen lifecycle state 决定 callback 重入结果

callback reload 不重新解释 authoring recipients、form blocks 或 interaction surfaces。它读取 runtime port 返回的 frozen state：

- waiting -> 返回同一 form ID 的 `PauseRequested`
- node timeout -> 进入 `Expired(selected_handle="__timeout__")`
- global expiry -> 进入 `Expired(selected_handle="__timeout__")`
- submitted outcome -> 预留从 frozen submission outcome 恢复的入口

本 change 为 timeout/global-expiry 两种状态添加 callback entry tests，但不实现触发 callback reload 的 scheduler、resume task 或 controller wiring。

### 8. `display_in_ui` 只允许作为 derived compatibility projection

v2 `HumanInputForm` 和 `FormDefinitionProjection` 不再保存或消费 authoritative `display_in_ui`。交互能力只来自 resolved endpoint plans 和 persisted endpoints。

既有 SSE/pause response 字段暂时保留，必须按请求 surface 从 `WebEndpoint` / `ConsoleEndpoint` 等 capability 派生。derived 字段不能反向创建、删除或改变 endpoint。由于本 change 不做对外 response wiring，只添加 derivation contract 和测试入口。

## Risks / Trade-offs

- runtime owner 约束必须由 domain、ORM model、mapper 和 repository 一致表达；风险通过 mapper round-trip 和多 form owner tests 控制。
- create-once 跨越 form graph 与 initial attempts，repository port 必须拥有事务边界；callback 不自行重试部分写入。
- `all_workspace_contacts` 在 production provider wiring 完成前不能真实运行。runtime core 和接口先合并，rollout 继续 fail closed，不允许静默返回空 recipient 集合。
- 对外 `display_in_ui` 暂不删除，避免无关 API breaking change；其 derived wiring 由后续 change 完成。

## Validation

- strict raw version matrix，包括 raw number、boolean、`null`、mapping 和 list。
- registry 证明 v1/v2 分别解析到不同 node class，unknown version 不走 `latest`。
- callback fake-port tests 证明首次创建、waiting reload、并发 create-once 和初始副作用只发生一次。
- 一个 workflow run 中两个并行 v2 Human Input node executions 创建两个 forms，并可进入同一个 workflow pause。
- `all_workspace_contacts` 只展开 Workspace Contacts，稳定排序，并与显式 Contact 去重。
- frozen node timeout/global expiry 均从 callback test entry 走 `__timeout__`。
- architecture tests 证明 v2 node/callback 不 import infrastructure 或 transport modules。
- v1 published/debug/pause behavior regression 保持不变。

## Deferred Wiring

- production workspace-contact snapshot adapter 与 NodeFactory composition
- timeout/global-expiry reload trigger 与 workflow resume task
- submitted outcome 到 graph outputs 的完整 production resume wiring
- SSE/pause derived `display_in_ui` consumer
- public/console/service/IM read and submit controllers
