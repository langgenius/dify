"""Client-safe DTOs for the Dify execution-context layer.

This layer carries both Dify product execution context (tenant, user, workflow,
invoke source) and Agent backend runtime mode. The product-facing fields are
used by trusted server-side boundaries such as the Agent Stub when they
need to reconstruct Dify API file-access scope without granting the sandbox any
direct inner-API credentials. Knowledge-base layers also read ``user_from`` from
this shared config so the inner Dify API can distinguish platform-user and
end-user searches without making that caller identity model-controlled.
Server-only plugin-daemon settings are injected by the runtime runtime services
and therefore do not appear in this public schema.
"""

from typing import Annotated, ClassVar, Literal, TypeAlias
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator


DifyExecutionContextAgentMode: TypeAlias = Literal[
    "workflow_run",
    "single_step",
    "agent_app",
    "babysit",
    "fasten",
]
DifyExecutionContextAgentConfigVersionKind: TypeAlias = Literal["snapshot", "draft", "build_draft"]
DifyExecutionContextUserFrom: TypeAlias = Literal["account", "end-user"]
DifyExecutionContextInvokeFrom: TypeAlias = Literal[
    "service-api",
    "openapi",
    "web-app",
    "trigger",
    "explore",
    "debugger",
    "published",
    "validation",
]


class ApplicationTracingContext(BaseModel):
    """API-issued application tracing policy; never contains exporter credentials.

    ``run_id`` refers to the API's durable tracing run, not the Agent backend's
    execution id. The parent identifies the owning message or workflow node.
    """

    version: Literal[1] = 1
    run_id: UUID
    invocation_id: UUID
    trace_id: Annotated[str, Field(pattern=r"^[0-9a-f]{32}$")]
    parent_span_id: Annotated[str, Field(pattern=r"^[0-9a-f]{16}$")]
    session_id: str
    capture_content: bool
    sampled: bool = True

    model_config = ConfigDict(extra="forbid", frozen=True)

    @field_validator("trace_id", "parent_span_id")
    @classmethod
    def validate_nonzero_id(cls, value: str) -> str:
        if int(value, 16) == 0:
            raise ValueError("OpenTelemetry ids must be nonzero")
        return value


class DifyExecutionContextLayerConfig(BaseModel):
    """Public config for Dify execution identity and daemon transport context."""

    tenant_id: str
    user_id: str | None = None
    user_from: DifyExecutionContextUserFrom | None = None
    app_id: str | None = None
    workflow_id: str | None = None
    workflow_run_id: str | None = None
    node_id: str | None = None
    node_execution_id: str | None = None
    conversation_id: str | None = None
    agent_id: str | None = None
    agent_config_version_id: str | None = None
    agent_config_version_kind: DifyExecutionContextAgentConfigVersionKind | None = None
    agent_mode: DifyExecutionContextAgentMode
    invoke_from: DifyExecutionContextInvokeFrom
    trace_id: str | None = None
    tracing: ApplicationTracingContext | None = None

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid", arbitrary_types_allowed=True)


__all__ = [
    "ApplicationTracingContext",
    "DifyExecutionContextAgentConfigVersionKind",
    "DifyExecutionContextAgentMode",
    "DifyExecutionContextInvokeFrom",
    "DifyExecutionContextUserFrom",
    "DifyExecutionContextLayerConfig",
]
