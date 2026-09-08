# Plugin LLM layer

The plugin LLM layer selects the plugin package, model provider, model name,
and optional model settings for the current run. Dify Agent reads the model
from the reserved layer name `llm`; Dify API resolves model credentials.

It must depend on an [execution context layer](../execution-context-layer/index.md),
because that layer supplies the caller identity required by the API gateway.

## Config fields

| Field | Type | Meaning |
| --- | --- | --- |
| `plugin_id` | `str` | Plugin package id, for example `langgenius/openai`. |
| `model_provider` | `str` | Provider name inside `plugin_id`. Use the value of `DIFY_AGENT_PROVIDER` from `dify-agent/.env`. |
| `model` | `str` | Model name. Use the value of `DIFY_AGENT_MODEL_NAME` from `dify-agent/.env`. |
| `model_settings` | `ModelSettings \| None` | Optional pydantic-ai model settings. |
| `context_window_tokens` | `int \| None` | Positive effective context-window capability metadata. Enables window-based compaction when present; omission disables it. |

The plugin LLM layer type id is `dify.plugin.llm`.

## Basic usage

```python {test="skip" lint="skip"}
from dify_agent.layers.dify_plugin import DIFY_PLUGIN_LLM_LAYER_TYPE_ID, DifyPluginLLMLayerConfig
from dify_agent.protocol import DIFY_AGENT_MODEL_LAYER_ID, RunLayerSpec


MODEL_PROVIDER = "replace-with-provider-from-dify-agent-env"
MODEL_NAME = "replace-with-model-from-dify-agent-env"
PLUGIN_ID = "langgenius/openai"

llm_layer = RunLayerSpec(
    name=DIFY_AGENT_MODEL_LAYER_ID,
    type=DIFY_PLUGIN_LLM_LAYER_TYPE_ID,
    deps={"execution_context": "execution_context"},
    config=DifyPluginLLMLayerConfig(
        plugin_id=PLUGIN_ID,
        model_provider=MODEL_PROVIDER,
        model=MODEL_NAME,
    ),
)
```

`deps={"execution_context": "execution_context"}` means: bind the LLM layer's
dependency field named `execution_context` to the composition layer named
`execution_context`.

Set `MODEL_PROVIDER` and `MODEL_NAME` to the same values as
`DIFY_AGENT_PROVIDER` and `DIFY_AGENT_MODEL_NAME` in `dify-agent/.env`.

## Context compaction

Dify product request builders resolve `context_window_tokens` from the selected
model plugin schema using the current tenant and user credentials. A client that
constructs `DifyPluginLLMLayerConfig` directly is responsible for supplying an
accurate positive value. The field is model capability metadata: Dify Agent does
not forward it as a Provider parameter or merge it into `model_settings`.

For a known window, Dify Agent computes the Harness compaction target as:

```text
min(floor(context_window_tokens * 0.8), context_window_tokens - max_tokens)
```

The second term applies only when `model_settings.max_tokens` is positive. A
non-positive target rejects the run before model invocation. Immediately before
model requests, Harness estimates the message history and rewrites it when it is
over target: it first clears old tool results while retaining the three most
recent tool-call/result pairs and their inputs; if still over target, the current
model incrementally summarizes older history while retaining the latest twenty
messages and the first user message.

Compaction affects later runs only when the composition has a
[history layer](../history-layer/index.md). Once pydantic-ai binds and builds
messages in the run capture, successful, failed, timed-out, and cancelled runs
write the captured rewritten history into their terminal session snapshot. A
failure or cancellation before the capture contains any messages preserves the
previously restored history. Interrupted partial messages may be included and
repaired when that checkpoint is used by a later independent run; the interrupted
run's terminal status remains unchanged.

## Complete minimal model composition

Most runs include a prompt, execution-context layer, and LLM layer:

```python {test="skip" lint="skip"}
from agenton_collections.layers.plain import PLAIN_PROMPT_LAYER_TYPE_ID, PromptLayerConfig
from dify_agent.layers.execution_context import DIFY_EXECUTION_CONTEXT_LAYER_TYPE_ID, DifyExecutionContextLayerConfig
from dify_agent.layers.dify_plugin import (
    DIFY_PLUGIN_LLM_LAYER_TYPE_ID,
    DifyPluginLLMLayerConfig,
)
from dify_agent.protocol import DIFY_AGENT_MODEL_LAYER_ID, RunComposition, RunLayerSpec


MODEL_PROVIDER = "replace-with-provider-from-dify-agent-env"
MODEL_NAME = "replace-with-model-from-dify-agent-env"
PLUGIN_ID = "langgenius/openai"

composition = RunComposition(
    layers=[
        RunLayerSpec(
            name="prompt",
            type=PLAIN_PROMPT_LAYER_TYPE_ID,
            config=PromptLayerConfig(prefix="You are concise.", user="Say hello."),
        ),
        RunLayerSpec(
            name="execution_context",
            type=DIFY_EXECUTION_CONTEXT_LAYER_TYPE_ID,
            config=DifyExecutionContextLayerConfig(
                tenant_id="replace-with-tenant-id",
                user_id="replace-with-user-id",
                user_from="account",
                app_id="replace-with-app-id",
                agent_mode="single_step",
                invoke_from="debugger",
            ),
        ),
        RunLayerSpec(
            name=DIFY_AGENT_MODEL_LAYER_ID,
            type=DIFY_PLUGIN_LLM_LAYER_TYPE_ID,
            deps={"execution_context": "execution_context"},
            config=DifyPluginLLMLayerConfig(
                plugin_id=PLUGIN_ID,
                model_provider=MODEL_PROVIDER,
                model=MODEL_NAME,
            ),
        ),
    ]
)
```

## Notes

- The model layer must use the reserved name `llm` (`DIFY_AGENT_MODEL_LAYER_ID`).
- `plugin_id` belongs here because model calls are plugin-specific business
  calls. The shared execution-context layer carries the Dify caller context.
- Model credentials are never accepted from the Agent request. Dify API resolves
  the tenant's current provider configuration and owns quota accounting.
- Omitting `context_window_tokens` disables window-based compaction. It does not
  limit or otherwise change the Provider's own context-window enforcement.
