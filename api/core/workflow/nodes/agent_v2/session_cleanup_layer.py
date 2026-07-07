from __future__ import annotations

import logging
from typing import override

from clients.agent_backend import AgentBackendError, AgentBackendRunClient, AgentBackendRunRequestBuilder
from clients.agent_backend.factory import create_agent_backend_run_client
from configs import dify_config
from core.workflow.system_variables import SystemVariableKey, get_system_text
from graphon.graph_engine.layers import GraphEngineLayer
from graphon.graph_events import (
    GraphEngineEvent,
    GraphRunAbortedEvent,
    GraphRunFailedEvent,
    GraphRunPartialSucceededEvent,
    GraphRunSucceededEvent,
)

from .session_store import StoredWorkflowAgentSession, WorkflowAgentRuntimeSessionStore

logger = logging.getLogger(__name__)


# Upper bound on how long a cleanup-only run is allowed to settle before the
# layer gives up and leaves the row ACTIVE so it can be retried later. Cleanup
# work is mostly local agent-backend bookkeeping (no LLM inference), so 30s is
# generous; a hung backend should never block workflow termination beyond this.
_CLEANUP_WAIT_TIMEOUT_SECONDS = 30.0


class WorkflowAgentSessionCleanupLayer(GraphEngineLayer):
    """Retires workflow Agent session snapshots when a workflow reaches a terminal state.

    Implementation notes — there are two failure modes the cleanup path has to
    avoid simultaneously:

    1. The agenton compositor on the agent-backend side validates the cleanup
       request's session snapshot against the replayed composition before
       running any lifecycle hook. If the snapshot's layer names diverge from
       the composition, the run fails asynchronously with ``run_failed`` — but
       the initial ``POST /runs`` already returned 202, so the API side has no
       visibility of the failure unless it waits for terminal status. The
       ``runtime_layer_specs`` persistence in A.1–A.4 plus the
       ``_filter_snapshot_to_specs`` shape in ``build_cleanup_request`` keeps
       the two name lists in sync.

    2. The current agent backend's ``runner.py::_run_agent`` always invokes
       ``run.get_layer("llm")`` and the structured-output / history validators
       before exiting any slot — there is no ``purpose: "cleanup"`` branch
       yet. A truly cleanup-only request (no LLM layer) therefore still
       crashes inside the runner with ``Layer 'llm' is not defined in this
       compositor run.``. Until the backend grows a cleanup-only purpose,
       this layer **does not issue an HTTP cleanup run**: it simply retires
       the local snapshot row so stale state cannot be re-resumed, and lets
       the agent backend's own retention TTL release the suspended layers.

    The HTTP-cleanup machinery (``build_cleanup_request`` + ``wait_run``) is
    intentionally still wired into the request builder + integration tests so
    that when the agent backend supports cleanup runs we can flip the switch
    here with a one-line change (see ``_HTTP_CLEANUP_SUPPORTED``).
    """

    # Flip to True once dify-agent's runner has a ``purpose=cleanup`` branch
    # that skips the LLM/output/user-prompt invariants. Until then we only
    # update the local row; the spec list is still persisted so the future
    # HTTP cleanup path has everything it needs.
    _HTTP_CLEANUP_SUPPORTED: bool = False

    _TERMINAL_EVENTS = (
        GraphRunSucceededEvent,
        GraphRunPartialSucceededEvent,
        GraphRunFailedEvent,
        GraphRunAbortedEvent,
    )

    def __init__(
        self,
        *,
        session_store: WorkflowAgentRuntimeSessionStore,
        request_builder: AgentBackendRunRequestBuilder,
        agent_backend_client: AgentBackendRunClient | None,
        cleanup_wait_timeout_seconds: float = _CLEANUP_WAIT_TIMEOUT_SECONDS,
    ) -> None:
        super().__init__()
        self._session_store = session_store
        self._request_builder = request_builder
        self._agent_backend_client = agent_backend_client
        self._cleanup_wait_timeout_seconds = cleanup_wait_timeout_seconds

    @override
    def on_graph_start(self) -> None:
        return

    @override
    def on_event(self, event: GraphEngineEvent) -> None:
        if not isinstance(event, self._TERMINAL_EVENTS):
            return
        workflow_run_id = get_system_text(
            self.graph_runtime_state.variable_pool,
            SystemVariableKey.WORKFLOW_EXECUTION_ID,
        )
        if not workflow_run_id:
            logger.warning("Skipping workflow Agent session cleanup: workflow_run_id is missing.")
            return

        for stored_session in self._session_store.list_active_sessions(workflow_run_id=workflow_run_id):
            self._cleanup_session(stored_session)

    @override
    def on_graph_end(self, error: Exception | None) -> None:
        return

    def _cleanup_session(self, stored_session: StoredWorkflowAgentSession) -> None:
        scope = stored_session.scope
        if not self._HTTP_CLEANUP_SUPPORTED:
            # Agent backend has no cleanup-only run mode yet (see class
            # docstring). Retire the local row so future re-entries do not
            # resume from stale state, and let the backend's retention TTL
            # release the suspended layers on its own schedule.
            logger.info(
                "Workflow Agent session retired locally; HTTP cleanup is disabled "
                "until the agent backend supports a cleanup-only run mode. "
                "workflow_run_id=%s node_id=%s binding_id=%s agent_id=%s previous_run_id=%s",
                scope.workflow_run_id,
                scope.node_id,
                scope.binding_id,
                scope.agent_id,
                stored_session.backend_run_id,
            )
            self._session_store.mark_cleaned(scope=scope, backend_run_id=stored_session.backend_run_id)
            return

        if self._agent_backend_client is None:
            # HTTP cleanup was enabled by the caller but no client was wired
            # in (e.g. the API runs without AGENT_BACKEND_BASE_URL configured).
            # Leave the row ACTIVE so an operator restart with proper config
            # can drive the cleanup; do not silently retire it.
            logger.warning(
                "Skipping Agent backend cleanup: HTTP cleanup is enabled but no agent "
                "backend client is wired in. workflow_run_id=%s node_id=%s agent_id=%s",
                scope.workflow_run_id,
                scope.node_id,
                scope.agent_id,
            )
            return

        if not stored_session.runtime_layer_specs:
            # Sessions persisted before A.1 landed do not carry the spec list,
            # so we cannot replay a valid cleanup composition. Leave the row
            # ACTIVE and warn so the absence shows up in observability rather
            # than being silently swallowed by a doomed cleanup run.
            logger.warning(
                "Skipping Agent backend cleanup: no runtime_layer_specs persisted. "
                "workflow_run_id=%s node_id=%s agent_id=%s",
                scope.workflow_run_id,
                scope.node_id,
                scope.agent_id,
            )
            return

        request = self._request_builder.build_cleanup_request(
            session_snapshot=stored_session.session_snapshot,
            runtime_layer_specs=stored_session.runtime_layer_specs,
            idempotency_key=f"{scope.workflow_run_id}:{scope.node_id}:{scope.binding_id}:agent-session-cleanup",
            metadata={
                "tenant_id": scope.tenant_id,
                "app_id": scope.app_id,
                "workflow_id": scope.workflow_id,
                "workflow_run_id": scope.workflow_run_id,
                "node_id": scope.node_id,
                "node_execution_id": scope.node_execution_id,
                "binding_id": scope.binding_id,
                "agent_id": scope.agent_id,
                "agent_config_snapshot_id": scope.agent_config_snapshot_id,
                "previous_agent_backend_run_id": stored_session.backend_run_id,
            },
        )
        try:
            response = self._agent_backend_client.create_run(request)
        except AgentBackendError:
            logger.warning(
                "Agent backend session cleanup request failed: workflow_run_id=%s node_id=%s agent_id=%s",
                scope.workflow_run_id,
                scope.node_id,
                scope.agent_id,
                exc_info=True,
            )
            return

        try:
            status_response = self._agent_backend_client.wait_run(
                response.run_id, timeout_seconds=self._cleanup_wait_timeout_seconds
            )
        except AgentBackendError:
            logger.warning(
                "Agent backend session cleanup wait_run failed: "
                "workflow_run_id=%s node_id=%s agent_id=%s cleanup_run_id=%s",
                scope.workflow_run_id,
                scope.node_id,
                scope.agent_id,
                response.run_id,
                exc_info=True,
            )
            return

        if status_response.status != "succeeded":
            logger.warning(
                "Agent backend session cleanup did not succeed: status=%s error=%s "
                "workflow_run_id=%s node_id=%s agent_id=%s cleanup_run_id=%s",
                status_response.status,
                status_response.error,
                scope.workflow_run_id,
                scope.node_id,
                scope.agent_id,
                response.run_id,
            )
            return

        self._session_store.mark_cleaned(scope=scope, backend_run_id=response.run_id)


def build_workflow_agent_session_cleanup_layer() -> WorkflowAgentSessionCleanupLayer:
    """Wire the cleanup layer with the standard production dependencies.

    The agent backend client is constructed only when ``AGENT_BACKEND_BASE_URL``
    is configured (or the deterministic fake is explicitly enabled). When
    neither is set — for example unit tests that bring up the workflow runner
    without an Agent node — we pass ``None`` so the layer stays harmless. With
    ``_HTTP_CLEANUP_SUPPORTED = False`` the local-retire branch never touches
    the client anyway, but keeping it ``None`` avoids importing httpx and lets
    test harnesses skip backend configuration.
    """
    agent_backend_client: AgentBackendRunClient | None
    if dify_config.AGENT_BACKEND_USE_FAKE or dify_config.AGENT_BACKEND_BASE_URL:
        agent_backend_client = create_agent_backend_run_client(
            base_url=dify_config.AGENT_BACKEND_BASE_URL,
            use_fake=dify_config.AGENT_BACKEND_USE_FAKE,
            fake_scenario=dify_config.AGENT_BACKEND_FAKE_SCENARIO,
        )
    else:
        agent_backend_client = None

    return WorkflowAgentSessionCleanupLayer(
        session_store=WorkflowAgentRuntimeSessionStore(),
        request_builder=AgentBackendRunRequestBuilder(),
        agent_backend_client=agent_backend_client,
    )
