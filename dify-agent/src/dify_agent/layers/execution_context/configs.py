"""Client-safe DTOs for the Dify execution-context Agenton layer.

This layer carries both Dify product execution context (tenant, user, workflow,
invoke source) and Agent backend runtime mode. The product-facing fields are
used by trusted server-side boundaries such as the Agent Stub when they
need to reconstruct Dify API file-access scope without granting the sandbox any
direct inner-API credentials. Knowledge-base layers also read ``user_from`` from
this shared config so the inner Dify API can distinguish platform-user and
end-user searches without making that caller identity model-controlled.
Server-only plugin-daemon settings are injected by the runtime provider factory
and therefore do not appear in this public schema.
"""

from typing import ClassVar, Final, Literal, TypeAlias

from pydantic import ConfigDict

from agenton.layers import LayerConfig


DIFY_EXECUTION_CONTEXT_LAYER_TYPE_ID: Final[str] = "dify.execution_context"
DifyExecutionContextAgentMode: TypeAlias = Literal[
    "workflow_run",
    "single_step",
    "agent_app",
    "babysit",
    "fasten",
]
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


class DifyExecutionContextLayerConfig(LayerConfig):
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
    agent_mode: DifyExecutionContextAgentMode
    invoke_from: DifyExecutionContextInvokeFrom
    trace_id: str | None = None

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid", arbitrary_types_allowed=True)


__all__ = [
    "DIFY_EXECUTION_CONTEXT_LAYER_TYPE_ID",
    "DifyExecutionContextAgentMode",
    "DifyExecutionContextInvokeFrom",
    "DifyExecutionContextUserFrom",
    "DifyExecutionContextLayerConfig",
]
