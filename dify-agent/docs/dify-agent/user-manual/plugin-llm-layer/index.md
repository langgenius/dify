# Plugin LLM layer

The plugin LLM layer selects the model provider, model name, provider credentials,
and optional model settings for the current run. Dify Agent reads the model from
the reserved layer name `llm`.

It must depend on a [plugin layer](../plugin-layer/index.md), because the plugin
layer supplies the daemon identity and transport context.

## Config fields

| Field | Type | Meaning |
| --- | --- | --- |
| `model_provider` | `str` | Provider name inside the selected plugin. Use the value of `DIFY_AGENT_PROVIDER` from `dify-agent/.env`. |
| `model` | `str` | Model name. Use the value of `DIFY_AGENT_MODEL_NAME` from `dify-agent/.env`. |
| `credentials` | `dict[str, str \| int \| float \| bool \| None]` | Provider-specific credential object. |
| `model_settings` | `ModelSettings \| None` | Optional pydantic-ai model settings. |

The plugin LLM layer type id is `dify.plugin.llm`.

## Basic usage

```python {test="skip" lint="skip"}
from dify_agent.layers.dify_plugin import DIFY_PLUGIN_LLM_LAYER_TYPE_ID, DifyPluginLLMLayerConfig
from dify_agent.protocol import DIFY_AGENT_MODEL_LAYER_ID, RunLayerSpec


MODEL_PROVIDER = "replace-with-provider-from-dify-agent-env"
MODEL_NAME = "replace-with-model-from-dify-agent-env"

llm_layer = RunLayerSpec(
    name=DIFY_AGENT_MODEL_LAYER_ID,
    type=DIFY_PLUGIN_LLM_LAYER_TYPE_ID,
    deps={"plugin": "plugin"},
    config=DifyPluginLLMLayerConfig(
        model_provider=MODEL_PROVIDER,
        model=MODEL_NAME,
        credentials={"api_key": "replace-with-provider-key"},
    ),
)
```

`deps={"plugin": "plugin"}` means: bind the LLM layer's dependency field named
`plugin` to the composition layer named `plugin`.

Set `MODEL_PROVIDER` and `MODEL_NAME` to the same values as
`DIFY_AGENT_PROVIDER` and `DIFY_AGENT_MODEL_NAME` in `dify-agent/.env`.

## Complete minimal model composition

Most runs include a prompt, plugin context, and LLM layer:

```python {test="skip" lint="skip"}
from agenton_collections.layers.plain import PLAIN_PROMPT_LAYER_TYPE_ID, PromptLayerConfig
from dify_agent.layers.dify_plugin import (
    DIFY_PLUGIN_LAYER_TYPE_ID,
    DIFY_PLUGIN_LLM_LAYER_TYPE_ID,
    DifyPluginLLMLayerConfig,
    DifyPluginLayerConfig,
)
from dify_agent.protocol import DIFY_AGENT_MODEL_LAYER_ID, RunComposition, RunLayerSpec


MODEL_PROVIDER = "replace-with-provider-from-dify-agent-env"
MODEL_NAME = "replace-with-model-from-dify-agent-env"

composition = RunComposition(
    layers=[
        RunLayerSpec(
            name="prompt",
            type=PLAIN_PROMPT_LAYER_TYPE_ID,
            config=PromptLayerConfig(prefix="You are concise.", user="Say hello."),
        ),
        RunLayerSpec(
            name="plugin",
            type=DIFY_PLUGIN_LAYER_TYPE_ID,
            config=DifyPluginLayerConfig(
                tenant_id="replace-with-tenant-id",
                plugin_id="langgenius/openai",
            ),
        ),
        RunLayerSpec(
            name=DIFY_AGENT_MODEL_LAYER_ID,
            type=DIFY_PLUGIN_LLM_LAYER_TYPE_ID,
            deps={"plugin": "plugin"},
            config=DifyPluginLLMLayerConfig(
                model_provider=MODEL_PROVIDER,
                model=MODEL_NAME,
                credentials={"api_key": "replace-with-provider-key"},
            ),
        ),
    ]
)
```

## Notes

- The model layer must use the reserved name `llm` (`DIFY_AGENT_MODEL_LAYER_ID`).
- Credential shape depends on the selected plugin provider; the OpenAI-style
  `api_key` field above is only an example.
- Client-submitted model credentials remain in the scheduled request memory and
  are not part of run records or session snapshots.
