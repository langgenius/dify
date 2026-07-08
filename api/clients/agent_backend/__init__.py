"""API-side integration boundary for the Dify Agent backend.

Public wire DTOs come from ``dify_agent.protocol``. This package only contains
API adapters: request building from Dify product concepts, a thin client wrapper,
event adaptation for future workflow integration, and deterministic fakes.
"""

from dify_agent.protocol import RuntimeLayerSpec, extract_runtime_layer_specs

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
    AgentBackendAgentMessageDeltaInternalEvent,
    AgentBackendDeferredToolCallInternalEvent,
    AgentBackendInternalEvent,
    AgentBackendInternalEventType,
    AgentBackendRunCancelledInternalEvent,
    AgentBackendRunEventAdapter,
    AgentBackendRunFailedInternalEvent,
    AgentBackendRunStartedInternalEvent,
    AgentBackendRunSucceededInternalEvent,
    AgentBackendStreamInternalEvent,
    AgentBackendTerminalOutputDeltaInternalEvent,
)
from clients.agent_backend.factory import create_agent_backend_run_client
from clients.agent_backend.fake_client import FakeAgentBackendRunClient, FakeAgentBackendScenario
from clients.agent_backend.request_builder import (
    AGENT_SOUL_PROMPT_LAYER_ID,
    DIFY_CONFIG_LAYER_ID,
    DIFY_CORE_TOOLS_LAYER_ID,
    DIFY_EXECUTION_CONTEXT_LAYER_ID,
    DIFY_KNOWLEDGE_BASE_LAYER_ID,
    DIFY_PLUGIN_TOOLS_LAYER_ID,
    WORKFLOW_NODE_JOB_PROMPT_LAYER_ID,
    WORKFLOW_USER_PROMPT_LAYER_ID,
    AgentBackendAgentAppRunInput,
    AgentBackendModelConfig,
    AgentBackendOutputConfig,
    AgentBackendRunRequestBuilder,
    AgentBackendWorkflowNodeRunInput,
    redact_for_agent_backend_log,
)
from clients.agent_backend.session_cleanup import (
    AgentBackendSessionCleanupPayload,
    AgentBackendSessionCleanupResult,
    cleanup_agent_backend_session,
)

__all__ = [
    "AGENT_SOUL_PROMPT_LAYER_ID",
    "DIFY_CONFIG_LAYER_ID",
    "DIFY_CORE_TOOLS_LAYER_ID",
    "DIFY_EXECUTION_CONTEXT_LAYER_ID",
    "DIFY_KNOWLEDGE_BASE_LAYER_ID",
    "DIFY_PLUGIN_TOOLS_LAYER_ID",
    "WORKFLOW_NODE_JOB_PROMPT_LAYER_ID",
    "WORKFLOW_USER_PROMPT_LAYER_ID",
    "AgentBackendAgentAppRunInput",
    "AgentBackendAgentMessageDeltaInternalEvent",
    "AgentBackendDeferredToolCallInternalEvent",
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
    "AgentBackendRunRequestBuilder",
    "AgentBackendRunStartedInternalEvent",
    "AgentBackendRunSucceededInternalEvent",
    "AgentBackendSessionCleanupPayload",
    "AgentBackendSessionCleanupResult",
    "AgentBackendStreamError",
    "AgentBackendStreamInternalEvent",
    "AgentBackendTerminalOutputDeltaInternalEvent",
    "AgentBackendTransportError",
    "AgentBackendValidationError",
    "AgentBackendWorkflowNodeRunInput",
    "DifyAgentBackendRunClient",
    "FakeAgentBackendRunClient",
    "FakeAgentBackendScenario",
    "RuntimeLayerSpec",
    "cleanup_agent_backend_session",
    "create_agent_backend_run_client",
    "extract_runtime_layer_specs",
    "redact_for_agent_backend_log",
]
