"""Build ``dify-agent`` run requests from API-side product concepts.

This module is intentionally an adapter, not a wire DTO package. The emitted
object is always ``dify_agent.protocol.CreateRunRequest`` so the Agent backend
protocol has a single owner. API-only context such as Agent Soul vs workflow job
prompt is preserved in registered module names. Execution identifiers live in
execution_context Config; model, tool and resource references are explicit Config
fields. The wire request contains current Config and optional state-only snapshot.
"""

from __future__ import annotations

import re
from collections.abc import Mapping
from typing import ClassVar, Literal

from dify_agent.layers.config import DifyConfigLayerConfig
from dify_agent.layers.dify_core_tools import DifyCoreToolsLayerConfig
from dify_agent.layers.dify_plugin import (
    DifyPluginLLMLayerConfig,
    DifyPluginToolsLayerConfig,
)
from dify_agent.layers.execution_context import (
    DifyExecutionContextLayerConfig,
)
from dify_agent.layers.knowledge import DifyKnowledgeBaseLayerConfig
from dify_agent.layers.output import DifyOutputLayerConfig
from dify_agent.layers.prompt import Config as PromptConfig
from dify_agent.layers.runtime import DifyRuntimeLayerConfig
from dify_agent.layers.shell import DifyShellLayerConfig
from dify_agent.layers.user_prompt import (
    DifyUserPromptFileConfig,
    DifyUserPromptLayerConfig,
)
from dify_agent.protocol import (
    DIFY_AGENT_HISTORY_LAYER_ID,
    DIFY_AGENT_MODEL_LAYER_ID,
    DIFY_AGENT_OUTPUT_LAYER_ID,
    CreateRunRequest,
    RunComposition,
    RunLayerSpec,
)
from dify_agent.protocol.snapshot import SessionSnapshot
from pydantic import BaseModel, ConfigDict, Field, JsonValue, field_validator

AGENT_SOUL_PROMPT_LAYER_ID = "agent_soul_prompt"
WORKFLOW_NODE_JOB_PROMPT_LAYER_ID = "workflow_node_job_prompt"
WORKFLOW_USER_PROMPT_LAYER_ID = "workflow_user_prompt"
AGENT_APP_USER_PROMPT_LAYER_ID = "agent_app_user_prompt"
DIFY_EXECUTION_CONTEXT_LAYER_ID = "execution_context"
DIFY_RUNTIME_LAYER_ID = "runtime"
DIFY_CONFIG_LAYER_ID = "config"
DIFY_PLUGIN_TOOLS_LAYER_ID = "tools"
DIFY_CORE_TOOLS_LAYER_ID = "core_tools"
DIFY_KNOWLEDGE_BASE_LAYER_ID = "knowledge"
DIFY_SHELL_LAYER_ID = "shell"
type AgentConfigVersionKind = Literal["snapshot", "draft", "build_draft"]


def _markdown_backtick_fence(text: str) -> str:
    """Choose a fence that will not terminate inside the prompt body."""
    longest_backtick_run = max((len(match.group(0)) for match in re.finditer(r"`+", text)), default=0)
    return "`" * max(3, longest_backtick_run + 1)


_BUILD_DRAFT_AGENT_SOUL_PROMPT = """You are running in build mode.

Objective:
- Improve this agent's working environment, configuration, tools, files, notes,
  and context so it can handle the intended task well.

Guidance:
- Treat the intended task as context for setup work, validation, and configuration decisions.
- Perform concrete investigative or setup steps when they help improve or verify the agent configuration.
- Use the installed `dify-agent` CLI when you need to inspect or persist Agent configuration."""


def _wrap_build_draft_agent_soul_prompt(prompt: str | None) -> str:
    """Reframe build-draft Agent Soul prompts as preparation work for a future run."""
    prompt_body = (prompt or "").strip()
    if not prompt_body:
        return _BUILD_DRAFT_AGENT_SOUL_PROMPT + "\n\nIntended task for later normal runs:\nNo task prompt was provided."
    fence = _markdown_backtick_fence(prompt_body)
    return (
        _BUILD_DRAFT_AGENT_SOUL_PROMPT
        + f"\n\nIntended task for later normal runs:\n{fence}text\n{prompt_body}\n{fence}"
    )


def _agent_soul_prompt_for_layer(
    prompt: str | None,
    *,
    config_version_kind: AgentConfigVersionKind,
) -> str | None:
    """Preserve normal snapshot/draft prompts and only wrap build-draft prompts.

    The API-side layer adapter is the product boundary where Agent Soul text
    becomes the model-facing system-prompt layer. ``snapshot`` and normal
    ``draft`` runs pass through the original effective prompt unchanged, while
    ``build_draft`` always emits a setup prompt. When an original prompt is
    present, it is reframed as future-run context and embedded in a fenced
    block; when it is blank, the setup instruction is still kept.
    """
    if config_version_kind != "build_draft":
        if prompt is None:
            return None
        if not prompt.strip():
            return None
        return prompt
    return _wrap_build_draft_agent_soul_prompt(prompt)


class AgentBackendModelConfig(BaseModel):
    """API-side model/plugin selection before it is converted to Dify Agent layers."""

    plugin_id: str
    model_provider: str
    model: str
    model_settings: dict[str, JsonValue] = Field(default_factory=dict)
    context_window_tokens: int | None = Field(default=None, gt=0)

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


# ``DifyPluginLLMLayerConfig.model_settings`` is pydantic_ai's ``ModelSettings``
# TypedDict (closed: unknown keys are rejected, explicit ``None`` values fail the
# per-field type checks). Agent Soul model settings carry a wider, nullable shape
# (``stop`` / ``response_format`` plus null-padded fields, plus arbitrary
# plugin-declared parameters such as Qwen's ``enable_thinking``), so the layer
# config only receives the keys the runtime contract accepts directly; anything
# else is forwarded through ``extra_body``, the TypedDict's own escape hatch for
# provider-specific parameters (see
# ``dify_agent.adapters.llm.model._map_model_settings_to_parameters``).
_AGENT_MODEL_SETTINGS_PASSTHROUGH_KEYS = (
    "temperature",
    "top_p",
    "presence_penalty",
    "frequency_penalty",
    "max_tokens",
)
_AGENT_MODEL_SETTINGS_KNOWN_KEYS = frozenset({*_AGENT_MODEL_SETTINGS_PASSTHROUGH_KEYS, "stop", "response_format"})


def _agent_model_settings(settings: Mapping[str, JsonValue]) -> dict[str, JsonValue] | None:
    sanitized: dict[str, JsonValue] = {
        key: settings[key] for key in _AGENT_MODEL_SETTINGS_PASSTHROUGH_KEYS if settings.get(key) is not None
    }
    stop = settings.get("stop")
    if isinstance(stop, list) and stop:
        sanitized["stop_sequences"] = stop

    extra_body: dict[str, JsonValue] = {
        key: value
        for key, value in settings.items()
        if key not in _AGENT_MODEL_SETTINGS_KNOWN_KEYS and value is not None
    }
    if extra_body:
        sanitized["extra_body"] = extra_body

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
    backend_binding_ref: str = Field(min_length=1)
    workflow_node_job_prompt: str
    user_prompt: str
    agent_soul_prompt: str | None = None
    agent_config_version_kind: AgentConfigVersionKind = "snapshot"
    idempotency_key: str | None = None
    output: AgentBackendOutputConfig | None = None
    tools: DifyPluginToolsLayerConfig | None = None
    core_tools: DifyCoreToolsLayerConfig | None = None
    knowledge: DifyKnowledgeBaseLayerConfig | None = None
    config_layer_config: DifyConfigLayerConfig | None = None
    include_shell: bool = False
    shell_config: DifyShellLayerConfig | None = None
    session_snapshot: SessionSnapshot | None = None
    include_history: bool = True
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
    backend_binding_ref: str = Field(min_length=1)
    user_prompt: str
    user_files: list[DifyUserPromptFileConfig] = Field(default_factory=list)
    agent_soul_prompt: str | None = None
    agent_config_version_kind: AgentConfigVersionKind = "snapshot"
    idempotency_key: str | None = None
    output: AgentBackendOutputConfig | None = None
    tools: DifyPluginToolsLayerConfig | None = None
    core_tools: DifyCoreToolsLayerConfig | None = None
    knowledge: DifyKnowledgeBaseLayerConfig | None = None
    config_layer_config: DifyConfigLayerConfig | None = None
    include_shell: bool = False
    shell_config: DifyShellLayerConfig | None = None
    session_snapshot: SessionSnapshot | None = None
    include_history: bool = True
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
        execution context → optional shell / config / history
        (multi-turn) → LLM → optional plugin-direct tools / core-routed tools /
        knowledge search / structured output. Mirrors the
        workflow-node layer ordering minus the workflow-job / previous-node
        prompt.
        """
        layers: list[RunLayerSpec] = []
        agent_soul_prompt = _agent_soul_prompt_for_layer(
            run_input.agent_soul_prompt,
            config_version_kind=run_input.agent_config_version_kind,
        )
        if agent_soul_prompt:
            layers.append(
                RunLayerSpec(
                    name=AGENT_SOUL_PROMPT_LAYER_ID,
                    config=(PromptConfig(prefix=agent_soul_prompt)).model_dump(mode="json"),
                )
            )

        layers.extend(
            [
                RunLayerSpec(
                    name=AGENT_APP_USER_PROMPT_LAYER_ID,
                    config=(
                        DifyUserPromptLayerConfig(text=run_input.user_prompt, files=run_input.user_files)
                    ).model_dump(mode="json"),
                ),
                RunLayerSpec(
                    name=DIFY_EXECUTION_CONTEXT_LAYER_ID,
                    config=(run_input.execution_context).model_dump(mode="json"),
                ),
            ]
        )

        include_shell = run_input.include_shell or run_input.config_layer_config is not None
        if include_shell:
            layers.append(
                RunLayerSpec(
                    name=DIFY_RUNTIME_LAYER_ID,
                    config=(DifyRuntimeLayerConfig(backend_binding_ref=run_input.backend_binding_ref)).model_dump(
                        mode="json"
                    ),
                )
            )
            # Sandboxed bash workspace (dify.shell). It enters before config so
            # eager pulls materialize content in the same filesystem used by model commands.
            layers.append(
                RunLayerSpec(
                    name=DIFY_SHELL_LAYER_ID,
                    config=(run_input.shell_config or DifyShellLayerConfig()).model_dump(mode="json"),
                )
            )

        if run_input.config_layer_config is not None:
            layers.append(
                RunLayerSpec(
                    name=DIFY_CONFIG_LAYER_ID,
                    config=(run_input.config_layer_config).model_dump(mode="json"),
                )
            )

        if run_input.include_history:
            layers.append(
                RunLayerSpec(
                    name=DIFY_AGENT_HISTORY_LAYER_ID,
                )
            )

        layers.append(
            RunLayerSpec(
                name=DIFY_AGENT_MODEL_LAYER_ID,
                config=(
                    DifyPluginLLMLayerConfig(
                        plugin_id=run_input.model.plugin_id,
                        model_provider=run_input.model.model_provider,
                        model=run_input.model.model,
                        model_settings=_agent_model_settings(run_input.model.model_settings),
                        context_window_tokens=run_input.model.context_window_tokens,
                    )
                ).model_dump(mode="json"),
            )
        )

        if run_input.tools is not None and run_input.tools.tools:
            layers.append(
                RunLayerSpec(
                    name=DIFY_PLUGIN_TOOLS_LAYER_ID,
                    config=(
                        run_input.tools.model_copy(update={"shell": DIFY_SHELL_LAYER_ID if include_shell else None})
                    ).model_dump(mode="json"),
                )
            )

        if run_input.core_tools is not None and run_input.core_tools.tools:
            layers.append(
                RunLayerSpec(
                    name=DIFY_CORE_TOOLS_LAYER_ID,
                    config=(run_input.core_tools).model_dump(mode="json"),
                )
            )

        if run_input.knowledge is not None and run_input.knowledge.sets:
            layers.append(
                RunLayerSpec(
                    name=DIFY_KNOWLEDGE_BASE_LAYER_ID,
                    config=(run_input.knowledge).model_dump(mode="json"),
                )
            )

        if run_input.output is not None:
            layers.append(
                RunLayerSpec(
                    name=DIFY_AGENT_OUTPUT_LAYER_ID,
                    config=(
                        DifyOutputLayerConfig(
                            json_schema=run_input.output.json_schema,
                            description=run_input.output.description,
                            strict=run_input.output.strict,
                        )
                    ).model_dump(mode="json"),
                )
            )

        return CreateRunRequest(
            composition=RunComposition(layers=layers),
            idempotency_key=run_input.idempotency_key,
            metadata=run_input.metadata,
            session_snapshot=run_input.session_snapshot,
        )

    def build_for_workflow_node(self, run_input: AgentBackendWorkflowNodeRunInput) -> CreateRunRequest:
        """Build a workflow Agent Node run request without defining another wire schema.

        Layer graph mirrors the workflow surface: prompts → execution context →
        optional shell / config / history → LLM → optional
        plugin-direct tools / core-routed tools / knowledge search /
        structured output.
        """
        layers: list[RunLayerSpec] = []
        agent_soul_prompt = _agent_soul_prompt_for_layer(
            run_input.agent_soul_prompt,
            config_version_kind=run_input.agent_config_version_kind,
        )
        if agent_soul_prompt:
            layers.append(
                RunLayerSpec(
                    name=AGENT_SOUL_PROMPT_LAYER_ID,
                    config=(PromptConfig(prefix=agent_soul_prompt)).model_dump(mode="json"),
                )
            )

        layers.extend(
            [
                RunLayerSpec(
                    name=WORKFLOW_NODE_JOB_PROMPT_LAYER_ID,
                    config=(PromptConfig(user=run_input.workflow_node_job_prompt)).model_dump(mode="json"),
                ),
                RunLayerSpec(
                    name=WORKFLOW_USER_PROMPT_LAYER_ID,
                    config=(PromptConfig(user=run_input.user_prompt)).model_dump(mode="json"),
                ),
                RunLayerSpec(
                    name=DIFY_EXECUTION_CONTEXT_LAYER_ID,
                    config=(run_input.execution_context).model_dump(mode="json"),
                ),
            ]
        )

        include_shell = run_input.include_shell or run_input.config_layer_config is not None
        if include_shell:
            layers.append(
                RunLayerSpec(
                    name=DIFY_RUNTIME_LAYER_ID,
                    config=(DifyRuntimeLayerConfig(backend_binding_ref=run_input.backend_binding_ref)).model_dump(
                        mode="json"
                    ),
                )
            )
            # Sandboxed bash workspace (dify.shell). It enters before config so
            # eager pulls materialize content in the same filesystem used by model commands.
            layers.append(
                RunLayerSpec(
                    name=DIFY_SHELL_LAYER_ID,
                    config=(run_input.shell_config or DifyShellLayerConfig()).model_dump(mode="json"),
                )
            )

        if run_input.config_layer_config is not None:
            layers.append(
                RunLayerSpec(
                    name=DIFY_CONFIG_LAYER_ID,
                    config=(run_input.config_layer_config).model_dump(mode="json"),
                )
            )

        if run_input.include_history:
            layers.append(
                RunLayerSpec(
                    name=DIFY_AGENT_HISTORY_LAYER_ID,
                )
            )

        layers.extend(
            [
                RunLayerSpec(
                    name=DIFY_AGENT_MODEL_LAYER_ID,
                    config=(
                        DifyPluginLLMLayerConfig(
                            plugin_id=run_input.model.plugin_id,
                            model_provider=run_input.model.model_provider,
                            model=run_input.model.model,
                            model_settings=_agent_model_settings(run_input.model.model_settings),
                            context_window_tokens=run_input.model.context_window_tokens,
                        )
                    ).model_dump(mode="json"),
                ),
            ]
        )

        if run_input.tools is not None and run_input.tools.tools:
            layers.append(
                RunLayerSpec(
                    name=DIFY_PLUGIN_TOOLS_LAYER_ID,
                    config=(
                        run_input.tools.model_copy(update={"shell": DIFY_SHELL_LAYER_ID if include_shell else None})
                    ).model_dump(mode="json"),
                )
            )

        if run_input.core_tools is not None and run_input.core_tools.tools:
            layers.append(
                RunLayerSpec(
                    name=DIFY_CORE_TOOLS_LAYER_ID,
                    config=(run_input.core_tools).model_dump(mode="json"),
                )
            )

        if run_input.knowledge is not None and run_input.knowledge.sets:
            layers.append(
                RunLayerSpec(
                    name=DIFY_KNOWLEDGE_BASE_LAYER_ID,
                    config=(run_input.knowledge).model_dump(mode="json"),
                )
            )

        if run_input.output is not None:
            layers.append(
                RunLayerSpec(
                    name=DIFY_AGENT_OUTPUT_LAYER_ID,
                    config=(
                        DifyOutputLayerConfig(
                            json_schema=run_input.output.json_schema,
                            description=run_input.output.description,
                            strict=run_input.output.strict,
                        )
                    ).model_dump(mode="json"),
                )
            )

        return CreateRunRequest(
            composition=RunComposition(layers=layers),
            idempotency_key=run_input.idempotency_key,
            metadata=run_input.metadata,
            session_snapshot=run_input.session_snapshot,
        )


_SENSITIVE_KEY_PARTS = ("secret", "credential", "token", "password", "api_key", "base64_data")


def redact_for_agent_backend_log(value: object) -> object:
    """Return a JSON-like copy with credential-bearing keys redacted for logs/tests."""
    if isinstance(value, BaseModel):
        return redact_for_agent_backend_log(value.model_dump(mode="json", warnings=False))
    if isinstance(value, dict):
        redacted: dict[object, object] = {}
        is_multimodal_file = value.get("type") == "image" and "filename" in value and "mime_type" in value
        for key, item in value.items():
            key_text = str(key).lower()
            if any(part in key_text for part in _SENSITIVE_KEY_PARTS) or (is_multimodal_file and key_text == "url"):
                redacted[key] = "[REDACTED]"
            else:
                redacted[key] = redact_for_agent_backend_log(item)
        return redacted
    if isinstance(value, list):
        return [redact_for_agent_backend_log(item) for item in value]
    return value
