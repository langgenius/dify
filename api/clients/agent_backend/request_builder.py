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

from typing import ClassVar, cast

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
from dify_agent.layers.execution_context import (
    DIFY_EXECUTION_CONTEXT_LAYER_TYPE_ID,
    DifyExecutionContextLayerConfig,
)
from dify_agent.layers.output import DIFY_OUTPUT_LAYER_TYPE_ID, DifyOutputLayerConfig
from dify_agent.protocol import (
    DIFY_AGENT_HISTORY_LAYER_ID,
    DIFY_AGENT_MODEL_LAYER_ID,
    DIFY_AGENT_OUTPUT_LAYER_ID,
    CreateRunRequest,
    LayerExitSignals,
    RunComposition,
    RunLayerSpec,
    RunPurpose,
)
from pydantic import BaseModel, ConfigDict, Field, JsonValue, field_validator

AGENT_SOUL_PROMPT_LAYER_ID = "agent_soul_prompt"
WORKFLOW_NODE_JOB_PROMPT_LAYER_ID = "workflow_node_job_prompt"
WORKFLOW_USER_PROMPT_LAYER_ID = "workflow_user_prompt"
DIFY_EXECUTION_CONTEXT_LAYER_ID = "execution_context"
DIFY_PLUGIN_TOOLS_LAYER_ID = "tools"

# Layer types that hold credentials in their per-run config. These are excluded
# from the cleanup-replay composition (and from the snapshot that is sent with
# the cleanup request) because we deliberately do not persist plaintext
# credentials between runs.
_CLEANUP_EXCLUDED_LAYER_TYPES: tuple[str, ...] = (
    DIFY_PLUGIN_LLM_LAYER_TYPE_ID,
    DIFY_PLUGIN_TOOLS_LAYER_TYPE_ID,
)


class CleanupLayerSpec(BaseModel):
    """One layer node replayed by an Agent backend cleanup-only run.

    Cleanup composition cannot include credential-bearing plugin layers, so we
    persist only the non-plugin layer specs together with the original config.
    Storing the config (rather than just ``name``/``type``) means cleanup does
    not depend on the original build-time inputs being re-derivable.
    """

    name: str
    type: str
    deps: dict[str, str] = Field(default_factory=dict)
    metadata: dict[str, JsonValue] = Field(default_factory=dict)
    config: JsonValue = None

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


def extract_cleanup_layer_specs(composition: RunComposition) -> list[CleanupLayerSpec]:
    """Project the in-flight composition into the persistable cleanup spec list.

    Plugin layers are intentionally dropped (their configs hold credentials and
    the lifecycle contract says "do not include an LLM layer" during cleanup).
    The filtered names must later drive snapshot filtering so the agenton
    compositor's name-order check still passes for the cleanup run.
    """
    excluded = set(_CLEANUP_EXCLUDED_LAYER_TYPES)
    specs: list[CleanupLayerSpec] = []
    for layer in composition.layers:
        if layer.type in excluded:
            continue
        config_value: JsonValue = None
        if isinstance(layer.config, BaseModel):
            config_value = layer.config.model_dump(mode="json", warnings=False)
        else:
            # ``RunLayerSpec.config`` is typed as ``LayerConfigInput`` which
            # includes ``Mapping[str, object] | bytes``. In the cleanup-replay
            # pipeline our builder only emits BaseModel-derived configs or
            # ``None``, so the wider input alias narrows safely here.
            config_value = cast(JsonValue, layer.config)
        specs.append(
            CleanupLayerSpec(
                name=layer.name,
                type=layer.type,
                deps=dict(layer.deps),
                metadata=dict(layer.metadata),
                config=config_value,
            )
        )
    return specs


def _filter_snapshot_to_specs(
    snapshot: CompositorSessionSnapshot,
    specs: list[CleanupLayerSpec],
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


class AgentBackendRunRequestBuilder:
    """Converts API product state into the public ``dify-agent`` run protocol."""

    def build_cleanup_request(
        self,
        *,
        session_snapshot: CompositorSessionSnapshot,
        composition_layer_specs: list[CleanupLayerSpec],
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
        if not composition_layer_specs:
            raise ValueError(
                "build_cleanup_request requires composition_layer_specs; an empty "
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
            for spec in composition_layer_specs
        ]
        filtered_snapshot = _filter_snapshot_to_specs(session_snapshot, composition_layer_specs)
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
                        model_settings=run_input.model.model_settings or None,
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
