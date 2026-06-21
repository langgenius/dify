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
    AgentBackendDeferredToolCallInternalEvent,
    AgentBackendInternalEvent,
    AgentBackendInternalEventType,
    AgentBackendRunCancelledInternalEvent,
    AgentBackendRunEventAdapter,
    AgentBackendRunFailedInternalEvent,
    AgentBackendRunStartedInternalEvent,
    AgentBackendRunSucceededInternalEvent,
    AgentBackendStreamInternalEvent,
)
from clients.agent_backend.factory import create_agent_backend_run_client
from clients.agent_backend.fake_client import FakeAgentBackendRunClient, FakeAgentBackendScenario
from clients.agent_backend.request_builder import (
    AGENT_SOUL_PROMPT_LAYER_ID,
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

__all__ = [
    "AGENT_SOUL_PROMPT_LAYER_ID",
    "DIFY_EXECUTION_CONTEXT_LAYER_ID",
    "DIFY_KNOWLEDGE_BASE_LAYER_ID",
    "DIFY_PLUGIN_TOOLS_LAYER_ID",
    "WORKFLOW_NODE_JOB_PROMPT_LAYER_ID",
    "WORKFLOW_USER_PROMPT_LAYER_ID",
    "AgentBackendAgentAppRunInput",
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
    "AgentBackendStreamError",
    "AgentBackendStreamInternalEvent",
    "AgentBackendTransportError",
    "AgentBackendValidationError",
    "AgentBackendWorkflowNodeRunInput",
    "DifyAgentBackendRunClient",
    "FakeAgentBackendRunClient",
    "FakeAgentBackendScenario",
    "RuntimeLayerSpec",
    "create_agent_backend_run_client",
    "extract_runtime_layer_specs",
    "redact_for_agent_backend_log",
]
