"""Build ``dify-agent`` run requests from API-side product concepts.

This module is intentionally an adapter, not a wire DTO package. The emitted
object is always ``dify_agent.protocol.CreateRunRequest`` so the Agent backend
protocol has a single owner. API-only context such as Agent Soul vs workflow job
prompt is preserved in layer names and metadata until the dedicated product
schemas land in later phases. Dify-owned execution identifiers are emitted as an
explicit ``dify.execution_context`` layer so the run request stays fully
composition-driven.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import ClassVar

from agenton.compositor import CompositorSessionSnapshot
from agenton.compositor.schemas import LayerSessionSnapshot
from agenton.layers import ExitIntent
from agenton_collections.layers.plain import PLAIN_PROMPT_LAYER_TYPE_ID, PromptLayerConfig
from agenton_collections.layers.pydantic_ai import PYDANTIC_AI_HISTORY_LAYER_TYPE_ID
from dify_agent.layers.dify_plugin import (
    DIFY_PLUGIN_LLM_LAYER_TYPE_ID,
    DIFY_PLUGIN_TOOLS_LAYER_TYPE_ID,
    DifyPluginCredentialValue,
    DifyPluginLLMLayerConfig,
    DifyPluginToolsLayerConfig,
)
from dify_agent.layers.drive import DIFY_DRIVE_LAYER_TYPE_ID, DifyDriveLayerConfig
from dify_agent.layers.execution_context import (
    DIFY_EXECUTION_CONTEXT_LAYER_TYPE_ID,
    DifyExecutionContextLayerConfig,
)
from dify_agent.layers.output import DIFY_OUTPUT_LAYER_TYPE_ID, DifyOutputLayerConfig
from dify_agent.layers.shell import DIFY_SHELL_LAYER_TYPE_ID, DifyShellLayerConfig
from dify_agent.protocol import (
    DIFY_AGENT_HISTORY_LAYER_ID,
    DIFY_AGENT_MODEL_LAYER_ID,
    DIFY_AGENT_OUTPUT_LAYER_ID,
    CreateRunRequest,
    LayerExitSignals,
    RunComposition,
    RunLayerSpec,
    RunPurpose,
    RuntimeLayerSpec,
)
from pydantic import BaseModel, ConfigDict, Field, JsonValue, field_validator

AGENT_SOUL_PROMPT_LAYER_ID = "agent_soul_prompt"
WORKFLOW_NODE_JOB_PROMPT_LAYER_ID = "workflow_node_job_prompt"
WORKFLOW_USER_PROMPT_LAYER_ID = "workflow_user_prompt"
AGENT_APP_USER_PROMPT_LAYER_ID = "agent_app_user_prompt"
DIFY_EXECUTION_CONTEXT_LAYER_ID = "execution_context"
DIFY_DRIVE_LAYER_ID = "drive"
DIFY_PLUGIN_TOOLS_LAYER_ID = "tools"
DIFY_SHELL_LAYER_ID = "shell"


def _filter_snapshot_to_specs(
    snapshot: CompositorSessionSnapshot,
    specs: list[RuntimeLayerSpec],
) -> CompositorSessionSnapshot:
    """Keep only snapshot layers whose names appear in the cleanup spec list.

    The agenton compositor rejects a snapshot whose layer-name sequence does
    not match the active composition exactly. Cleanup-replay drops plugin
    layers, so we must drop the matching snapshot entries here.
    """
    kept_names = {spec.name for spec in specs}
    filtered_layers: list[LayerSessionSnapshot] = [layer for layer in snapshot.layers if layer.name in kept_names]
    if len(filtered_layers) == len(snapshot.layers):
        return snapshot
    return CompositorSessionSnapshot(schema_version=snapshot.schema_version, layers=filtered_layers)


class AgentBackendModelConfig(BaseModel):
    """API-side model/plugin selection before it is converted to Dify Agent layers."""

    plugin_id: str
    model_provider: str
    model: str
    credentials: dict[str, DifyPluginCredentialValue] = Field(default_factory=dict)
    model_settings: dict[str, JsonValue] = Field(default_factory=dict)

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


# ``DifyPluginLLMLayerConfig.model_settings`` is pydantic_ai's ``ModelSettings``
# TypedDict (closed: unknown keys are rejected, explicit ``None`` values fail the
# per-field type checks). Agent Soul model settings carry a wider, nullable shape
# (``stop`` / ``response_format`` plus null-padded fields), so the layer config
# only receives the keys the runtime contract accepts.
_AGENT_MODEL_SETTINGS_PASSTHROUGH_KEYS = (
    "temperature",
    "top_p",
    "presence_penalty",
    "frequency_penalty",
    "max_tokens",
)


def _agent_model_settings(settings: Mapping[str, JsonValue]) -> dict[str, JsonValue] | None:
    sanitized: dict[str, JsonValue] = {
        key: settings[key] for key in _AGENT_MODEL_SETTINGS_PASSTHROUGH_KEYS if settings.get(key) is not None
    }
    stop = settings.get("stop")
    if isinstance(stop, list) and stop:
        sanitized["stop_sequences"] = stop
    return sanitized or None


class AgentBackendOutputConfig(BaseModel):
    """API-side structured output declaration for the conventional output layer.

    The structured-output tool name is fixed to ``final_output`` inside
    ``dify_agent.layers.output`` so callers only control the JSON Schema plus
    optional description/strictness metadata.
    """

    json_schema: dict[str, JsonValue]
    description: str | None = None
    strict: bool | None = None

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class AgentBackendWorkflowNodeRunInput(BaseModel):
    """Inputs needed to build the first workflow-node-oriented Agent backend run request."""

    model: AgentBackendModelConfig
    execution_context: DifyExecutionContextLayerConfig
    workflow_node_job_prompt: str
    user_prompt: str
    agent_soul_prompt: str | None = None
    purpose: RunPurpose = "workflow_node"
    idempotency_key: str | None = None
    output: AgentBackendOutputConfig | None = None
    tools: DifyPluginToolsLayerConfig | None = None
    # Drive Skills & Files declaration (dify.drive) — an index the agent pulls
    # through the back proxy, never inline content; see AGENT_DRIVE_MANIFEST_ENABLED.
    drive_config: DifyDriveLayerConfig | None = None
    # Inject the sandboxed shell layer (dify.shell). Requires the agent backend
    # to be wired with a shellctl entrypoint; see configs AGENT_SHELL_ENABLED.
    include_shell: bool = False
    shell_config: DifyShellLayerConfig | None = None
    session_snapshot: CompositorSessionSnapshot | None = None
    include_history: bool = True
    suspend_on_exit: bool = True
    metadata: dict[str, JsonValue] = Field(default_factory=dict)

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid", arbitrary_types_allowed=True)

    @field_validator("workflow_node_job_prompt", "user_prompt")
    @classmethod
    def _reject_blank_prompt(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("prompt must not be blank")
        return value


class AgentBackendAgentAppRunInput(BaseModel):
    """Inputs to build one Agent App conversation-turn run request.

    Unlike the workflow-node input there is no workflow-node-job prompt and no
    previous-node context: the user prompt is the chat message, and multi-turn
    continuity comes from ``session_snapshot`` + the history layer keyed by the
    conversation.
    """

    model: AgentBackendModelConfig
    execution_context: DifyExecutionContextLayerConfig
    user_prompt: str
    agent_soul_prompt: str | None = None
    purpose: RunPurpose = "agent_app"
    idempotency_key: str | None = None
    output: AgentBackendOutputConfig | None = None
    tools: DifyPluginToolsLayerConfig | None = None
    # Drive Skills & Files declaration (dify.drive) — an index the agent pulls
    # through the back proxy, never inline content; see AGENT_DRIVE_MANIFEST_ENABLED.
    drive_config: DifyDriveLayerConfig | None = None
    # Inject the sandboxed shell layer (dify.shell). Requires the agent backend
    # to be wired with a shellctl entrypoint; see configs AGENT_SHELL_ENABLED.
    include_shell: bool = False
    shell_config: DifyShellLayerConfig | None = None
    session_snapshot: CompositorSessionSnapshot | None = None
    include_history: bool = True
    suspend_on_exit: bool = True
    metadata: dict[str, JsonValue] = Field(default_factory=dict)

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid", arbitrary_types_allowed=True)

    @field_validator("user_prompt")
    @classmethod
    def _reject_blank_prompt(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("prompt must not be blank")
        return value


class AgentBackendRunRequestBuilder:
    """Converts API product state into the public ``dify-agent`` run protocol."""

    def build_for_agent_app(self, run_input: AgentBackendAgentAppRunInput) -> CreateRunRequest:
        """Build an Agent App conversation-turn run request.

        Layer graph: optional Agent Soul system prompt → user prompt →
        execution context → optional history (multi-turn) → LLM → optional
        plugin tools → optional structured output. Mirrors the workflow-node
        layer ordering minus the workflow-job / previous-node prompt.
        """
        layers: list[RunLayerSpec] = []
        if run_input.agent_soul_prompt:
            layers.append(
                RunLayerSpec(
                    name=AGENT_SOUL_PROMPT_LAYER_ID,
                    type=PLAIN_PROMPT_LAYER_TYPE_ID,
                    metadata={**run_input.metadata, "origin": "agent_soul"},
                    config=PromptLayerConfig(prefix=run_input.agent_soul_prompt),
                )
            )

        layers.extend(
            [
                RunLayerSpec(
                    name=AGENT_APP_USER_PROMPT_LAYER_ID,
                    type=PLAIN_PROMPT_LAYER_TYPE_ID,
                    metadata={**run_input.metadata, "origin": "agent_app_user_prompt"},
                    config=PromptLayerConfig(user=run_input.user_prompt),
                ),
                RunLayerSpec(
                    name=DIFY_EXECUTION_CONTEXT_LAYER_ID,
                    type=DIFY_EXECUTION_CONTEXT_LAYER_TYPE_ID,
                    metadata=run_input.metadata,
                    config=run_input.execution_context,
                ),
            ]
        )

        if run_input.drive_config is not None:
            # Drive Skills & Files declaration (dify.drive): a config-only index;
            # the agent pulls listed entries through the back proxy by drive_ref.
            layers.append(
                RunLayerSpec(
                    name=DIFY_DRIVE_LAYER_ID,
                    type=DIFY_DRIVE_LAYER_TYPE_ID,
                    metadata=run_input.metadata,
                    config=run_input.drive_config,
                )
            )

        if run_input.include_history:
            layers.append(
                RunLayerSpec(
                    name=DIFY_AGENT_HISTORY_LAYER_ID,
                    type=PYDANTIC_AI_HISTORY_LAYER_TYPE_ID,
                    metadata={**run_input.metadata, "origin": "agent_session_history"},
                )
            )

        layers.append(
            RunLayerSpec(
                name=DIFY_AGENT_MODEL_LAYER_ID,
                type=DIFY_PLUGIN_LLM_LAYER_TYPE_ID,
                deps={"execution_context": DIFY_EXECUTION_CONTEXT_LAYER_ID},
                metadata=run_input.metadata,
                config=DifyPluginLLMLayerConfig(
                    plugin_id=run_input.model.plugin_id,
                    model_provider=run_input.model.model_provider,
                    model=run_input.model.model,
                    credentials=run_input.model.credentials,
                    model_settings=_agent_model_settings(run_input.model.model_settings),
                ),
            )
        )

        if run_input.tools is not None and run_input.tools.tools:
            layers.append(
                RunLayerSpec(
                    name=DIFY_PLUGIN_TOOLS_LAYER_ID,
                    type=DIFY_PLUGIN_TOOLS_LAYER_TYPE_ID,
                    deps={"execution_context": DIFY_EXECUTION_CONTEXT_LAYER_ID},
                    metadata=run_input.metadata,
                    config=run_input.tools,
                )
            )

        if run_input.include_shell:
            # Sandboxed bash workspace (dify.shell). Depends on execution_context so
            # the agent server can mint per-command Agent Stub env (back proxy);
            # shellctl connection itself is server-injected.
            layers.append(
                RunLayerSpec(
                    name=DIFY_SHELL_LAYER_ID,
                    type=DIFY_SHELL_LAYER_TYPE_ID,
                    deps={"execution_context": DIFY_EXECUTION_CONTEXT_LAYER_ID},
                    metadata=run_input.metadata,
                    config=run_input.shell_config or DifyShellLayerConfig(),
                )
            )

        if run_input.output is not None:
            layers.append(
                RunLayerSpec(
                    name=DIFY_AGENT_OUTPUT_LAYER_ID,
                    type=DIFY_OUTPUT_LAYER_TYPE_ID,
                    metadata=run_input.metadata,
                    config=DifyOutputLayerConfig(
                        json_schema=run_input.output.json_schema,
                        description=run_input.output.description,
                        strict=run_input.output.strict,
                    ),
                )
            )

        return CreateRunRequest(
            composition=RunComposition(layers=layers),
            purpose=run_input.purpose,
            idempotency_key=run_input.idempotency_key,
            metadata=run_input.metadata,
            session_snapshot=run_input.session_snapshot,
            on_exit=LayerExitSignals(
                default=ExitIntent.SUSPEND if run_input.suspend_on_exit else ExitIntent.DELETE,
            ),
        )

    def build_cleanup_request(
        self,
        *,
        session_snapshot: CompositorSessionSnapshot,
        runtime_layer_specs: list[RuntimeLayerSpec],
        idempotency_key: str | None = None,
        metadata: dict[str, JsonValue] | None = None,
    ) -> CreateRunRequest:
        """Build a lifecycle-only cleanup request that replays the prior layers.

        The agenton compositor enforces that the session snapshot's layer names
        match the active composition in order, so cleanup must replay the same
        non-plugin layer graph that produced the snapshot. Plugin layers
        (``dify.plugin.llm``, ``dify.plugin.tools``) are excluded from both the
        composition and the snapshot before submission because their configs
        require credentials that are not persisted between runs.
        """
        if not runtime_layer_specs:
            raise ValueError(
                "build_cleanup_request requires runtime_layer_specs; an empty "
                "composition would fail the agent backend's snapshot validation."
            )
        request_metadata = dict(metadata or {})
        request_metadata["agent_backend_lifecycle"] = "session_cleanup"
        layers = [
            RunLayerSpec(
                name=spec.name,
                type=spec.type,
                deps=dict(spec.deps),
                metadata=dict(spec.metadata),
                config=spec.config,
            )
            for spec in runtime_layer_specs
        ]
        filtered_snapshot = _filter_snapshot_to_specs(session_snapshot, runtime_layer_specs)
        return CreateRunRequest(
            composition=RunComposition(layers=layers),
            purpose="workflow_node",
            idempotency_key=idempotency_key,
            metadata=request_metadata,
            session_snapshot=filtered_snapshot,
            on_exit=LayerExitSignals(default=ExitIntent.DELETE),
        )

    def build_for_workflow_node(self, run_input: AgentBackendWorkflowNodeRunInput) -> CreateRunRequest:
        """Build a workflow Agent Node run request without defining another wire schema."""
        layers: list[RunLayerSpec] = []
        if run_input.agent_soul_prompt:
            layers.append(
                RunLayerSpec(
                    name=AGENT_SOUL_PROMPT_LAYER_ID,
                    type=PLAIN_PROMPT_LAYER_TYPE_ID,
                    metadata={**run_input.metadata, "origin": "agent_soul"},
                    config=PromptLayerConfig(prefix=run_input.agent_soul_prompt),
                )
            )

        layers.extend(
            [
                RunLayerSpec(
                    name=WORKFLOW_NODE_JOB_PROMPT_LAYER_ID,
                    type=PLAIN_PROMPT_LAYER_TYPE_ID,
                    metadata={**run_input.metadata, "origin": "workflow_node_job"},
                    config=PromptLayerConfig(prefix=run_input.workflow_node_job_prompt),
                ),
                RunLayerSpec(
                    name=WORKFLOW_USER_PROMPT_LAYER_ID,
                    type=PLAIN_PROMPT_LAYER_TYPE_ID,
                    metadata={**run_input.metadata, "origin": "workflow_user_prompt"},
                    config=PromptLayerConfig(user=run_input.user_prompt),
                ),
                RunLayerSpec(
                    name=DIFY_EXECUTION_CONTEXT_LAYER_ID,
                    type=DIFY_EXECUTION_CONTEXT_LAYER_TYPE_ID,
                    metadata=run_input.metadata,
                    config=run_input.execution_context,
                ),
            ]
        )

        if run_input.drive_config is not None:
            # Drive Skills & Files declaration (dify.drive): a config-only index;
            # the agent pulls listed entries through the back proxy by drive_ref.
            layers.append(
                RunLayerSpec(
                    name=DIFY_DRIVE_LAYER_ID,
                    type=DIFY_DRIVE_LAYER_TYPE_ID,
                    metadata=run_input.metadata,
                    config=run_input.drive_config,
                )
            )

        if run_input.include_history:
            layers.append(
                RunLayerSpec(
                    name=DIFY_AGENT_HISTORY_LAYER_ID,
                    type=PYDANTIC_AI_HISTORY_LAYER_TYPE_ID,
                    metadata={**run_input.metadata, "origin": "agent_session_history"},
                )
            )

        layers.extend(
            [
                RunLayerSpec(
                    name=DIFY_AGENT_MODEL_LAYER_ID,
                    type=DIFY_PLUGIN_LLM_LAYER_TYPE_ID,
                    deps={"execution_context": DIFY_EXECUTION_CONTEXT_LAYER_ID},
                    metadata=run_input.metadata,
                    config=DifyPluginLLMLayerConfig(
                        plugin_id=run_input.model.plugin_id,
                        model_provider=run_input.model.model_provider,
                        model=run_input.model.model,
                        credentials=run_input.model.credentials,
                        model_settings=_agent_model_settings(run_input.model.model_settings),
                    ),
                ),
            ]
        )

        if run_input.tools is not None and run_input.tools.tools:
            layers.append(
                RunLayerSpec(
                    name=DIFY_PLUGIN_TOOLS_LAYER_ID,
                    type=DIFY_PLUGIN_TOOLS_LAYER_TYPE_ID,
                    deps={"execution_context": DIFY_EXECUTION_CONTEXT_LAYER_ID},
                    metadata=run_input.metadata,
                    config=run_input.tools,
                )
            )

        if run_input.include_shell:
            # Sandboxed bash workspace (dify.shell). Depends on execution_context so
            # the agent server can mint per-command Agent Stub env (back proxy);
            # shellctl connection itself is server-injected.
            layers.append(
                RunLayerSpec(
                    name=DIFY_SHELL_LAYER_ID,
                    type=DIFY_SHELL_LAYER_TYPE_ID,
                    deps={"execution_context": DIFY_EXECUTION_CONTEXT_LAYER_ID},
                    metadata=run_input.metadata,
                    config=run_input.shell_config or DifyShellLayerConfig(),
                )
            )

        if run_input.output is not None:
            layers.append(
                RunLayerSpec(
                    name=DIFY_AGENT_OUTPUT_LAYER_ID,
                    type=DIFY_OUTPUT_LAYER_TYPE_ID,
                    metadata=run_input.metadata,
                    config=DifyOutputLayerConfig(
                        json_schema=run_input.output.json_schema,
                        description=run_input.output.description,
                        strict=run_input.output.strict,
                    ),
                )
            )

        return CreateRunRequest(
            composition=RunComposition(layers=layers),
            purpose=run_input.purpose,
            idempotency_key=run_input.idempotency_key,
            metadata=run_input.metadata,
            session_snapshot=run_input.session_snapshot,
            on_exit=LayerExitSignals(
                default=ExitIntent.SUSPEND if run_input.suspend_on_exit else ExitIntent.DELETE,
            ),
        )


_SENSITIVE_KEY_PARTS = ("secret", "credential", "token", "password", "api_key")


def redact_for_agent_backend_log(value: object) -> object:
    """Return a JSON-like copy with credential-bearing keys redacted for logs/tests."""
    if isinstance(value, BaseModel):
        return redact_for_agent_backend_log(value.model_dump(mode="json", warnings=False))
    if isinstance(value, dict):
        redacted: dict[object, object] = {}
        for key, item in value.items():
            key_text = str(key).lower()
            if any(part in key_text for part in _SENSITIVE_KEY_PARTS):
                redacted[key] = "[REDACTED]"
            else:
                redacted[key] = redact_for_agent_backend_log(item)
        return redacted
    if isinstance(value, list):
        return [redact_for_agent_backend_log(item) for item in value]
    return value
