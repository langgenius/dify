from __future__ import annotations

import logging
from collections.abc import Generator, Mapping, Sequence
from typing import TYPE_CHECKING, Any

from agenton.compositor import CompositorSessionSnapshot

from clients.agent_backend import (
    AgentBackendError,
    AgentBackendHTTPError,
    AgentBackendInternalEventType,
    AgentBackendRunCancelledInternalEvent,
    AgentBackendRunClient,
    AgentBackendRunEventAdapter,
    AgentBackendRunFailedInternalEvent,
    AgentBackendRunPausedInternalEvent,
    AgentBackendRunSucceededInternalEvent,
    AgentBackendStreamError,
    AgentBackendStreamInternalEvent,
    AgentBackendTransportError,
    AgentBackendValidationError,
    CleanupLayerSpec,
    extract_cleanup_layer_specs,
)
from core.app.entities.app_invoke_entities import DIFY_RUN_CONTEXT_KEY, DifyRunContext
from core.workflow.system_variables import SystemVariableKey, get_system_text
from graphon.entities.pause_reason import SchedulingPause
from graphon.enums import BuiltinNodeTypes, WorkflowNodeExecutionMetadataKey, WorkflowNodeExecutionStatus
from graphon.node_events import NodeEventBase, NodeRunResult, PauseRequestedEvent, StreamCompletedEvent
from graphon.nodes.base.node import Node
from models.agent_config_entities import WorkflowNodeJobConfig

from .binding_resolver import WorkflowAgentBindingError, WorkflowAgentBindingResolver
from .entities import DifyAgentNodeData
from .output_adapter import WorkflowAgentOutputAdapter
from .output_failure_orchestrator import (
    FailedOutput,
    OutputFailureDecision,
    OutputFailureKind,
    OutputFailureOrchestrator,
)
from .output_type_checker import OutputTypeCheckOutcome, PerOutputTypeChecker
from .runtime_request_builder import (
    WorkflowAgentRuntimeBuildContext,
    WorkflowAgentRuntimeRequestBuilder,
    WorkflowAgentRuntimeRequestBuildError,
)
from .session_store import WorkflowAgentRuntimeSessionStore, WorkflowAgentSessionScope

if TYPE_CHECKING:
    from graphon.entities import GraphInitParams
    from graphon.runtime import GraphRuntimeState

logger = logging.getLogger(__name__)


# Stage 4 §5+§7: the terminal events that `_consume_event_stream` may return.
# Stream + started events are filtered out before we yield; transport errors
# are surfaced as a separate StreamCompletedEvent in the second tuple slot.
_TerminalAgentBackendEvent = (
    AgentBackendRunSucceededInternalEvent
    | AgentBackendRunFailedInternalEvent
    | AgentBackendRunCancelledInternalEvent
    | AgentBackendRunPausedInternalEvent
)


class DifyAgentNode(Node[DifyAgentNodeData]):
    node_type = BuiltinNodeTypes.AGENT

    def __init__(
        self,
        node_id: str,
        data: DifyAgentNodeData,
        *,
        graph_init_params: GraphInitParams,
        graph_runtime_state: GraphRuntimeState,
        binding_resolver: WorkflowAgentBindingResolver,
        runtime_request_builder: WorkflowAgentRuntimeRequestBuilder,
        agent_backend_client: AgentBackendRunClient,
        event_adapter: AgentBackendRunEventAdapter,
        output_adapter: WorkflowAgentOutputAdapter,
        type_checker: PerOutputTypeChecker,
        failure_orchestrator: OutputFailureOrchestrator,
        session_store: WorkflowAgentRuntimeSessionStore | None = None,
    ) -> None:
        super().__init__(
            node_id=node_id,
            data=data,
            graph_init_params=graph_init_params,
            graph_runtime_state=graph_runtime_state,
        )
        self._binding_resolver = binding_resolver
        self._runtime_request_builder = runtime_request_builder
        self._agent_backend_client = agent_backend_client
        self._event_adapter = event_adapter
        self._output_adapter = output_adapter
        self._type_checker = type_checker
        self._failure_orchestrator = failure_orchestrator
        self._session_store = session_store

    @classmethod
    def version(cls) -> str:
        return "2"

    def populate_start_event(self, event) -> None:
        event.extras["agent_node"] = {"version": "2", "agent_node_kind": self.node_data.agent_node_kind}

    def _run(self) -> Generator[NodeEventBase, None, None]:
        dify_ctx = DifyRunContext.model_validate(self.require_run_context_value(DIFY_RUN_CONTEXT_KEY))
        workflow_id = self.graph_init_params.workflow_id
        workflow_run_id = get_system_text(
            self.graph_runtime_state.variable_pool,
            SystemVariableKey.WORKFLOW_EXECUTION_ID,
        )
        inputs: dict[str, Any] = {}
        process_data: dict[str, Any] = {}
        metadata: dict[str, Any] = {
            "agent_backend": {
                "status": "not_started",
            }
        }

        # ──── Setup: resolve binding once + extract declared outputs for stage 4 checks ────
        try:
            bundle = self._binding_resolver.resolve(
                tenant_id=dify_ctx.tenant_id,
                app_id=dify_ctx.app_id,
                workflow_id=workflow_id,
                node_id=self._node_id,
            )
        except WorkflowAgentBindingError as error:
            yield self._failure_event(
                inputs=inputs,
                process_data=process_data,
                metadata=metadata,
                error=str(error),
                error_type=error.error_code,
            )
            return

        process_data = {
            "agent_id": bundle.agent.id,
            "agent_config_snapshot_id": bundle.snapshot.id,
            "binding_id": bundle.binding.id,
        }
        session_scope = WorkflowAgentSessionScope(
            tenant_id=dify_ctx.tenant_id,
            app_id=dify_ctx.app_id,
            workflow_id=workflow_id,
            workflow_run_id=workflow_run_id,
            node_id=self._node_id,
            node_execution_id=self.id,
            binding_id=bundle.binding.id,
            agent_id=bundle.agent.id,
            agent_config_snapshot_id=bundle.snapshot.id,
        )

        # Stage 4 §4.1 (D-3): use effective outputs so defaults flow through both
        # the backend request and the post-run type check.
        node_job = WorkflowNodeJobConfig.model_validate(bundle.binding.node_job_config_dict)
        effective_outputs = list(
            WorkflowAgentRuntimeRequestBuilder.effective_declared_outputs(list(node_job.declared_outputs))
        )
        outputs_by_name = {o.name: o for o in effective_outputs}

        # ──── Retry loop (Stage 4 §7) ────
        attempt = 0
        while True:
            try:
                session_snapshot = None
                if self._session_store is not None:
                    session_snapshot = self._session_store.load_active_snapshot(session_scope)
                runtime_request = self._runtime_request_builder.build(
                    WorkflowAgentRuntimeBuildContext(
                        dify_context=dify_ctx,
                        workflow_id=workflow_id,
                        workflow_run_id=workflow_run_id,
                        node_id=self._node_id,
                        node_execution_id=self.id,
                        variable_pool=self.graph_runtime_state.variable_pool,
                        binding=bundle.binding,
                        agent=bundle.agent,
                        snapshot=bundle.snapshot,
                        attempt=attempt,
                        session_snapshot=session_snapshot,
                    )
                )
            except WorkflowAgentRuntimeRequestBuildError as error:
                yield self._failure_event(
                    inputs=inputs,
                    process_data=process_data,
                    metadata=metadata,
                    error=str(error),
                    error_type=error.error_code,
                )
                return
            except Exception as error:
                yield self._failure_event(
                    inputs=inputs,
                    process_data=process_data,
                    metadata=metadata,
                    error=str(error),
                    error_type="agent_workflow_node_runtime_error",
                )
                return

            # Capture inputs only from the first attempt so retry doesn't churn the
            # node's "inputs" payload that ends up in the workflow detail view.
            if attempt == 0:
                inputs = {"agent_backend_request": runtime_request.redacted_request}
            metadata = dict(runtime_request.metadata)
            metadata["attempt"] = attempt

            try:
                create_response = self._agent_backend_client.create_run(runtime_request.request)
            except AgentBackendError as error:
                yield self._failure_event(
                    inputs=inputs,
                    process_data=process_data,
                    metadata=metadata,
                    error=str(error),
                    error_type=self._agent_backend_error_type(error),
                )
                return

            metadata["agent_backend"] = {
                **dict(metadata.get("agent_backend") or {}),
                "run_id": create_response.run_id,
                "status": create_response.status,
            }

            terminal_event, exhausted = self._consume_event_stream(create_response.run_id, metadata)
            if exhausted is not None:
                # Streaming error / unexpected end — surface immediately without
                # retrying because the failure is transport-level.
                yield exhausted
                return
            if terminal_event is None:
                yield StreamCompletedEvent(
                    node_run_result=self._output_adapter.build_stream_exhausted_result(
                        inputs=inputs,
                        process_data=process_data,
                        metadata=metadata,
                    )
                )
                return

            if isinstance(terminal_event, AgentBackendRunPausedInternalEvent):
                self._save_session_snapshot(
                    session_scope=session_scope,
                    backend_run_id=terminal_event.run_id,
                    snapshot=terminal_event.session_snapshot,
                    composition_layer_specs=extract_cleanup_layer_specs(runtime_request.request.composition),
                    metadata=metadata,
                )
                yield PauseRequestedEvent(
                    reason=SchedulingPause(
                        message=terminal_event.message
                        or "Agent backend run requested workflow pause for external input."
                    )
                )
                return

            # Non-success terminal (failed / cancelled) skips per-output
            # post-processing — the backend itself already failed. We also retire
            # the local ACTIVE session row so a workflow loop back into the same
            # Agent node cannot resume from a stale snapshot. The failed agent
            # backend layers (suspended per ``on_exit``) are left for agent
            # backend's own GC; this row will no longer be picked up by the
            # workflow-terminal cleanup layer.
            if not isinstance(terminal_event, AgentBackendRunSucceededInternalEvent):
                self._mark_session_cleaned_on_failure(
                    session_scope=session_scope,
                    backend_run_id=terminal_event.run_id,
                    metadata=metadata,
                )
                yield StreamCompletedEvent(
                    node_run_result=self._output_adapter.build_failure_result(
                        event=terminal_event,
                        inputs=inputs,
                        process_data=process_data,
                        metadata=metadata,
                    )
                )
                return

            self._save_session_snapshot(
                session_scope=session_scope,
                backend_run_id=terminal_event.run_id,
                snapshot=terminal_event.session_snapshot,
                composition_layer_specs=extract_cleanup_layer_specs(runtime_request.request.composition),
                metadata=metadata,
            )

            # ──── Stage 4: per-output type check ────
            type_check = self._type_checker.check(
                declared_outputs=effective_outputs,
                raw_output=terminal_event.output,
                tenant_id=dify_ctx.tenant_id,
            )
            self._record_type_check_metadata(metadata, type_check)

            if not type_check.has_failures:
                yield StreamCompletedEvent(
                    node_run_result=self._output_adapter.build_success_result(
                        event=terminal_event,
                        inputs=inputs,
                        process_data=process_data,
                        metadata=metadata,
                    )
                )
                return

            # ──── Stage 4: orchestrate retry / default / fail ────
            failures = [
                FailedOutput(
                    declared=outputs_by_name[result.name],
                    failure_kind=OutputFailureKind.TYPE_CHECK,
                    reason=result.reason,
                )
                for result in type_check.failures
                if result.name in outputs_by_name
            ]
            outcome = self._failure_orchestrator.decide(failures=failures, current_attempt=attempt)
            metadata["output_failure_decision"] = outcome.decision.value
            metadata["output_failure_reason"] = outcome.primary_reason

            if outcome.decision == OutputFailureDecision.RETRY:
                attempt = outcome.next_attempt
                continue

            if outcome.decision == OutputFailureDecision.USE_DEFAULT:
                patched_event = self._patch_event_with_defaults(terminal_event, outcome.per_output_actions)
                yield StreamCompletedEvent(
                    node_run_result=self._output_adapter.build_success_result(
                        event=patched_event,
                        inputs=inputs,
                        process_data=process_data,
                        metadata=metadata,
                    )
                )
                return

            error_type = (
                "output_type_check_failed_fail_branch"
                if outcome.decision == OutputFailureDecision.TAKE_FAIL_BRANCH
                else "output_type_check_failed"
            )
            yield self._failure_event(
                inputs=inputs,
                process_data=process_data,
                metadata=metadata,
                error=outcome.primary_reason,
                error_type=error_type,
            )
            return

    def _consume_event_stream(
        self,
        run_id: str,
        metadata: dict[str, Any],
    ) -> tuple[
        _TerminalAgentBackendEvent | None,
        StreamCompletedEvent | None,
    ]:
        """Consume the SSE stream for one Agent backend run.

        Returns a 2-tuple ``(terminal_event, transport_failure)``:
        - ``terminal_event``: the first non-stream/non-started internal event,
          or ``None`` if the stream ended without one.
        - ``transport_failure``: a populated ``StreamCompletedEvent`` when the
          stream itself errored (backend/HTTP/protocol fault). Mutually
          exclusive with ``terminal_event``.
        """
        stream_event_count = 0
        try:
            for public_event in self._agent_backend_client.stream_events(run_id):
                stream_event_count += 1
                for internal_event in self._event_adapter.adapt(public_event):
                    if internal_event.type == AgentBackendInternalEventType.RUN_STARTED:
                        continue
                    if internal_event.type == AgentBackendInternalEventType.STREAM_EVENT:
                        if isinstance(internal_event, AgentBackendStreamInternalEvent):
                            self._record_stream_metadata(metadata, internal_event)
                        continue
                    metadata["agent_backend"] = {
                        **dict(metadata.get("agent_backend") or {}),
                        "stream_event_count": stream_event_count,
                    }
                    # Narrow to the 4 known terminal event types so the caller
                    # can hand the result to ``build_failure_result`` (which is
                    # typed against the union). Anything else is a protocol-
                    # level surprise we surface as a stream error.
                    if isinstance(
                        internal_event,
                        AgentBackendRunSucceededInternalEvent
                        | AgentBackendRunFailedInternalEvent
                        | AgentBackendRunCancelledInternalEvent
                        | AgentBackendRunPausedInternalEvent,
                    ):
                        return internal_event, None
                    return None, self._failure_event(
                        inputs={},
                        process_data={},
                        metadata=metadata,
                        error=f"Unexpected internal event type {internal_event.type!r}",
                        error_type="agent_backend_stream_error",
                    )
        except AgentBackendError as error:
            return None, self._failure_event(
                inputs={},
                process_data={},
                metadata=metadata,
                error=str(error),
                error_type=self._agent_backend_error_type(error),
            )
        except Exception as error:
            return None, self._failure_event(
                inputs={},
                process_data={},
                metadata=metadata,
                error=str(error),
                error_type="agent_backend_stream_error",
            )

        return None, None

    @staticmethod
    def _record_type_check_metadata(metadata: dict[str, Any], outcome: OutputTypeCheckOutcome) -> None:
        # Surface enough detail in metadata for Inspector / debug logs without
        # leaking the raw failing values (which may be sensitive).
        metadata["output_type_check"] = {
            "passed": not outcome.has_failures,
            "results": [
                {
                    "name": r.name,
                    "type": r.declared_type.value,
                    "status": r.status.value,
                    "reason": r.reason,
                }
                for r in outcome.results
            ],
        }

    def _save_session_snapshot(
        self,
        *,
        session_scope: WorkflowAgentSessionScope,
        backend_run_id: str,
        snapshot: CompositorSessionSnapshot | None,
        composition_layer_specs: list[CleanupLayerSpec],
        metadata: dict[str, Any],
    ) -> None:
        if self._session_store is None:
            return
        try:
            self._session_store.save_active_snapshot(
                scope=session_scope,
                backend_run_id=backend_run_id,
                snapshot=snapshot,
                composition_layer_specs=composition_layer_specs,
            )
            agent_backend = dict(metadata.get("agent_backend") or {})
            agent_backend["session_snapshot_persisted"] = snapshot is not None
            metadata["agent_backend"] = agent_backend
        except Exception:
            logger.warning(
                "Failed to persist workflow Agent runtime session snapshot: "
                "tenant_id=%s workflow_run_id=%s node_id=%s binding_id=%s agent_id=%s backend_run_id=%s",
                session_scope.tenant_id,
                session_scope.workflow_run_id,
                session_scope.node_id,
                session_scope.binding_id,
                session_scope.agent_id,
                backend_run_id,
                exc_info=True,
            )
            agent_backend = dict(metadata.get("agent_backend") or {})
            agent_backend["session_snapshot_persisted"] = False
            agent_backend["session_snapshot_persist_error"] = "workflow_agent_runtime_session_store_error"
            metadata["agent_backend"] = agent_backend

    def _mark_session_cleaned_on_failure(
        self,
        *,
        session_scope: WorkflowAgentSessionScope,
        backend_run_id: str,
        metadata: dict[str, Any],
    ) -> None:
        if self._session_store is None:
            return
        try:
            self._session_store.mark_cleaned(scope=session_scope, backend_run_id=backend_run_id)
            agent_backend = dict(metadata.get("agent_backend") or {})
            agent_backend["session_snapshot_cleaned_on_failure"] = True
            metadata["agent_backend"] = agent_backend
        except Exception:
            logger.warning(
                "Failed to mark workflow Agent runtime session cleaned on agent run failure: "
                "tenant_id=%s workflow_run_id=%s node_id=%s binding_id=%s agent_id=%s backend_run_id=%s",
                session_scope.tenant_id,
                session_scope.workflow_run_id,
                session_scope.node_id,
                session_scope.binding_id,
                session_scope.agent_id,
                backend_run_id,
                exc_info=True,
            )
            agent_backend = dict(metadata.get("agent_backend") or {})
            agent_backend["session_snapshot_cleaned_on_failure"] = False
            agent_backend["session_snapshot_cleanup_error"] = "workflow_agent_runtime_session_store_error"
            metadata["agent_backend"] = agent_backend

    @staticmethod
    def _patch_event_with_defaults(
        event: AgentBackendRunSucceededInternalEvent,
        per_output_actions: Mapping[str, Any],
    ) -> AgentBackendRunSucceededInternalEvent:
        """Merge USE_DEFAULT replacements into the success event's output dict.

        The event is a frozen dataclass / Pydantic model; we copy with the
        replacements applied so downstream code (output_adapter normalize) sees
        the patched payload.
        """
        if not per_output_actions:
            return event
        original = event.output if isinstance(event.output, Mapping) else {}
        patched_output: dict[str, Any] = dict(original)
        patched_output.update(per_output_actions)
        return event.model_copy(update={"output": patched_output})

    @staticmethod
    def _failure_event(
        *,
        inputs: dict[str, Any],
        process_data: dict[str, Any],
        metadata: dict[str, Any],
        error: str,
        error_type: str,
    ) -> StreamCompletedEvent:
        return StreamCompletedEvent(
            node_run_result=NodeRunResult(
                status=WorkflowNodeExecutionStatus.FAILED,
                inputs=inputs,
                process_data=process_data,
                metadata={WorkflowNodeExecutionMetadataKey.AGENT_LOG: metadata},
                outputs={},
                error=error,
                error_type=error_type,
            )
        )

    @staticmethod
    def _agent_backend_error_type(error: AgentBackendError) -> str:
        if isinstance(error, AgentBackendValidationError):
            return "agent_backend_validation_error"
        if isinstance(error, AgentBackendHTTPError):
            return "agent_backend_http_error"
        if isinstance(error, AgentBackendStreamError):
            return "agent_backend_stream_error"
        if isinstance(error, AgentBackendTransportError):
            return "agent_backend_transport_error"
        return "agent_backend_error"

    @staticmethod
    def _record_stream_metadata(metadata: dict[str, Any], event: AgentBackendStreamInternalEvent) -> None:
        agent_backend = dict(metadata.get("agent_backend") or {})
        agent_backend["last_stream_event_id"] = event.source_event_id
        if event.event_kind:
            agent_backend["last_stream_event_kind"] = event.event_kind
        if isinstance(event.data, Mapping):
            usage = event.data.get("usage") or event.data.get("model_usage")
            if isinstance(usage, Mapping):
                agent_backend["usage"] = dict(usage)
        metadata["agent_backend"] = agent_backend

    @classmethod
    def _extract_variable_selector_to_variable_mapping(
        cls,
        *,
        graph_config: Mapping[str, Any],
        node_id: str,
        node_data: DifyAgentNodeData,
    ) -> Mapping[str, Sequence[str]]:
        del graph_config, node_id, node_data
        return {}
