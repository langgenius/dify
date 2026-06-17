"""Client-safe DTOs for the Dify execution-context Agenton layer.

This layer carries Dify-owned execution identifiers plus the tenant/user daemon
transport context shared by plugin-backed business layers. The identifiers are
for observability and product correlation only; callers must not treat them as
authorization proof. Server-only plugin-daemon settings are injected by the
runtime provider factory and therefore do not appear in this public schema.

Knowledge-base layers also read ``user_from`` from this shared config so the
inner Dify API can distinguish platform-user and end-user searches without
making that caller identity model-controlled.
"""

from typing import ClassVar, Final, Literal, TypeAlias

from pydantic import ConfigDict

from agenton.layers import LayerConfig


DIFY_EXECUTION_CONTEXT_LAYER_TYPE_ID: Final[str] = "dify.execution_context"
DifyExecutionContextInvokeFrom: TypeAlias = Literal[
    "workflow_run",
    "single_step",
    "agent_app",
    "babysit",
    "fasten",
]


class DifyExecutionContextLayerConfig(LayerConfig):
    """Public config for Dify execution identity and daemon transport context."""

    tenant_id: str
    user_id: str | None = None
    user_from: Literal["account", "end-user"] | None = None
    app_id: str | None = None
    workflow_id: str | None = None
    workflow_run_id: str | None = None
    node_id: str | None = None
    node_execution_id: str | None = None
    conversation_id: str | None = None
    agent_id: str | None = None
    agent_config_version_id: str | None = None
    invoke_from: DifyExecutionContextInvokeFrom
    trace_id: str | None = None

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid", arbitrary_types_allowed=True)


__all__ = [
    "DIFY_EXECUTION_CONTEXT_LAYER_TYPE_ID",
    "DifyExecutionContextInvokeFrom",
    "DifyExecutionContextLayerConfig",
]
