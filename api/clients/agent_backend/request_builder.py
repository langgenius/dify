"""Build ``dify-agent`` run requests from API-side product concepts.

This module is intentionally an adapter, not a wire DTO package. The emitted
object is always ``dify_agent.protocol.CreateRunRequest`` so the Agent backend
protocol has a single owner. API-only context such as Agent Soul vs workflow job
prompt is preserved in layer names and metadata until the dedicated product
schemas land in later phases.
"""

from __future__ import annotations

from typing import ClassVar

from agenton.compositor import CompositorSessionSnapshot
from agenton.layers import ExitIntent
from agenton_collections.layers.plain import PLAIN_PROMPT_LAYER_TYPE_ID, PromptLayerConfig
from dify_agent.layers.dify_plugin import (
    DIFY_PLUGIN_LAYER_TYPE_ID,
    DIFY_PLUGIN_LLM_LAYER_TYPE_ID,
    DifyPluginCredentialValue,
    DifyPluginLayerConfig,
    DifyPluginLLMLayerConfig,
)
from dify_agent.layers.output import DIFY_OUTPUT_LAYER_TYPE_ID, DifyOutputLayerConfig
from dify_agent.protocol import (
    DIFY_AGENT_MODEL_LAYER_ID,
    DIFY_AGENT_OUTPUT_LAYER_ID,
    CreateRunRequest,
    ExecutionContext,
    LayerExitSignals,
    RunComposition,
    RunLayerSpec,
    RunPurpose,
)
from pydantic import BaseModel, ConfigDict, Field, JsonValue, field_validator

AGENT_SOUL_PROMPT_LAYER_ID = "agent_soul_prompt"
WORKFLOW_NODE_JOB_PROMPT_LAYER_ID = "workflow_node_job_prompt"
WORKFLOW_USER_PROMPT_LAYER_ID = "workflow_user_prompt"
DIFY_PLUGIN_CONTEXT_LAYER_ID = "plugin"


class AgentBackendModelConfig(BaseModel):
    """API-side model/plugin selection before it is converted to Dify Agent layers."""

    tenant_id: str
    plugin_id: str
    model_provider: str
    model: str
    user_id: str | None = None
    credentials: dict[str, DifyPluginCredentialValue] = Field(default_factory=dict)
    model_settings: dict[str, JsonValue] = Field(default_factory=dict)

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class AgentBackendOutputConfig(BaseModel):
    """API-side structured output declaration for the conventional output layer."""

    json_schema: dict[str, JsonValue]
    name: str = "final_result"
    description: str | None = None
    strict: bool | None = None

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class AgentBackendWorkflowNodeRunInput(BaseModel):
    """Inputs needed to build the first workflow-node-oriented Agent backend run request."""

    model: AgentBackendModelConfig
    execution_context: ExecutionContext
    workflow_node_job_prompt: str
    user_prompt: str
    agent_soul_prompt: str | None = None
    purpose: RunPurpose = "workflow_node"
    idempotency_key: str | None = None
    output: AgentBackendOutputConfig | None = None
    session_snapshot: CompositorSessionSnapshot | None = None
    suspend_on_exit: bool = False
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
                    name=DIFY_PLUGIN_CONTEXT_LAYER_ID,
                    type=DIFY_PLUGIN_LAYER_TYPE_ID,
                    metadata=run_input.metadata,
                    config=DifyPluginLayerConfig(
                        tenant_id=run_input.model.tenant_id,
                        plugin_id=run_input.model.plugin_id,
                        user_id=run_input.model.user_id,
                    ),
                ),
                RunLayerSpec(
                    name=DIFY_AGENT_MODEL_LAYER_ID,
                    type=DIFY_PLUGIN_LLM_LAYER_TYPE_ID,
                    deps={"plugin": DIFY_PLUGIN_CONTEXT_LAYER_ID},
                    metadata=run_input.metadata,
                    config=DifyPluginLLMLayerConfig(
                        model_provider=run_input.model.model_provider,
                        model=run_input.model.model,
                        credentials=run_input.model.credentials,
                        model_settings=run_input.model.model_settings or None,
                    ),
                ),
            ]
        )

        if run_input.output is not None:
            layers.append(
                RunLayerSpec(
                    name=DIFY_AGENT_OUTPUT_LAYER_ID,
                    type=DIFY_OUTPUT_LAYER_TYPE_ID,
                    metadata=run_input.metadata,
                    config=DifyOutputLayerConfig(
                        json_schema=run_input.output.json_schema,
                        name=run_input.output.name,
                        description=run_input.output.description,
                        strict=run_input.output.strict,
                    ),
                )
            )

        return CreateRunRequest(
            composition=RunComposition(layers=layers),
            execution_context=run_input.execution_context,
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
