"""Request/response DTOs for the Agent tool inner invoke API."""

from __future__ import annotations

from typing import ClassVar, Literal

from pydantic import BaseModel, ConfigDict, Field, JsonValue

type AgentToolProviderType = Literal["plugin", "builtin", "api", "workflow", "mcp"]


class AgentToolInvokeCaller(BaseModel):
    tenant_id: str
    user_id: str
    user_from: str
    app_id: str
    invoke_from: str
    conversation_id: str | None = None
    workflow_id: str | None = None
    workflow_run_id: str | None = None
    node_id: str | None = None
    node_execution_id: str | None = None
    agent_id: str | None = None
    agent_config_version_id: str | None = None

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class AgentToolInvokeTarget(BaseModel):
    """One tool invocation payload.

    `runtime_parameters` are API-prepared hidden/form/runtime values forwarded
    into `ToolManager` runtime construction. `tool_parameters` are the live
    LLM/user invocation arguments supplied at call time.
    """

    provider_type: AgentToolProviderType
    provider_id: str
    tool_name: str
    credential_id: str | None = None
    tool_parameters: dict[str, JsonValue] = Field(default_factory=dict)
    runtime_parameters: dict[str, JsonValue] = Field(default_factory=dict)

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class AgentToolInvokeRequest(BaseModel):
    caller: AgentToolInvokeCaller
    tool: AgentToolInvokeTarget

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class AgentToolInvokeResponse(BaseModel):
    messages: list[dict[str, JsonValue]] = Field(default_factory=list)
    observation: str
    metadata: dict[str, JsonValue] = Field(default_factory=dict)

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")
