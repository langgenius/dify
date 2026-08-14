## Why

Workflow runtime 已经同时持有 Human Input v1 与 v2 node data，但 `NodeFactory` 仍将所有 `type: human-input` 节点送入 legacy node class、legacy validation 和 legacy callback。与此同时，v2 runtime form 错误地依赖后置创建的 `workflow_pause_id`，无法表达同一个 workflow pause 内的多个并行 Human Input form，也使 callback 重入时缺少稳定的 create-once owner。

本 change 只修复 workflow node runtime 与 HITL callback composition：建立严格版本分派、独立 v2 node class、基于 workflow run/node execution 的 runtime owner，以及可注入、可重入的 v2 callback 边界。Controller、submission、OTP、delivery worker 和对外 API wiring 由后续 change 负责。

## What Changes

- 对 persisted Human Input node 的 raw `version` 做严格分派：missing / exact `"1"` 走 v1，exact `"2"` 走独立 v2 node class，其他值在 Pydantic coercion 前返回稳定配置错误。
- 注册独立的 Human Input v2 node class，并由 `NodeFactory` 注入 version-specific HITL callback；v2 payload 不再经过 legacy `HumanInputNodeData` 或 `delivery_methods` adaptation。
- 将 v2 runtime form owner 从 `workflow_pause_id` 改为 `workflow_run_id + workflow_node_execution_id`。一个 workflow run 可拥有多个 form，一个 workflow node execution 最多拥有一个 v2 runtime form。
- 通过原子 create-once runtime form port 保证 HITL callback 重入不会重复创建 form、grant、endpoint 或 initial delivery attempt。
- 为 v2 runtime callback 的所有外部读写定义窄接口，并由 composition root 注入；Node 和 callback 不直接读取 ORM、数据库 session、controller state、Celery 或 service locator。
- 支持 `all_workspace_contacts` 的 runtime expansion core：通过注入接口取得当前 workspace 的 `WORKSPACE` contacts，排除 `PLATFORM` 和 `EXTERNAL` contacts，并与显式 Contact recipient 按 canonical Contact identity 去重。生产 contact provider wiring 不在本 change。
- 从 v2 aggregate/read projection 中移除 `display_in_ui` 的业务权威性；外部 SSE/pause compatibility 字段保持不变，只允许从 endpoint capability 派生。对外 projection wiring 不在本 change。
- 固定 v2 callback 从 frozen lifecycle state 进入 `__timeout__` 的合同和测试入口；实际 timeout/global-expiry resume trigger wiring 不在本 change。

## Capabilities

### New Capabilities

- `human-input-versioned-runtime-dispatch`: 定义严格的 Human Input v1/v2 node class 分派、callback composition 和外部能力注入边界。

### Modified Capabilities

- `human-input-v2-form-core`: 将 runtime owner 改为 workflow run/node execution，增加 callback create-once 约束，并移除 `display_in_ui` 的 aggregate/projection 权威性。
- `human-input-v2-recipient-resolution-core`: 定义 `all_workspace_contacts` 的 request-scoped runtime expansion、workspace-only 过滤和 canonical Contact 去重。

## Impact

- 主要影响：
  - `api/core/workflow/node_factory.py`
  - `api/core/workflow/human_input_adapter.py`
  - `api/core/workflow/nodes/human_input_v2/*`
  - v2 runtime form domain、ORM model、mapper 与 repository port
- 保持不变：
  - v1 node class、legacy callback、legacy route/token/submission behavior
  - public/console/service/IM controller contract
  - OTP verification、submission authorization、workflow resume enqueue
  - Email/IM provider delivery worker
- 后续 wiring 依赖：
  - production `all_workspace_contacts` snapshot provider
  - timeout/global-expiry resume trigger
  - SSE/pause derived `display_in_ui` projection consumer
