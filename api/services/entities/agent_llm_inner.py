"""DTOs for the API-owned Agent LLM gateway."""

from __future__ import annotations

from typing import ClassVar, Literal

from pydantic import BaseModel, ConfigDict, Field, JsonValue

from graphon.model_runtime.entities.message_entities import PromptMessageTool

type AgentLLMMode = Literal["workflow_run", "single_step", "agent_app", "babysit", "fasten"]
type AgentConfigVersionKind = Literal["snapshot", "draft", "build_draft"]


class AgentLLMInvokeCaller(BaseModel):
    invocation_id: str
    agent_run_id: str
    call_index: int = Field(ge=1)
    tenant_id: str
    user_id: str
    user_from: Literal["account", "end-user"]
    app_id: str
    invoke_from: str
    agent_mode: AgentLLMMode
    conversation_id: str | None = None
    workflow_id: str | None = None
    workflow_run_id: str | None = None
    node_id: str | None = None
    node_execution_id: str | None = None
    agent_id: str | None = None
    agent_config_version_id: str | None = None
    agent_config_version_kind: AgentConfigVersionKind | None = None
    trace_id: str | None = None

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class AgentLLMInvokeTarget(BaseModel):
    provider: str
    model: str
    # The trusted Agent service already produces plugin-runtime prompt payloads.
    # Keep them opaque here so this transport cannot discard role-specific or
    # newly introduced fields before the authoritative runtime validates them.
    prompt_messages: list[dict[str, JsonValue]]
    model_parameters: dict[str, JsonValue] = Field(default_factory=dict)
    tools: list[PromptMessageTool] | None = None
    stop: list[str] | None = None
    stream: bool = True

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid", arbitrary_types_allowed=True)


class AgentLLMInvokeRequest(BaseModel):
    caller: AgentLLMInvokeCaller
    target: AgentLLMInvokeTarget

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid", arbitrary_types_allowed=True)


__all__ = [
    "AgentConfigVersionKind",
    "AgentLLMInvokeCaller",
    "AgentLLMInvokeRequest",
    "AgentLLMInvokeTarget",
    "AgentLLMMode",
]
