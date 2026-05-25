# Dify Agent plugin tools layer implementation notes

## 0. Update summary relative to the previous version of this file

The previous version documented an implementation where `dify-agent` fetched
plugin tool provider declarations, fetched runtime parameters, merged the two,
and built the model-facing JSON schema at run time. That has changed.

The current implementation moves clean declaration/schema preparation to the API
side and keeps `dify-agent` focused on invocation:

- API-side `Tool` now owns effective parameter merging through
  `Tool.get_merged_runtime_parameters(...)`.
- API-side `Tool` now owns LLM-facing JSON schema generation through
  `Tool.get_llm_parameters_json_schema(...)`.
- `BaseAgentRunner` now calls `Tool.get_llm_parameters_json_schema()` directly
  when preparing/updating `PromptMessageTool` for normal agent tools.
- No existing `api/` caller was found that constructs `dify.plugin`,
  `dify.plugin.llm`, or `dify.plugin.tools` run-composition layers, so no
  API-side composition rewiring was needed for the plugin-id split.
- `dify-agent` `DifyPluginToolConfig` now carries API-prepared:
  - `parameters`
  - `parameters_json_schema`
- `dify-agent` no longer fetches tool provider declarations or runtime
  parameters while building tools.
- `dify-agent` no longer contains provider-discovery/runtime-parameter DTOs or
  client methods in `tool_client.py`.
- `DifyPluginDaemonToolClient` is now an invoke-only daemon boundary.
- `dify-agent` still prepares invocation payloads from the prepared parameter
  declarations: it validates required hidden/manual inputs, applies defaults,
  casts values into daemon-facing shapes, invokes the daemon, merges blob
  chunks, and maps expected daemon/tool errors into agent-facing observations.
- The plugin-id split invariant remains unchanged:
  - `dify.plugin` owns shared tenant/user daemon context only.
  - `dify.plugin.llm` owns its LLM `plugin_id`.
  - each `DifyPluginToolConfig` owns its tool `plugin_id`.

## 1. Goal

The Dify Agent tool layer lets a `dify-agent` run expose Dify plugin tools to a
Pydantic AI agent. The current design deliberately separates **preparation** from
**execution**:

- Dify API prepares the effective tool declaration and LLM-facing JSON schema.
- Dify Agent receives that clean prepared config and performs only runtime
  invocation work.

This avoids duplicating Dify API's original agent-node declaration merge and
schema-building semantics inside `dify-agent` while preserving the daemon tool
invocation contract.

The public layer split is:

| Layer | Type id | Responsibility |
| --- | --- | --- |
| `dify.plugin` | `"dify.plugin"` | Shared plugin-daemon tenant/user context plus server-injected daemon settings. |
| `dify.plugin.llm` | `"dify.plugin.llm"` | One plugin-backed LLM selection, including its own `plugin_id`. |
| `dify.plugin.tools` | `"dify.plugin.tools"` | One or more prepared plugin-backed tools, each with its own `plugin_id`. |

## 2. API-side preparation contract

### 2.1 `Tool.get_merged_runtime_parameters(...)`

File:

```text
api/core/tools/__base/tool.py
```

Spec:

- Start from the tool entity's declared parameters.
- Fetch runtime parameters with `get_runtime_parameters(...)`.
- Runtime parameters override declared parameters with the same `name`.
- Runtime parameters with new names are appended.
- All returned parameters are deep-copied and detached from cached tool
  declarations.

Invariant:

- Callers can safely mutate the returned parameter list while preparing schemas
  or downstream config.
- The merge is owned by API-side tool logic, not by `dify-agent`.

### 2.2 `Tool.get_llm_parameters_json_schema(...)`

File:

```text
api/core/tools/__base/tool.py
```

Spec:

- Build the model-visible JSON schema from the effective parameters returned by
  `get_merged_runtime_parameters(...)`.
- Include only parameters with `form == LLM`.
- Exclude file-like inputs that should not be directly supplied by the model:
  - `system-files`
  - `file`
  - `files`
- Use `parameter.input_schema` when present.
- Otherwise derive a schema from `parameter.type.as_normal_type()`.
- Preserve `llm_description` as the JSON schema `description`.
- Add enum values for select options.
- Add required LLM parameters to the schema `required` list.

Invariant:

- Hidden/manual parameters remain available for invocation preparation but are
  omitted from the model-facing schema.
- This helper is the API-side source of truth for normal tool schema generation.

### 2.3 `BaseAgentRunner` call sites

File:

```text
api/core/agent/base_agent_runner.py
```

Normal agent tool conversion now uses:

```python
tool_entity.get_llm_parameters_json_schema()
```

and prompt-tool updates use:

```python
prompt_tool.parameters = tool.get_llm_parameters_json_schema()
```

Invariant:

- `BaseAgentRunner` no longer carries duplicated normal-tool schema-building
  logic.
- Schema branch behavior belongs in `Tool`, while the runner only wires the
  prepared schema into `PromptMessageTool`.

Note:

- Dataset retriever tools still have their own existing prompt-tool conversion
  path. That path is outside this plugin-tools preparation split.

## 3. Public `dify-agent` config spec

File:

```text
dify-agent/src/dify_agent/layers/dify_plugin/configs.py
```

### 3.1 `DifyPluginLayerConfig`

```python
class DifyPluginLayerConfig(LayerConfig):
    tenant_id: str
    user_id: str | None = None
```

Spec:

- Represents only shared tenant/user context for plugin-daemon calls.
- Does not contain `plugin_id`.
- Does not contain daemon URL or daemon API key.

Invariants:

- Daemon URL/API key are server-side runtime settings and must not be accepted
  from public run payloads.
- `extra="forbid"` rejects obsolete or unknown public fields.
- The layer can be shared by multiple LLM/tool business layers targeting
  different plugin ids.

### 3.2 `DifyPluginLLMLayerConfig`

```python
class DifyPluginLLMLayerConfig(LayerConfig):
    plugin_id: str
    model_provider: str
    model: str
    credentials: dict[str, DifyPluginCredentialValue] = Field(default_factory=dict)
    model_settings: ModelSettings | None = None
```

Spec:

- Selects a plugin-backed LLM provider/model.
- Owns the LLM plugin id.
- Carries scalar credentials and optional Pydantic AI model settings.

Invariants:

- `plugin_id` identifies daemon/plugin transport for the LLM plugin.
- `model_provider` is request-level business model identity, for example
  `"openai"`.
- Credentials are scalar values only: `str | int | float | bool | None`.
- Old `provider` config is rejected.

### 3.3 Prepared tool parameter DTOs

`dify-agent` exposes client-safe DTOs for the prepared declarations it receives
from API-side preparation:

```python
class DifyPluginToolOption(BaseModel):
    value: str

class DifyPluginToolParameterType(StrEnum):
    STRING = "string"
    NUMBER = "number"
    BOOLEAN = "boolean"
    SELECT = "select"
    SECRET_INPUT = "secret-input"
    FILE = "file"
    FILES = "files"
    APP_SELECTOR = "app-selector"
    MODEL_SELECTOR = "model-selector"
    ANY = "any"
    DYNAMIC_SELECT = "dynamic-select"
    CHECKBOX = "checkbox"
    SYSTEM_FILES = "system-files"
    ARRAY = "array"
    OBJECT = "object"

class DifyPluginToolParameterForm(StrEnum):
    SCHEMA = "schema"
    FORM = "form"
    LLM = "llm"

class DifyPluginToolParameter(BaseModel):
    name: str
    type: DifyPluginToolParameterType
    form: DifyPluginToolParameterForm
    required: bool = False
    default: DifyPluginToolValue = None
    llm_description: str | None = None
    input_schema: dict[str, JsonValue] | None = None
    options: list[DifyPluginToolOption] = Field(default_factory=list)
```

Spec:

- These DTOs describe the API-prepared effective parameter declarations that the
  agent runtime needs for hidden/manual validation, default application, and
  daemon-facing type coercion.

Invariant:

- These DTOs are not used by `dify-agent` to rebuild the model-facing schema;
  the model-facing schema is supplied directly as `parameters_json_schema`.

### 3.4 `DifyPluginToolConfig`

```python
class DifyPluginToolConfig(LayerConfig):
    plugin_id: str
    provider: str
    tool_name: str
    credential_type: DifyPluginToolCredentialType
    name: str | None = None
    description: str | None = None
    credentials: dict[str, DifyPluginCredentialValue] = Field(default_factory=dict)
    runtime_parameters: dict[str, DifyPluginToolValue] = Field(default_factory=dict)
    parameters: list[DifyPluginToolParameter] = Field(default_factory=list)
    parameters_json_schema: dict[str, JsonValue] = Field(
        default_factory=lambda: {"type": "object", "properties": {}, "required": []}
    )
    strict: bool | None = None
```

Spec:

- Describes one prepared plugin tool to expose to the agent.
- `plugin_id` is the plugin that provides this tool.
- `provider` is the provider id inside the plugin.
- `tool_name` is the daemon-declared tool name used for invocation.
- `credential_type` is the daemon credential transport mode.
- `name` optionally overrides the agent-visible tool name.
- `description` optionally overrides the agent-visible description.
- `runtime_parameters` supplies hidden/manual invocation inputs.
- `parameters` supplies API-prepared effective declarations for invocation-time
  validation/defaults/type coercion.
- `parameters_json_schema` supplies API-prepared model-visible JSON schema.
- `strict` is forwarded to Pydantic AI tool definition semantics.

Credential invariant:

- `credential_type` is explicit caller-supplied daemon transport mode, not a
  value inferred from provider metadata.
- It must match the supplied credentials, for example `"api-key"`, `"oauth2"`,
  or `"unauthorized"`.
- A wrong value can make daemon invocation fail at runtime even when local config
  validation succeeds.

Prepared-config invariant:

- `dify-agent` trusts `parameters_json_schema` as the model-visible schema.
- `dify-agent` does not fetch provider declarations or runtime parameters to
  repair or regenerate the schema at run time.

### 3.5 `DifyPluginToolsLayerConfig`

```python
class DifyPluginToolsLayerConfig(LayerConfig):
    tools: list[DifyPluginToolConfig] = Field(default_factory=list)
```

Spec:

- Carries the list of plugin tools contributed by one `dify.plugin.tools` layer.
- Empty tool lists are valid.

Invariants:

- Individual tools may refer to different plugin ids.
- Duplicate tool-name validation happens after all static and dynamic tools are
  aggregated by the runner.

## 4. Client-safe import boundary

`dify_agent.layers.dify_plugin` exports only client-safe DTOs and stable type ids:

- `DIFY_PLUGIN_LAYER_TYPE_ID`
- `DIFY_PLUGIN_LLM_LAYER_TYPE_ID`
- `DIFY_PLUGIN_TOOLS_LAYER_TYPE_ID`
- `DifyPluginCredentialValue`
- `DifyPluginLLMLayerConfig`
- `DifyPluginLayerConfig`
- `DifyPluginToolCredentialType`
- `DifyPluginToolConfig`
- `DifyPluginToolOption`
- `DifyPluginToolParameter`
- `DifyPluginToolParameterForm`
- `DifyPluginToolParameterType`
- `DifyPluginToolsLayerConfig`
- `DifyPluginToolValue`

It intentionally does not export implementation layers, daemon clients, runtime
objects, or server-only modules. Client code can build run requests without
pulling in server dependencies.

## 5. Runtime plugin context layer

`DifyPluginLayer` carries shared plugin-daemon identity:

```python
@dataclass(slots=True)
class DifyPluginLayer(PlainLayer[NoLayerDeps, DifyPluginLayerConfig, EmptyRuntimeState]):
    config: DifyPluginLayerConfig
    daemon_url: str
    daemon_api_key: str
```

Construction spec:

- `from_config(...)` rejects plain construction because daemon settings must be
  injected by server provider factories.
- `from_config_with_settings(...)` constructs the layer from public config plus
  server-only daemon URL/API key.

Factory methods:

```python
def create_daemon_provider(*, plugin_id: str, http_client: httpx.AsyncClient) -> DifyPluginDaemonProvider
def create_tool_client(*, plugin_id: str, http_client: httpx.AsyncClient) -> DifyPluginDaemonToolClient
```

Invariants:

- The caller supplies the concrete `plugin_id`.
- The passed HTTP client must be open.
- The layer never opens, caches, closes, serializes, or snapshots live HTTP
  clients.

## 6. LLM layer

`DifyPluginLLMLayer` depends directly on `DifyPluginLayer`:

```python
class DifyPluginLLMDeps(LayerDeps):
    plugin: DifyPluginLayer
```

`get_model(...)` asks the plugin layer to create a daemon provider using the LLM
layer's own `plugin_id`, then builds a `DifyLLMAdapterModel` from configured
model provider, model, credentials, and settings.

Invariants:

- Daemon transport identity is derived from shared plugin context plus LLM
  `plugin_id`.
- Business model provider identity remains request-level model data.
- The shared HTTP client comes from the runner.

## 7. Tools layer flow in `dify-agent`

File:

```text
dify-agent/src/dify_agent/layers/dify_plugin/tools_layer.py
```

`DifyPluginToolsLayer` depends directly on `DifyPluginLayer`:

```python
class DifyPluginToolsDeps(LayerDeps):
    plugin: DifyPluginLayer
```

`get_tools(http_client=...)` resolves prepared plugin tool configs into Pydantic
AI `Tool` objects. For each tool config it:

1. Creates or reuses a `DifyPluginDaemonToolClient` for `tool_config.plugin_id`.
2. Deep-copies `tool_config.parameters` into effective invocation parameters.
3. Validates required hidden/manual parameters.
4. Builds a Pydantic AI tool whose model schema is a deep copy of
   `tool_config.parameters_json_schema`.

Invariants:

- No provider metadata is fetched.
- No runtime-parameter endpoint is called.
- No declaration/schema merge happens in `dify-agent`.
- Per-tool `plugin_id` chooses the tool daemon transport identity.

## 8. Hidden/manual parameter validation

`_validate_required_hidden_parameters(...)` checks prepared parameters before
tool construction.

Spec:

- For parameters where `form != LLM`, if the parameter is required, has no
  default, and is not present in `runtime_parameters`, construction fails with a
  validation error.

Invariant:

- Required hidden/manual inputs must be provided by config or by prepared
  defaults before the agent can expose the tool.

## 9. Invocation argument preparation

`_prepare_tool_arguments(...)` combines prepared config and model tool args.

Argument precedence:

1. Start from config-supplied `runtime_parameters` for hidden/manual inputs.
2. Model-supplied tool arguments override same-named entries.
3. If no value was supplied, use the prepared parameter default.
4. If a required parameter still has no value, raise a validation error.

Spec:

- Declared parameters are type-cast into daemon-facing wire shapes.
- Extra merged keys not present in `parameters` pass through unchanged.

Invariant:

- The prepared parameter list is still required even though schema generation
  moved to the API side, because the runtime must validate hidden/manual inputs,
  apply defaults, and normalize invocation payload values.

## 10. Invocation type coercion

`_cast_tool_parameter_value(...)` normalizes values before daemon invocation.

Rules:

| Parameter type | Runtime coercion |
| --- | --- |
| `string`, `secret-input`, `select`, `checkbox`, `dynamic-select` | `None` -> empty string; non-string -> `str(value)` |
| `boolean` | common truthy/falsey strings are parsed; otherwise bool-like coercion |
| `number` | numeric values pass through; numeric strings become int/float |
| `files`, `system-files` | non-list values are wrapped in a list |
| `file` | list must contain exactly one item; otherwise error |
| `model-selector`, `app-selector` | must be a dict |
| `any` | must be JSON-like if not `None` |
| `array` | list passes through; string tries JSON parse; otherwise wraps in list |
| `object` | dict passes through; string tries JSON parse; invalid strings become `{}` |

Invariant:

- Unexpected local validation/coercion errors are not swallowed by a blanket
  catch; only expected daemon/tool validation paths become agent observations.

## 11. Pydantic AI tool adapter

`_build_pydantic_ai_tool(...)` creates a Pydantic AI `Tool` with:

- an invocation closure that prepares daemon arguments, invokes the plugin tool,
  and converts daemon stream messages to observation text;
- a prepare closure that sets `parameters_json_schema` from the API-prepared
  `tool_config.parameters_json_schema`.

Invariants:

- The tool name is `tool_config.name or tool_config.tool_name`.
- The tool description is `tool_config.description or tool_name`.
- The model-facing schema is not rebuilt from parameter declarations.
- Expected `DifyPluginToolClientError` and local `ValueError` are converted into
  agent-facing text.
- Unexpected local errors propagate.

## 12. Invoke-only daemon tool client

File:

```text
dify-agent/src/dify_agent/layers/dify_plugin/tool_client.py
```

`DifyPluginDaemonToolClient` now exposes only invocation:

```python
async def invoke(
    *,
    provider: str,
    tool_name: str,
    credential_type: DifyPluginToolCredentialType,
    credentials: dict[str, object],
    tool_parameters: Mapping[str, object],
) -> list[DifyPluginToolInvokeMessage]
```

Daemon endpoint:

```text
POST /plugin/{tenant_id}/dispatch/tool/invoke
```

Headers:

```text
X-Api-Key: daemon api key
X-Plugin-ID: per-tool plugin id
Content-Type: application/json
```

Payload shape:

```python
{
    "data": {
        "provider": provider,
        "tool": tool_name,
        "credentials": credentials,
        "credential_type": credential_type,
        "tool_parameters": dict(tool_parameters),
    },
    "user_id": user_id,  # only when configured on shared plugin context
}
```

Invariants:

- `tenant_id` comes from shared plugin context and appears in the path.
- `user_id` comes from shared plugin context and is forwarded top-level when
  present.
- `X-Plugin-ID` comes from the individual tool config's `plugin_id`.
- Provider/tool/credentials/credential type/parameters are per invocation.

## 13. Shared plugin-daemon transport helpers

`dify_agent.plugin_daemon_transport` contains daemon-transport behavior shared by
LLM and tools clients:

```python
def to_plugin_daemon_jsonable(value: object) -> object
def decode_plugin_daemon_error_payload(raw_message: str) -> PluginDaemonErrorPayload | None
def unwrap_plugin_daemon_error(*, error_type: str, message: str) -> PluginDaemonErrorPayload
```

Spec:

- Convert Pydantic models and nested collections to JSON-safe daemon payloads.
- Decode daemon JSON error strings shaped like `{"error_type": ..., "message": ...}`.
- Recursively unwrap nested `PluginInvokeError` payloads.

Invariant:

- LLM and tools daemon adapters must not duplicate this protocol logic.

## 14. Tool stream messages and blob chunks

`DifyPluginToolInvokeMessage` models the daemon stream message subset needed for
agent observations: text, JSON, image, links, variables, logs, file/blob
messages, and blob chunks.

`merge_blob_chunks(...)` merges streamed `blob_chunk` messages into final `blob`
messages before higher-level observation conversion.

Invariants:

- Chunks are grouped by id.
- Each file is capped at 30MB.
- Each chunk is capped at 8KB.
- Completed chunks become a single `BLOB` message.
- Higher-level observation conversion does not see raw chunk sequence details.

## 15. Observation conversion and error mapping

`_convert_tool_response_to_text(...)` maps daemon messages into text for the
agent:

- text messages append their text;
- link messages become a user-checkable link instruction;
- image messages become a user-checkable image instruction;
- JSON messages are serialized unless suppressed;
- variable messages are ignored;
- unknown messages fall back to `str(message)`;
- JSON fragments are deduplicated against existing text.

`_tool_error_text(...)` maps expected daemon invocation errors into agent-facing
text:

- credential/authorization errors -> `Please check your tool provider credentials`;
- tool/provider not found -> `there is not a tool named {tool_name}`;
- validation/bad-request errors -> `tool parameters validation error: ...`;
- other daemon errors -> `tool invoke error: ...`.

Invariant:

- Known daemon/tool rejections are softened into observations.
- Unexpected local bugs are not caught by the tool adapter and should fail
  loudly.

## 16. Runner integration

The runner resolves tools with `_resolve_run_tools(...)`:

1. Start with static compositor tools from `run.tools`.
2. Traverse run slots and call `get_tools(...)` on every `DifyPluginToolsLayer`.
3. Validate aggregate tool-name uniqueness.
4. Pass the final list to Pydantic AI agent construction.

Invariant:

- Duplicate tool names are rejected across all sources: static tools, one tools
  layer, or multiple tools layers.
- Validation happens before Pydantic AI agent construction so conflicts are
  reported as run validation errors.

## 17. Provider factory and lifecycle

`create_default_layer_providers(...)` includes providers for:

- prompt layers;
- history layer;
- output layer;
- `DifyPluginLayer` through a server-settings factory;
- `DifyPluginLLMLayer`;
- `DifyPluginToolsLayer`.

Lifecycle invariant:

- FastAPI/server runtime owns the shared plugin daemon HTTP client.
- Runner passes the shared client to LLM/tools layers.
- Layers and snapshots remain state-only and never own live resources.

## 18. Usage example

```python
from dify_agent.layers.dify_plugin import (
    DifyPluginLayerConfig,
    DifyPluginLLMLayerConfig,
    DifyPluginToolConfig,
    DifyPluginToolParameter,
    DifyPluginToolsLayerConfig,
)
from dify_agent.protocol.schemas import RunComposition, RunLayerSpec

composition = RunComposition(
    layers=[
        RunLayerSpec(
            name="plugin",
            type="dify.plugin",
            config=DifyPluginLayerConfig(tenant_id="tenant-1", user_id="user-1"),
        ),
        RunLayerSpec(
            name="llm",
            type="dify.plugin.llm",
            deps={"plugin": "plugin"},
            config=DifyPluginLLMLayerConfig(
                plugin_id="langgenius/openai",
                model_provider="openai",
                model="gpt-4o-mini",
                credentials={"api_key": "replace-with-model-key"},
            ),
        ),
        RunLayerSpec(
            name="tools",
            type="dify.plugin.tools",
            deps={"plugin": "plugin"},
            config=DifyPluginToolsLayerConfig(
                tools=[
                    DifyPluginToolConfig(
                        plugin_id="langgenius/search",
                        provider="search",
                        tool_name="web_search",
                        credential_type="api-key",
                        credentials={"api_key": "replace-with-tool-key"},
                        runtime_parameters={"site": "docs.dify.ai"},
                        parameters=[
                            DifyPluginToolParameter(
                                name="query",
                                type="string",
                                form="llm",
                                required=True,
                                llm_description="Search query",
                            )
                        ],
                        parameters_json_schema={
                            "type": "object",
                            "properties": {
                                "query": {
                                    "type": "string",
                                    "description": "Search query",
                                }
                            },
                            "required": ["query"],
                        },
                    )
                ]
            ),
        ),
    ]
)
```

In production, API-side preparation should fill `parameters` and
`parameters_json_schema` from the effective Dify tool declaration before the
composition is submitted to `dify-agent`.

## 19. Test coverage

The local tests now cover:

- API-side runtime-parameter merge semantics in `Tool.get_merged_runtime_parameters(...)`;
- API-side LLM JSON schema generation in `Tool.get_llm_parameters_json_schema(...)`;
- `BaseAgentRunner` using the API-side schema helper instead of inline schema logic;
- client-safe exports and DTO validation;
- explicit tool `credential_type` requirement;
- prepared `parameters` and `parameters_json_schema` in public request payloads;
- plugin layer shared HTTP client behavior and closed-client rejection;
- LLM layer model construction from direct plugin dependency;
- prepared plugin tools being converted to Pydantic AI tools;
- required hidden/manual parameter validation;
- defaults being applied during invocation;
- daemon-facing type coercion for non-string prepared parameter types;
- per-tool `plugin_id` driving `X-Plugin-ID` for multiple tools;
- shared `user_id` being forwarded in tool invocation payloads;
- agent-friendly daemon/tool error text;
- nested `PluginInvokeError` unwrapping;
- blob chunk merging before observation conversion;
- unexpected local/transport failures propagating instead of being swallowed;
- dynamic plugin tools being passed to the runner's agent;
- duplicate tool names across dynamic layers and static/dynamic tools;
- import boundary safety.

## 20. Non-goals and boundaries

- The agent does not import provider SDKs directly; all LLM/tool execution goes
  through the plugin daemon.
- The agent does not infer `credential_type` from provider metadata.
- The agent does not store provider credential schema or OAuth schema in its tool
  client DTOs.
- The agent does not fetch provider declarations or runtime parameters for tools
  at execution time.
- The agent does not rebuild model-facing tool JSON schemas from declarations.
- The agent does not persist daemon clients or HTTP clients in session snapshots.
- Local tests mock daemon contracts and do not prove real daemon integration.
