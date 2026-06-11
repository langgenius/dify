"""API-side integration boundary for the Dify Agent backend.

Public wire DTOs come from ``dify_agent.protocol``. This package only contains
API adapters: request building from Dify product concepts, the run-lifecycle
adapter that normalizes shared ``dify-agent`` client errors into API-specific
integration errors, event adaptation for future workflow integration, and
deterministic fakes.

After the sandbox client merge, sandbox file operations intentionally do *not*
introduce another API-local concrete HTTP wrapper, protocol, or factory.
Sandbox services construct and use the shared ``dify_agent.client.Client``
directly, while run operations still keep the local adapter/factory for error
normalization.
"""

from clients.agent_backend.client import AgentBackendRunClient, DifyAgentBackendRunClient
from clients.agent_backend.errors import (
    AgentBackendError,
    AgentBackendHTTPError,
    AgentBackendRequestBuildError,
    AgentBackendRunFailedError,
    AgentBackendStreamError,
    AgentBackendTransportError,
    AgentBackendValidationError,
)
from clients.agent_backend.event_adapter import (
    AgentBackendInternalEvent,
    AgentBackendInternalEventType,
    AgentBackendRunCancelledInternalEvent,
    AgentBackendRunEventAdapter,
    AgentBackendRunFailedInternalEvent,
    AgentBackendRunPausedInternalEvent,
    AgentBackendRunStartedInternalEvent,
    AgentBackendRunSucceededInternalEvent,
    AgentBackendStreamInternalEvent,
)
from clients.agent_backend.factory import create_agent_backend_run_client
from clients.agent_backend.fake_client import FakeAgentBackendRunClient, FakeAgentBackendScenario
from clients.agent_backend.request_builder import (
    AGENT_SOUL_PROMPT_LAYER_ID,
    DIFY_EXECUTION_CONTEXT_LAYER_ID,
    DIFY_PLUGIN_TOOLS_LAYER_ID,
    DIFY_SHELL_LAYER_ID,
    WORKFLOW_NODE_JOB_PROMPT_LAYER_ID,
    WORKFLOW_USER_PROMPT_LAYER_ID,
    AgentBackendModelConfig,
    AgentBackendOutputConfig,
    AgentBackendRunRequestBuilder,
    AgentBackendWorkflowNodeRunInput,
    CleanupLayerSpec,
    extract_cleanup_layer_specs,
    redact_for_agent_backend_log,
)

__all__ = [
    "AGENT_SOUL_PROMPT_LAYER_ID",
    "DIFY_EXECUTION_CONTEXT_LAYER_ID",
    "DIFY_PLUGIN_TOOLS_LAYER_ID",
    "DIFY_SHELL_LAYER_ID",
    "WORKFLOW_NODE_JOB_PROMPT_LAYER_ID",
    "WORKFLOW_USER_PROMPT_LAYER_ID",
    "AgentBackendError",
    "AgentBackendHTTPError",
    "AgentBackendInternalEvent",
    "AgentBackendInternalEventType",
    "AgentBackendModelConfig",
    "AgentBackendOutputConfig",
    "AgentBackendRequestBuildError",
    "AgentBackendRunCancelledInternalEvent",
    "AgentBackendRunClient",
    "AgentBackendRunEventAdapter",
    "AgentBackendRunFailedError",
    "AgentBackendRunFailedInternalEvent",
    "AgentBackendRunPausedInternalEvent",
    "AgentBackendRunRequestBuilder",
    "AgentBackendRunStartedInternalEvent",
    "AgentBackendRunSucceededInternalEvent",
    "AgentBackendStreamError",
    "AgentBackendStreamInternalEvent",
    "AgentBackendTransportError",
    "AgentBackendValidationError",
    "AgentBackendWorkflowNodeRunInput",
    "CleanupLayerSpec",
    "DifyAgentBackendRunClient",
    "FakeAgentBackendRunClient",
    "FakeAgentBackendScenario",
    "create_agent_backend_run_client",
    "extract_cleanup_layer_specs",
    "redact_for_agent_backend_log",
]
