# Execution context layer

The execution-context layer carries shared Dify run identifiers plus the tenant
and optional user context needed for plugin-daemon calls. Server settings still
provide the plugin daemon URL and API key.

Use it together with a [plugin LLM layer](../plugin-llm-layer/index.md) and,
when the caller wants Dify tools exposed to the model, a
[plugin tool layer](../plugin-tool-layer/index.md). Both business layers depend
on this layer to reach the plugin daemon.

## Config fields

| Field | Type | Meaning |
| --- | --- | --- |
| `tenant_id` | `str` | Dify tenant/workspace id used when calling the plugin daemon. |
| `user_id` | `str \| None` | Optional end-user id passed through to the plugin daemon. |
| `invoke_from` | `Literal[...]` | Dify caller category recorded for observability and correlation. |
| `app_id` / `workflow_id` / `workflow_run_id` / `node_id` / `node_execution_id` / `conversation_id` / `agent_id` / `agent_config_version_id` / `trace_id` | `str \| None` | Optional Dify-owned execution identifiers forwarded with the run. |

The execution-context layer type id is `dify.execution_context`.

## Basic usage

```python {test="skip" lint="skip"}
from dify_agent.layers.execution_context import (
    DIFY_EXECUTION_CONTEXT_LAYER_TYPE_ID,
    DifyExecutionContextLayerConfig,
)
from dify_agent.protocol import RunLayerSpec


execution_context_layer = RunLayerSpec(
    name="execution_context",
    type=DIFY_EXECUTION_CONTEXT_LAYER_TYPE_ID,
    config=DifyExecutionContextLayerConfig(
        tenant_id="replace-with-tenant-id",
        user_id="replace-with-user-id",
        invoke_from="workflow_run",
    ),
)
```

If you do not need a user id, omit `user_id` or pass `None`. Most optional
execution identifiers may also be omitted when they are not available.

## Server-side settings

The execution-context layer config does not include daemon transport settings.
Configure these on the Dify Agent server instead:

```env
DIFY_AGENT_PLUGIN_DAEMON_URL=http://localhost:5002
DIFY_AGENT_PLUGIN_DAEMON_API_KEY=replace-with-plugin-daemon-server-key
```

This keeps server credentials out of client-submitted layer config and out of
session snapshots.

## Notes

- The execution-context layer does not open, cache, close, or snapshot HTTP clients.
- Concrete `plugin_id` values belong to the business layer that invokes the
  daemon: the plugin LLM layer for model calls and each plugin tool config for
  tool calls.
- The conventional layer name is `execution_context`. If you use another name,
  point the LLM and tool layer dependencies at that name.
