# Dify Enterprise Telemetry Data Dictionary

Quick reference for all telemetry signals emitted by Dify Enterprise. For configuration and architecture details, see [README.md](./README.md).

## Resource Attributes

Attached to every signal (Span, Metric, Log).

| Attribute | Type | Example |
|-----------|------|---------|
| `service.name` | string | `dify` |
| `host.name` | string | `dify-api-7f8b` |

## Traces (Spans)

### `dify.workflow.run`

| Attribute | Type | Description |
|-----------|------|-------------|
| `dify.trace_id` | string | Business trace ID (Workflow Run ID) |
| `dify.tenant_id` | string | Tenant identifier |
| `dify.app_id` | string | Application identifier |
| `dify.workflow.id` | string | Workflow definition ID |
| `dify.workflow.run_id` | string | Unique ID for this run |
| `dify.workflow.status` | string | `succeeded`, `failed`, `stopped`, etc. |
| `dify.workflow.error` | string | Error message if failed |
| `dify.workflow.elapsed_time` | float | Total execution time (seconds) |
| `dify.invoke_from` | string | `api`, `webapp`, `debug` |
| `dify.conversation.id` | string | Conversation ID (optional) |
| `dify.message.id` | string | Message ID (optional) |
| `dify.invoked_by` | string | User ID who triggered the run |
| `gen_ai.usage.total_tokens` | int | Total tokens across all nodes (optional) |
| `gen_ai.user.id` | string | End-user identifier (optional) |
| `dify.parent.trace_id` | string | Parent workflow trace ID (optional) |
| `dify.parent.workflow.run_id` | string | Parent workflow run ID (optional) |
| `dify.parent.node.execution_id` | string | Parent node execution ID (optional) |
| `dify.parent.app.id` | string | Parent app ID (optional) |

### `dify.node.execution`

| Attribute | Type | Description |
|-----------|------|-------------|
| `dify.trace_id` | string | Business trace ID |
| `dify.tenant_id` | string | Tenant identifier |
| `dify.app_id` | string | Application identifier |
| `dify.workflow.id` | string | Workflow definition ID |
| `dify.workflow.run_id` | string | Workflow Run ID |
| `dify.message.id` | string | Message ID (optional) |
| `dify.conversation.id` | string | Conversation ID (optional) |
| `dify.node.execution_id` | string | Unique node execution ID |
| `dify.node.id` | string | Node ID in workflow graph |
| `dify.node.type` | string | Node type (see appendix) |
| `dify.node.title` | string | Display title |
| `dify.node.status` | string | `succeeded`, `failed` |
| `dify.node.error` | string | Error message if failed |
| `dify.node.elapsed_time` | float | Execution time (seconds) |
| `dify.node.index` | int | Execution order index |
| `dify.node.predecessor_node_id` | string | Triggering node ID |
| `dify.node.iteration_id` | string | Iteration ID (optional) |
| `dify.node.loop_id` | string | Loop ID (optional) |
| `dify.node.parallel_id` | string | Parallel branch ID (optional) |
| `dify.node.invoked_by` | string | User ID who triggered execution |
| `gen_ai.usage.input_tokens` | int | Prompt tokens (LLM nodes only) |
| `gen_ai.usage.output_tokens` | int | Completion tokens (LLM nodes only) |
| `gen_ai.usage.total_tokens` | int | Total tokens (LLM nodes only) |
| `gen_ai.request.model` | string | LLM model name (LLM nodes only) |
| `gen_ai.provider.name` | string | LLM provider name (LLM nodes only) |
| `gen_ai.user.id` | string | End-user identifier (optional) |

### `dify.node.execution.draft`

Same attributes as `dify.node.execution`. Emitted during Preview/Debug runs.

## Counters

All counters are cumulative and emitted at 100% accuracy.

### Token Counters

| Metric | Unit | Description |
|--------|------|-------------|
| `dify.tokens.total` | `{token}` | Total tokens consumed |
| `dify.tokens.input` | `{token}` | Input (prompt) tokens |
| `dify.tokens.output` | `{token}` | Output (completion) tokens |

**Labels:**

- `tenant_id`, `app_id`, `operation_type`, `model_provider`, `model_name`, `node_type` (if node_execution)

⚠️ **Warning:** `dify.tokens.total` at workflow level includes all node tokens. Filter by `operation_type` to avoid double-counting.

#### Token Hierarchy & Query Patterns

Token metrics are emitted at multiple layers. Understanding the hierarchy prevents double-counting:

```
App-level total
├── workflow          ← sum of all node_execution tokens (DO NOT add both)
│   └── node_execution ← per-node breakdown
├── message           ← independent (non-workflow chat apps only)
├── rule_generate     ← independent helper LLM call
├── code_generate     ← independent helper LLM call
├── structured_output ← independent helper LLM call
└── instruction_modify← independent helper LLM call
```

**Key rule:** `workflow` tokens already include all `node_execution` tokens. Never sum both.

**Available labels on token metrics:** `tenant_id`, `app_id`, `operation_type`, `model_provider`, `model_name`, `node_type`.
App name is only available on span attributes (`dify.app.name`), not metric labels — use `app_id` for metric queries.

**Common queries** (PromQL):

```promql
# ── Totals ──────────────────────────────────────────────────
# App-level total (exclude node_execution to avoid double-counting)
sum by (app_id) (dify_tokens_total{operation_type!="node_execution"})

# Single app total
sum (dify_tokens_total{app_id="<app_id>", operation_type!="node_execution"})

# Per-tenant totals
sum by (tenant_id) (dify_tokens_total{operation_type!="node_execution"})

# ── Drill-down ──────────────────────────────────────────────
# Workflow-level tokens for an app
sum (dify_tokens_total{app_id="<app_id>", operation_type="workflow"})

# Node-level breakdown within an app
sum by (node_type) (dify_tokens_total{app_id="<app_id>", operation_type="node_execution"})

# Model breakdown for an app
sum by (model_provider, model_name) (dify_tokens_total{app_id="<app_id>"})

# Input vs output per model
sum by (model_name) (dify_tokens_input_total{app_id="<app_id>"})
sum by (model_name) (dify_tokens_output_total{app_id="<app_id>"})

# ── Rates ───────────────────────────────────────────────────
# Token consumption rate (per hour)
sum(rate(dify_tokens_total{operation_type!="node_execution"}[1h]))

# Per-app consumption rate
sum by (app_id) (rate(dify_tokens_total{operation_type!="node_execution"}[1h]))
```

**Finding `app_id` from app name** (trace query — Tempo / Jaeger):

```
{ resource.dify.app.name = "My Chatbot" } | select(resource.dify.app.id)
```

### Request Counters

| Metric | Unit | Description |
|--------|------|-------------|
| `dify.requests.total` | `{request}` | Total operations count |

**Labels by type:**

| `type` | Additional Labels |
|--------|-------------------|
| `workflow` | `tenant_id`, `app_id`, `status`, `invoke_from` |
| `node` | `tenant_id`, `app_id`, `node_type`, `model_provider`, `model_name`, `status` |
| `draft_node` | `tenant_id`, `app_id`, `node_type`, `model_provider`, `model_name`, `status` |
| `message` | `tenant_id`, `app_id`, `model_provider`, `model_name`, `status`, `invoke_from` |
| `tool` | `tenant_id`, `app_id`, `tool_name` |
| `moderation` | `tenant_id`, `app_id` |
| `suggested_question` | `tenant_id`, `app_id`, `model_provider`, `model_name` |
| `dataset_retrieval` | `tenant_id`, `app_id` |
| `generate_name` | `tenant_id`, `app_id` |
| `prompt_generation` | `tenant_id`, `app_id`, `operation_type`, `model_provider`, `model_name`, `status` |

### Error Counters

| Metric | Unit | Description |
|--------|------|-------------|
| `dify.errors.total` | `{error}` | Total failed operations |

**Labels by type:**

| `type` | Additional Labels |
|--------|-------------------|
| `workflow` | `tenant_id`, `app_id` |
| `node` | `tenant_id`, `app_id`, `node_type`, `model_provider`, `model_name` |
| `draft_node` | `tenant_id`, `app_id`, `node_type`, `model_provider`, `model_name` |
| `message` | `tenant_id`, `app_id`, `model_provider`, `model_name` |
| `tool` | `tenant_id`, `app_id`, `tool_name` |
| `prompt_generation` | `tenant_id`, `app_id`, `operation_type`, `model_provider`, `model_name` |

### Other Counters

| Metric | Unit | Labels |
|--------|------|--------|
| `dify.feedback.total` | `{feedback}` | `tenant_id`, `app_id`, `rating` |
| `dify.dataset.retrievals.total` | `{retrieval}` | `tenant_id`, `app_id`, `dataset_id`, `embedding_model_provider`, `embedding_model`, `rerank_model_provider`, `rerank_model` |
| `dify.app.created.total` | `{app}` | `tenant_id`, `app_id`, `mode` |
| `dify.app.updated.total` | `{app}` | `tenant_id`, `app_id` |
| `dify.app.deleted.total` | `{app}` | `tenant_id`, `app_id` |

## Histograms

| Metric | Unit | Labels |
|--------|------|--------|
| `dify.workflow.duration` | `s` | `tenant_id`, `app_id`, `status` |
| `dify.node.duration` | `s` | `tenant_id`, `app_id`, `node_type`, `model_provider`, `model_name`, `plugin_name` |
| `dify.message.duration` | `s` | `tenant_id`, `app_id`, `model_provider`, `model_name` |
| `dify.message.time_to_first_token` | `s` | `tenant_id`, `app_id`, `model_provider`, `model_name` |
| `dify.tool.duration` | `s` | `tenant_id`, `app_id`, `tool_name` |
| `dify.prompt_generation.duration` | `s` | `tenant_id`, `app_id`, `operation_type`, `model_provider`, `model_name` |

## Structured Logs

### Span Companion Logs

Logs that accompany spans. Signal type: `span_detail`

#### `dify.workflow.run` Companion Log

**Common attributes:** All span attributes (see Traces section) plus:

| Additional Attribute | Type | Always Present | Description |
|---------------------|------|----------------|-------------|
| `dify.app.name` | string | No | Application display name |
| `dify.workspace.name` | string | No | Workspace display name |
| `dify.workflow.version` | string | Yes | Workflow definition version |
| `dify.workflow.inputs` | string/JSON | Yes | Input parameters (content-gated) |
| `dify.workflow.outputs` | string/JSON | Yes | Output results (content-gated) |
| `dify.workflow.query` | string | No | User query text (content-gated) |

**Event attributes:**

- `dify.event.name`: `"dify.workflow.run"`
- `dify.event.signal`: `"span_detail"`
- `trace_id`, `span_id`, `tenant_id`, `user_id`

#### `dify.node.execution` and `dify.node.execution.draft` Companion Logs

**Common attributes:** All span attributes (see Traces section) plus:

| Additional Attribute | Type | Always Present | Description |
|---------------------|------|----------------|-------------|
| `dify.app.name` | string | No | Application display name |
| `dify.workspace.name` | string | No | Workspace display name |
| `dify.invoke_from` | string | No | Invocation source |
| `gen_ai.tool.name` | string | No | Tool name (tool nodes only) |
| `dify.node.total_price` | float | No | Cost (LLM nodes only) |
| `dify.node.currency` | string | No | Currency code (LLM nodes only) |
| `dify.node.iteration_index` | int | No | Iteration index (iteration nodes) |
| `dify.node.loop_index` | int | No | Loop index (loop nodes) |
| `dify.plugin.name` | string | No | Plugin name (tool/knowledge nodes) |
| `dify.credential.name` | string | No | Credential name (plugin nodes) |
| `dify.credential.id` | string | No | Credential ID (plugin nodes) |
| `dify.dataset.ids` | JSON array | No | Dataset IDs (knowledge nodes) |
| `dify.dataset.names` | JSON array | No | Dataset names (knowledge nodes) |
| `dify.node.inputs` | string/JSON | Yes | Node inputs (content-gated) |
| `dify.node.outputs` | string/JSON | Yes | Node outputs (content-gated) |
| `dify.node.process_data` | string/JSON | No | Processing data (content-gated) |

**Event attributes:**

- `dify.event.name`: `"dify.node.execution"` or `"dify.node.execution.draft"`
- `dify.event.signal`: `"span_detail"`
- `trace_id`, `span_id`, `tenant_id`, `user_id`

### Standalone Logs

Logs without structural spans. Signal type: `metric_only`

#### `dify.message.run`

| Attribute | Type | Description |
|-----------|------|-------------|
| `dify.event.name` | string | `"dify.message.run"` |
| `dify.event.signal` | string | `"metric_only"` |
| `trace_id` | string | OTEL trace ID (32-char hex) |
| `span_id` | string | OTEL span ID (16-char hex) |
| `tenant_id` | string | Tenant identifier |
| `user_id` | string | User identifier (optional) |
| `dify.app_id` | string | Application identifier |
| `dify.message.id` | string | Message identifier |
| `dify.conversation.id` | string | Conversation ID (optional) |
| `dify.workflow.run_id` | string | Workflow run ID (optional) |
| `dify.invoke_from` | string | `service-api`, `web-app`, `debugger`, `explore` |
| `gen_ai.provider.name` | string | LLM provider |
| `gen_ai.request.model` | string | LLM model |
| `gen_ai.usage.input_tokens` | int | Input tokens |
| `gen_ai.usage.output_tokens` | int | Output tokens |
| `gen_ai.usage.total_tokens` | int | Total tokens |
| `dify.message.status` | string | `succeeded`, `failed` |
| `dify.message.error` | string | Error message (if failed) |
| `dify.message.duration` | float | Duration (seconds) |
| `dify.message.time_to_first_token` | float | TTFT (seconds) |
| `dify.message.inputs` | string/JSON | Inputs (content-gated) |
| `dify.message.outputs` | string/JSON | Outputs (content-gated) |

#### `dify.tool.execution`

| Attribute | Type | Description |
|-----------|------|-------------|
| `dify.event.name` | string | `"dify.tool.execution"` |
| `dify.event.signal` | string | `"metric_only"` |
| `trace_id` | string | OTEL trace ID |
| `span_id` | string | OTEL span ID |
| `tenant_id` | string | Tenant identifier |
| `dify.app_id` | string | Application identifier |
| `dify.message.id` | string | Message identifier |
| `dify.tool.name` | string | Tool name |
| `dify.tool.duration` | float | Duration (seconds) |
| `dify.tool.status` | string | `succeeded`, `failed` |
| `dify.tool.error` | string | Error message (if failed) |
| `dify.tool.inputs` | string/JSON | Inputs (content-gated) |
| `dify.tool.outputs` | string/JSON | Outputs (content-gated) |
| `dify.tool.parameters` | string/JSON | Parameters (content-gated) |
| `dify.tool.config` | string/JSON | Configuration (content-gated) |

#### `dify.moderation.check`

| Attribute | Type | Description |
|-----------|------|-------------|
| `dify.event.name` | string | `"dify.moderation.check"` |
| `dify.event.signal` | string | `"metric_only"` |
| `trace_id` | string | OTEL trace ID |
| `span_id` | string | OTEL span ID |
| `tenant_id` | string | Tenant identifier |
| `dify.app_id` | string | Application identifier |
| `dify.message.id` | string | Message identifier |
| `dify.moderation.type` | string | `input`, `output` |
| `dify.moderation.action` | string | `pass`, `block`, `flag` |
| `dify.moderation.flagged` | boolean | Whether flagged |
| `dify.moderation.categories` | JSON array | Flagged categories |
| `dify.moderation.query` | string | Content (content-gated) |

#### `dify.suggested_question.generation`

| Attribute | Type | Description |
|-----------|------|-------------|
| `dify.event.name` | string | `"dify.suggested_question.generation"` |
| `dify.event.signal` | string | `"metric_only"` |
| `trace_id` | string | OTEL trace ID |
| `span_id` | string | OTEL span ID |
| `tenant_id` | string | Tenant identifier |
| `dify.app_id` | string | Application identifier |
| `dify.message.id` | string | Message identifier |
| `dify.suggested_question.count` | int | Number of questions |
| `dify.suggested_question.duration` | float | Duration (seconds) |
| `dify.suggested_question.status` | string | `succeeded`, `failed` |
| `dify.suggested_question.error` | string | Error message (if failed) |
| `dify.suggested_question.questions` | JSON array | Questions (content-gated) |

#### `dify.dataset.retrieval`

| Attribute | Type | Description |
|-----------|------|-------------|
| `dify.event.name` | string | `"dify.dataset.retrieval"` |
| `dify.event.signal` | string | `"metric_only"` |
| `trace_id` | string | OTEL trace ID |
| `span_id` | string | OTEL span ID |
| `tenant_id` | string | Tenant identifier |
| `dify.app_id` | string | Application identifier |
| `dify.message.id` | string | Message identifier |
| `dify.dataset.id` | string | Dataset identifier |
| `dify.dataset.name` | string | Dataset name |
| `dify.dataset.embedding_providers` | JSON array | Embedding model providers (one per dataset) |
| `dify.dataset.embedding_models` | JSON array | Embedding models (one per dataset) |
| `dify.retrieval.rerank_provider` | string | Rerank model provider |
| `dify.retrieval.rerank_model` | string | Rerank model name |
| `dify.retrieval.query` | string | Search query (content-gated) |
| `dify.retrieval.document_count` | int | Documents retrieved |
| `dify.retrieval.duration` | float | Duration (seconds) |
| `dify.retrieval.status` | string | `succeeded`, `failed` |
| `dify.retrieval.error` | string | Error message (if failed) |
| `dify.dataset.documents` | JSON array | Documents (content-gated) |

#### `dify.generate_name.execution`

| Attribute | Type | Description |
|-----------|------|-------------|
| `dify.event.name` | string | `"dify.generate_name.execution"` |
| `dify.event.signal` | string | `"metric_only"` |
| `trace_id` | string | OTEL trace ID |
| `span_id` | string | OTEL span ID |
| `tenant_id` | string | Tenant identifier |
| `dify.app_id` | string | Application identifier |
| `dify.conversation.id` | string | Conversation identifier |
| `dify.generate_name.duration` | float | Duration (seconds) |
| `dify.generate_name.status` | string | `succeeded`, `failed` |
| `dify.generate_name.error` | string | Error message (if failed) |
| `dify.generate_name.inputs` | string/JSON | Inputs (content-gated) |
| `dify.generate_name.outputs` | string | Generated name (content-gated) |

#### `dify.prompt_generation.execution`

| Attribute | Type | Description |
|-----------|------|-------------|
| `dify.event.name` | string | `"dify.prompt_generation.execution"` |
| `dify.event.signal` | string | `"metric_only"` |
| `trace_id` | string | OTEL trace ID |
| `span_id` | string | OTEL span ID |
| `tenant_id` | string | Tenant identifier |
| `dify.app_id` | string | Application identifier |
| `dify.prompt_generation.operation_type` | string | Operation type (see appendix) |
| `gen_ai.provider.name` | string | LLM provider |
| `gen_ai.request.model` | string | LLM model |
| `gen_ai.usage.input_tokens` | int | Input tokens |
| `gen_ai.usage.output_tokens` | int | Output tokens |
| `gen_ai.usage.total_tokens` | int | Total tokens |
| `dify.prompt_generation.duration` | float | Duration (seconds) |
| `dify.prompt_generation.status` | string | `succeeded`, `failed` |
| `dify.prompt_generation.error` | string | Error message (if failed) |
| `dify.prompt_generation.instruction` | string | Instruction (content-gated) |
| `dify.prompt_generation.output` | string/JSON | Output (content-gated) |

#### `dify.app.created`

| Attribute | Type | Description |
|-----------|------|-------------|
| `dify.event.name` | string | `"dify.app.created"` |
| `dify.event.signal` | string | `"metric_only"` |
| `tenant_id` | string | Tenant identifier |
| `dify.app_id` | string | Application identifier |
| `dify.app.mode` | string | `chat`, `completion`, `agent-chat`, `workflow` |
| `dify.app.created_at` | string | Timestamp (ISO 8601) |

#### `dify.app.updated`

| Attribute | Type | Description |
|-----------|------|-------------|
| `dify.event.name` | string | `"dify.app.updated"` |
| `dify.event.signal` | string | `"metric_only"` |
| `tenant_id` | string | Tenant identifier |
| `dify.app_id` | string | Application identifier |
| `dify.app.updated_at` | string | Timestamp (ISO 8601) |

#### `dify.app.deleted`

| Attribute | Type | Description |
|-----------|------|-------------|
| `dify.event.name` | string | `"dify.app.deleted"` |
| `dify.event.signal` | string | `"metric_only"` |
| `tenant_id` | string | Tenant identifier |
| `dify.app_id` | string | Application identifier |
| `dify.app.deleted_at` | string | Timestamp (ISO 8601) |

#### `dify.feedback.created`

| Attribute | Type | Description |
|-----------|------|-------------|
| `dify.event.name` | string | `"dify.feedback.created"` |
| `dify.event.signal` | string | `"metric_only"` |
| `trace_id` | string | OTEL trace ID |
| `span_id` | string | OTEL span ID |
| `tenant_id` | string | Tenant identifier |
| `dify.app_id` | string | Application identifier |
| `dify.message.id` | string | Message identifier |
| `dify.feedback.rating` | string | `like`, `dislike`, `null` |
| `dify.feedback.content` | string | Feedback text (content-gated) |
| `dify.feedback.created_at` | string | Timestamp (ISO 8601) |

#### `dify.telemetry.rehydration_failed`

Diagnostic event for telemetry system health monitoring.

| Attribute | Type | Description |
|-----------|------|-------------|
| `dify.event.name` | string | `"dify.telemetry.rehydration_failed"` |
| `dify.event.signal` | string | `"metric_only"` |
| `tenant_id` | string | Tenant identifier |
| `dify.telemetry.error` | string | Error message |
| `dify.telemetry.payload_type` | string | Payload type (see appendix) |
| `dify.telemetry.correlation_id` | string | Correlation ID |

## Content-Gated Attributes

When `ENTERPRISE_INCLUDE_CONTENT=false`, these attributes are replaced with reference strings (`ref:{id_type}={uuid}`).

| Attribute | Signal |
|-----------|--------|
| `dify.workflow.inputs` | `dify.workflow.run` |
| `dify.workflow.outputs` | `dify.workflow.run` |
| `dify.workflow.query` | `dify.workflow.run` |
| `dify.node.inputs` | `dify.node.execution` |
| `dify.node.outputs` | `dify.node.execution` |
| `dify.node.process_data` | `dify.node.execution` |
| `dify.message.inputs` | `dify.message.run` |
| `dify.message.outputs` | `dify.message.run` |
| `dify.tool.inputs` | `dify.tool.execution` |
| `dify.tool.outputs` | `dify.tool.execution` |
| `dify.tool.parameters` | `dify.tool.execution` |
| `dify.tool.config` | `dify.tool.execution` |
| `dify.moderation.query` | `dify.moderation.check` |
| `dify.suggested_question.questions` | `dify.suggested_question.generation` |
| `dify.retrieval.query` | `dify.dataset.retrieval` |
| `dify.dataset.documents` | `dify.dataset.retrieval` |
| `dify.generate_name.inputs` | `dify.generate_name.execution` |
| `dify.generate_name.outputs` | `dify.generate_name.execution` |
| `dify.prompt_generation.instruction` | `dify.prompt_generation.execution` |
| `dify.prompt_generation.output` | `dify.prompt_generation.execution` |
| `dify.feedback.content` | `dify.feedback.created` |

## Appendix

### Operation Types

- `workflow`, `node_execution`, `message`, `rule_generate`, `code_generate`, `structured_output`, `instruction_modify`

### Node Types

- `start`, `end`, `answer`, `llm`, `knowledge-retrieval`, `knowledge-index`, `if-else`, `code`, `template-transform`, `question-classifier`, `http-request`, `tool`, `datasource`, `variable-aggregator`, `loop`, `iteration`, `parameter-extractor`, `assigner`, `document-extractor`, `list-operator`, `agent`, `trigger-webhook`, `trigger-schedule`, `trigger-plugin`, `human-input`

### Workflow Statuses

- `running`, `succeeded`, `failed`, `stopped`, `partial-succeeded`, `paused`

### Payload Types

- `workflow`, `node`, `message`, `tool`, `moderation`, `suggested_question`, `dataset_retrieval`, `generate_name`, `prompt_generation`, `app`, `feedback`

### Null Value Behavior

**Spans:** Attributes with `null` values are omitted.

**Logs:** Attributes with `null` values appear as `null` in JSON.

**Content-Gated:** Replaced with reference strings, not set to `null`.
