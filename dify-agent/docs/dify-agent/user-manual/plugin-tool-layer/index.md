# Plugin tool layer

The plugin tool layer exposes Dify plugin tools to the model. It is designed for
Dify API to build after it has resolved a user's tool selections, plugin daemon
declarations, credentials, and manual/runtime inputs.

Unlike the plugin LLM layer, this layer may contain tools from multiple plugin
packages. Each tool config carries its own `plugin_id`, while the shared
[execution context layer](../execution-context-layer/index.md) still carries
only tenant/user daemon context.

## Responsibilities

Dify API prepares the tool config before submitting the run request:

- resolve the selected provider and tool name;
- merge declared parameters with runtime parameters;
- produce the model-visible JSON schema;
- provide hidden/manual `runtime_parameters` and credentials;
- choose the daemon `credential_type` for invocation.

Dify Agent consumes that prepared config. At run time it validates required
hidden inputs, applies defaults, casts invocation values, calls plugin daemon,
and turns tool responses into model observations.

## Config fields

The plugin tools layer type id is `dify.plugin.tools`.

`DifyPluginToolsLayerConfig` contains a list of `DifyPluginToolConfig` objects:

| Field | Type | Meaning |
| --- | --- | --- |
| `tools` | `list[DifyPluginToolConfig]` | Prepared plugin tools to expose to the model. |

Each tool config has these fields:

| Field | Type | Meaning |
| --- | --- | --- |
| `plugin_id` | `str` | Plugin package id for this tool, for example `langgenius/wikipedia`. |
| `provider` | `str` | Tool provider name inside the plugin. |
| `tool_name` | `str` | Daemon tool name to invoke. |
| `credential_type` | `"api-key" \| "oauth2" \| "unauthorized"` | Credential mode sent to plugin daemon. |
| `name` | `str \| None` | Optional model-visible tool name. Defaults to `tool_name`. |
| `description` | `str \| None` | Optional model-visible description. Defaults to the tool name. |
| `credentials` | `dict[str, str \| int \| float \| bool \| None]` | Provider-specific tool credentials. |
| `runtime_parameters` | `dict[str, JsonValue]` | Hidden/manual values merged into daemon invocation but omitted from the model schema. |
| `parameters` | `list[DifyPluginToolParameter]` | API-prepared effective parameter declarations used for validation, defaults, and casting. |
| `parameters_json_schema` | `dict[str, JsonValue]` | API-prepared JSON schema shown to the model. |

## Example: Dify API prepared Wikipedia tool

```python {test="skip" lint="skip"}
from dify_agent.layers.execution_context import DIFY_EXECUTION_CONTEXT_LAYER_TYPE_ID, DifyExecutionContextLayerConfig
from dify_agent.layers.dify_plugin import (
    DIFY_PLUGIN_TOOLS_LAYER_TYPE_ID,
    DifyPluginToolConfig,
    DifyPluginToolParameter,
    DifyPluginToolsLayerConfig,
)
from dify_agent.protocol import RunComposition, RunLayerSpec


# Dify API side: resolve the selected tool into the API-side Tool runtime first,
# for example with ToolManager.get_agent_tool_runtime(...). Then adapt its
# effective ToolParameter objects at the protocol boundary. Dify Agent accepts
# both ToolParameter attribute objects and ToolParameter.model_dump(mode="json")
# dictionaries, ignoring API-only fields such as label and human_description.
tool_runtime = ToolManager.get_agent_tool_runtime(...)
effective_parameters = tool_runtime.get_merged_runtime_parameters()
prepared_parameters = [
    DifyPluginToolParameter.model_validate(parameter)
    # If the API serializes first, use:
    # DifyPluginToolParameter.model_validate(parameter.model_dump(mode="json"))
    for parameter in effective_parameters
]
parameters_json_schema = tool_runtime.get_llm_parameters_json_schema()

composition = RunComposition(
    layers=[
        RunLayerSpec(
            name="execution_context",
            type=DIFY_EXECUTION_CONTEXT_LAYER_TYPE_ID,
            config=DifyExecutionContextLayerConfig(
                tenant_id="replace-with-tenant-id",
                user_id="replace-with-user-id",
                invoke_from="workflow_run",
            ),
        ),
        RunLayerSpec(
            name="tools",
            type=DIFY_PLUGIN_TOOLS_LAYER_TYPE_ID,
            deps={"execution_context": "execution_context"},
            config=DifyPluginToolsLayerConfig(
                tools=[
                    DifyPluginToolConfig(
                        plugin_id="langgenius/wikipedia",
                        provider="wikipedia",
                        tool_name="wikipedia_search",
                        credential_type="unauthorized",
                        name="wikipedia_search",
                        description="Search Wikipedia for relevant pages.",
                        parameters=prepared_parameters,
                        runtime_parameters={"language": "en"},
                        parameters_json_schema=parameters_json_schema,
                    )
                ]
            ),
        ),
    ]
)
```

`deps={"execution_context": "execution_context"}` means: bind the tool layer's
dependency field named `execution_context` to the composition layer named
`execution_context`.

## Notes for Dify API callers

- Do not ask Dify Agent to discover tool declarations. Resolve and prepare them
  in API before creating the run.
- `parameters` should include all effective parameters, including hidden/manual
  ones needed for validation and default application.
- `parameters_json_schema` should include only model-visible parameters. Omit
  hidden/manual parameters and file/system-file parameters unless they are truly
  intended for model input.
- `runtime_parameters` should contain hidden/manual values selected by the user
  or derived from workflow variables.
- Put each tool's `plugin_id` on the tool config. The shared execution-context
  layer has no package-specific identity.
