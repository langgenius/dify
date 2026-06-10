"""Client-safe DTOs for the Dify execution-context Agenton layer.

This layer carries Dify-owned execution identifiers plus the tenant/user daemon
transport context shared by plugin-backed business layers. The identifiers are
for observability and product correlation only; callers must not treat them as
authorization proof. Server-only plugin-daemon settings are injected by the
runtime provider factory and therefore do not appear in this public schema.

Protocol note (Agent Files §1.3 / ENG-589): ``invoke_from`` now carries the *real*
Dify invocation source (who triggered the run) so downstream file/drive APIs can
rebuild the access context, while the agent *run mode* (how the runtime is driven)
moved to the dedicated ``agent_mode`` field. For back-compat ``invoke_from`` still
accepts the legacy agent-mode literals; new requests set ``agent_mode`` + a real
``invoke_from`` + ``user_from``.
"""

from typing import ClassVar, Final, Literal, TypeAlias

from pydantic import ConfigDict

from agenton.layers import LayerConfig


DIFY_EXECUTION_CONTEXT_LAYER_TYPE_ID: Final[str] = "dify.execution_context"

# How the Dify Agent runtime is being driven (the agent run mode).
DifyExecutionContextAgentMode: TypeAlias = Literal[
    "workflow_run",
    "single_step",
    "agent_app",
    "babysit",
    "fasten",
]

# The origin class of the acting user.
DifyExecutionContextUserFrom: TypeAlias = Literal["account", "end-user"]

# The real Dify invocation source. Includes the legacy agent-mode literals so
# older requests that carried the run mode in ``invoke_from`` still validate.
DifyExecutionContextInvokeFrom: TypeAlias = Literal[
    "service-api",
    "openapi",
    "web-app",
    "trigger",
    "explore",
    "debugger",
    "published",
    "validation",
    # legacy agent-mode values (back-compat)
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
    user_from: DifyExecutionContextUserFrom | None = None
    app_id: str | None = None
    workflow_id: str | None = None
    workflow_run_id: str | None = None
    node_id: str | None = None
    node_execution_id: str | None = None
    conversation_id: str | None = None
    agent_id: str | None = None
    agent_config_version_id: str | None = None
    # Real Dify invocation source. Optional for back-compat (older requests carried
    # the agent run mode here instead).
    invoke_from: DifyExecutionContextInvokeFrom | None = None
    # The agent run mode. New requests set this explicitly.
    agent_mode: DifyExecutionContextAgentMode | None = None
    trace_id: str | None = None

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid", arbitrary_types_allowed=True)


__all__ = [
    "DIFY_EXECUTION_CONTEXT_LAYER_TYPE_ID",
    "DifyExecutionContextAgentMode",
    "DifyExecutionContextInvokeFrom",
    "DifyExecutionContextLayerConfig",
    "DifyExecutionContextUserFrom",
]
