from __future__ import annotations

import logging
from collections.abc import Generator, Mapping, Sequence
from typing import TYPE_CHECKING, Any, override

from dify_agent.protocol import CancelRunRequest
from dify_agent.protocol.snapshot import SessionSnapshot

from clients.agent_backend import (
    AgentBackendAgentMessageDeltaInternalEvent,
    AgentBackendError,
    AgentBackendHTTPError,
    AgentBackendInternalEventType,
    AgentBackendRunCancelledInternalEvent,
    AgentBackendRunClient,
    AgentBackendRunEventAdapter,
    AgentBackendRunFailedInternalEvent,
    AgentBackendRunSucceededInternalEvent,
    AgentBackendStreamError,
    AgentBackendStreamInternalEvent,
    AgentBackendTransportError,
    AgentBackendValidationError,
)
from core.app.entities.app_invoke_entities import DIFY_RUN_CONTEXT_KEY, DifyRunContext
from core.workflow.system_variables import SystemVariableKey, get_system_text
from graphon.engine_events import NodeRunPauseRequestedEvent
from graphon.enums import (
    BuiltinNodeTypes,
    ErrorStrategy,
    NodeExecutionType,
    WorkflowNodeExecutionMetadataKey,
    WorkflowNodeExecutionStatus,
)
from graphon.node_events import NodeEventPayload, NodeRunResult, StreamCompletedEvent
from graphon.nodes.base.node import Node
from graphon.nodes.base.variable_template_parser import VariableTemplateParser
from models.agent_config_entities import WorkflowNodeJobConfig, WorkflowOutputRoutes
from services.agent.prompt_mentions import extract_workflow_node_output_selectors
from services.agent.workspace_service import AgentWorkspaceNotFoundError

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
from .session_store import WorkflowAgentSessionScope, WorkflowAgentWorkspaceStore

if TYPE_CHECKING:
    from graphon.runtime import InitParams, RuntimeState

logger = logging.getLogger(__name__)


# Stage 4 §5+§7: the terminal events that `_consume_event_stream` may return.
# Stream + started events are filtered out before we yield; transport errors
# are surfaced as a separate StreamCompletedEvent in the second tuple slot.
type _TerminalAgentBackendEvent = (
    AgentBackendRunSucceededInternalEvent | AgentBackendRunFailedInternalEvent | AgentBackendRunCancelledInternalEvent
)


class DifyAgentNode(Node[DifyAgentNodeData]):
    """Execute a frozen node job and select one workflow exit on success.

    Enabled routing selects a stable route ID through the required ``switch``
    output. Disabled routing remains executable so
    graph-owned default values can continue without a selected route; Graphon
    still promotes nodes that opt into its failure branch.
    """

    node_type = BuiltinNodeTypes.AGENT

    def __init__(
        self,
        node_id: str,
        data: DifyAgentNodeData,
        *,
        init_params: InitParams,
        runtime_state: RuntimeState,
        binding_resolver: WorkflowAgentBindingResolver,
        runtime_request_builder: WorkflowAgentRuntimeRequestBuilder,
        agent_backend_client: AgentBackendRunClient,
        event_adapter: AgentBackendRunEventAdapter,
        output_adapter: WorkflowAgentOutputAdapter,
        type_checker: PerOutputTypeChecker,
        failure_orchestrator: OutputFailureOrchestrator,
        session_store: WorkflowAgentWorkspaceStore,
    ) -> None:
        super().__init__(
            node_id=node_id,
            data=data,
            init_params=init_params,
            runtime_state=runtime_state,
        )
        if self.node_data.agent_output_routes.enabled and self.error_strategy == ErrorStrategy.DEFAULT_VALUE:
            raise ValueError("Output routes do not support the node-level default-value error strategy.")
        if self.node_data.agent_output_routes.enabled:
            self.execution_type = NodeExecutionType.BRANCH
        self._binding_resolver = binding_resolver
        self._runtime_request_builder = runtime_request_builder
        self._agent_backend_client = agent_backend_client
        self._event_adapter = event_adapter
        self._output_adapter = output_adapter
        self._type_checker = type_checker
        self._failure_orchestrator = failure_orchestrator
        self._session_store = session_store

    @classmethod
    @override
    def version(cls) -> str:
        return "2"

    @override
    def populate_start_event(self, event) -> None:
        event.extras["agent_node"] = {"version": "2", "agent_node_kind": self.node_data.agent_node_kind}

    @override
    def _run(self) -> Generator[NodeEventPayload | NodeRunPauseRequestedEvent]:
        inputs: dict[str, Any] = {}
        process_data: dict[str, Any] = {}
        metadata: dict[str, Any] = {
            "agent_backend": {
                "status": "not_started",
            }
        }
        try:
            yield from self._run_inner(inputs=inputs, process_data=process_data, metadata=metadata)
        except Exception as error:
            if not process_data:
                raise
            yield self._failure_event(
                inputs=inputs,
                process_data=process_data,
                metadata=metadata,
                error=str(error),
                error_type="agent_workflow_node_runtime_error",
            )

    def _run_inner(
        self,
        *,
        inputs: dict[str, Any],
        process_data: dict[str, Any],
        metadata: dict[str, Any],
    ) -> Generator[NodeEventPayload | NodeRunPauseRequestedEvent]:
        dify_ctx = DifyRunContext.model_validate(self.require_run_context_value(DIFY_RUN_CONTEXT_KEY))
        workflow_id = self.init_params.workflow_id
        workflow_run_id = get_system_text(
            self.runtime_state.variable_pool,
            SystemVariableKey.WORKFLOW_EXECUTION_ID,
        )
        # Chatflow sessions also carry their owning conversation.
        conversation_id = get_system_text(
            self.runtime_state.variable_pool,
            SystemVariableKey.CONVERSATION_ID,
        )

        # ──── Setup: resolve binding once + extract declared outputs for stage 4 checks ────
        try:
            existing_scope = self._session_store.load_existing_node_execution_scope(
                tenant_id=dify_ctx.tenant_id,
                app_id=dify_ctx.app_id,
                workflow_id=workflow_id,
                workflow_run_id=workflow_run_id,
                node_id=self._node_id,
                node_execution_id=self.execution_id,
                conversation_id=conversation_id,
            )
            bundle = self._binding_resolver.resolve(
                tenant_id=dify_ctx.tenant_id,
                app_id=dify_ctx.app_id,
                workflow_id=workflow_id,
                node_id=self._node_id,
                binding_id=existing_scope.workflow_agent_binding_id if existing_scope is not None else None,
                snapshot_id=existing_scope.agent_config_snapshot_id if existing_scope is not None else None,
                conversation_id=conversation_id,
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
        except AgentWorkspaceNotFoundError as error:
            yield self._failure_event(
                inputs=inputs,
                process_data=process_data,
                metadata=metadata,
                error=str(error),
                error_type="agent_workflow_node_runtime_error",
            )
            return

        process_data.update(
            {
                "agent_id": bundle.agent.id,
                "agent_config_snapshot_id": bundle.snapshot.id,
                "workflow_agent_binding_id": bundle.binding.id,
            }
        )
        session_scope = existing_scope or WorkflowAgentSessionScope(
            tenant_id=dify_ctx.tenant_id,
            app_id=dify_ctx.app_id,
            workflow_id=workflow_id,
            workflow_run_id=workflow_run_id,
            node_id=self._node_id,
            node_execution_id=self.execution_id,
            workflow_agent_binding_id=bundle.binding.id,
            agent_id=bundle.agent.id,
            agent_config_snapshot_id=bundle.snapshot.id,
            conversation_id=conversation_id,
        )

        node_job = WorkflowNodeJobConfig.model_validate(bundle.binding.node_job_config_dict)
        node_job.output_routes.validate_for_execution()
        custom_outputs = list(node_job.declared_outputs)
        outputs_by_name = {output.name: output for output in custom_outputs}

        stored_session = self._session_store.load_or_create_node_execution_session(
            session_scope,
            home_snapshot_id=bundle.snapshot.home_snapshot_id,
        )
        # ──── Retry loop (Stage 4 §7) ────
        attempt = 0
        while True:
            try:
                runtime_request = self._runtime_request_builder.build(
                    WorkflowAgentRuntimeBuildContext(
                        dify_context=dify_ctx,
                        workflow_id=workflow_id,
                        workflow_run_id=workflow_run_id,
                        node_id=self._node_id,
                        node_execution_id=self.execution_id,
                        variable_pool=self.runtime_state.variable_pool,
                        binding=bundle.binding,
                        agent=bundle.agent,
                        snapshot=bundle.snapshot,
                        binding_id=stored_session.binding_id,
                        backend_binding_ref=stored_session.backend_binding_ref,
                        attempt=attempt,
                        session_snapshot=stored_session.session_snapshot,
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
                inputs["agent_backend_request"] = runtime_request.redacted_request
            metadata.clear()
            metadata.update(runtime_request.metadata)
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

            terminal_event, exhausted = self._consume_event_stream(
                create_response.run_id,
                inputs=inputs,
                process_data=process_data,
                metadata=metadata,
            )
            # None means no post-exit snapshot was produced; leave the previously stored session snapshot untouched.
            if (
                isinstance(terminal_event, AgentBackendRunFailedInternalEvent | AgentBackendRunCancelledInternalEvent)
                and terminal_event.session_snapshot is not None
            ):
                self._save_session_snapshot(
                    session_scope=session_scope,
                    binding_id=stored_session.binding_id,
                    snapshot=terminal_event.session_snapshot,
                    metadata=metadata,
                )
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

            # A failed attempt does not retire the product-owned Binding. The
            # Workflow Run terminal lifecycle event owns that transition.
            if not isinstance(terminal_event, AgentBackendRunSucceededInternalEvent):
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
                binding_id=stored_session.binding_id,
                snapshot=terminal_event.session_snapshot,
                metadata=metadata,
            )

            success_event = terminal_event
            if custom_outputs:
                # ──── Stage 4: per-output type check ────
                type_check = self._type_checker.check(
                    declared_outputs=custom_outputs,
                    raw_output=terminal_event.output,
                    tenant_id=dify_ctx.tenant_id,
                )
                self._record_type_check_metadata(metadata, type_check)

                if type_check.has_failures:
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
                        success_event = self._patch_event_with_defaults(terminal_event, outcome.per_output_actions)
                    else:
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

            # Select only after this attempt's custom outputs have passed. Failed
            # route output uses the node's normal retry / failure-branch handling.
            routes = node_job.output_routes
            edge_source_handle = "source"
            if routes.enabled:
                selected = success_event.output.get("switch") if isinstance(success_event.output, dict) else None
                if not isinstance(selected, str) or selected not in {route.id for route in routes.routes}:
                    yield self._failure_event(
                        inputs=inputs,
                        process_data=process_data,
                        metadata=metadata,
                        error="Agent output switch must select one configured output route ID.",
                        error_type="output_route_selection_failed",
                    )
                    return
                edge_source_handle = selected

            yield StreamCompletedEvent(
                node_run_result=self._output_adapter.build_success_result(
                    event=success_event,
                    edge_source_handle=edge_source_handle,
                    inputs=inputs,
                    process_data=process_data,
                    metadata=metadata,
                    declared_outputs=custom_outputs,
                )
            )
            return

    def _consume_event_stream(
        self,
        run_id: str,
        *,
        inputs: dict[str, Any],
        process_data: dict[str, Any],
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
          stream itself errored (backend/HTTP/protocol fault). A cancellation
          terminal may accompany it so the caller can persist the final session
          snapshot while preserving the original transport failure.
        """
        stream_event_count = 0
        last_event_id: str | None = None
        try:
            for public_event in self._agent_backend_client.stream_events(
                run_id,
                should_stop=self._is_graph_aborted,
            ):
                stream_event_count += 1
                if public_event.id is not None:
                    last_event_id = public_event.id
                for internal_event in self._event_adapter.adapt(public_event):
                    if internal_event.type == AgentBackendInternalEventType.RUN_STARTED:
                        continue
                    if internal_event.type == AgentBackendInternalEventType.STREAM_EVENT:
                        if isinstance(internal_event, AgentBackendStreamInternalEvent):
                            self._record_stream_metadata(metadata, internal_event)
                        continue
                    if internal_event.type == AgentBackendInternalEventType.AGENT_MESSAGE_DELTA:
                        if isinstance(internal_event, AgentBackendAgentMessageDeltaInternalEvent):
                            self._record_agent_message_delta_metadata(metadata, internal_event)
                        continue
                    metadata["agent_backend"] = {
                        **dict(metadata.get("agent_backend") or {}),
                        "stream_event_count": stream_event_count,
                    }
                    # Narrow to known terminal event types before returning to the caller.
                    if isinstance(
                        internal_event,
                        AgentBackendRunSucceededInternalEvent
                        | AgentBackendRunFailedInternalEvent
                        | AgentBackendRunCancelledInternalEvent,
                    ):
                        return internal_event, None
                    cancellation = self._cancel_backend_run(
                        run_id,
                        reason="unexpected_event",
                        after=last_event_id,
                    )
                    return cancellation, self._failure_event(
                        inputs=inputs,
                        process_data=process_data,
                        metadata=metadata,
                        error=f"Unexpected internal event type {internal_event.type!r}",
                        error_type="agent_backend_stream_error",
                    )
        except AgentBackendError as error:
            cancellation = self._cancel_backend_run(
                run_id,
                reason=self._stream_stop_reason(),
                after=last_event_id,
            )
            return cancellation, self._failure_event(
                inputs=inputs,
                process_data=process_data,
                metadata=metadata,
                error=str(error),
                error_type=self._agent_backend_error_type(error),
            )
        except Exception as error:
            cancellation = self._cancel_backend_run(
                run_id,
                reason=self._stream_stop_reason(),
                after=last_event_id,
            )
            return cancellation, self._failure_event(
                inputs=inputs,
                process_data=process_data,
                metadata=metadata,
                error=str(error),
                error_type="agent_backend_stream_error",
            )

        cancellation = self._cancel_backend_run(
            run_id,
            reason=self._stream_stop_reason() if self._is_graph_aborted() else "stream_ended_without_terminal_event",
            after=last_event_id,
        )
        return cancellation, None

    def _is_graph_aborted(self) -> bool:
        """Let Agent SSE consumption observe Engine's cooperative abort state."""
        try:
            return self.runtime_state.graph_execution.aborted
        except (AttributeError, RuntimeError):
            return False

    def _stream_stop_reason(self) -> str:
        return "workflow_graph_aborted" if self._is_graph_aborted() else "event_stream_failed"

    def _cancel_backend_run(
        self,
        run_id: str,
        *,
        reason: str,
        after: str | None,
    ) -> AgentBackendRunCancelledInternalEvent | None:
        try:
            public_event = self._agent_backend_client.cancel_run_and_wait(
                run_id,
                CancelRunRequest(reason=reason, message="Workflow Agent event consumption stopped"),
                after=after,
            )
            for internal_event in self._event_adapter.adapt(public_event):
                if isinstance(internal_event, AgentBackendRunCancelledInternalEvent):
                    return internal_event
        except Exception:
            logger.warning("Failed to finish cancelling Workflow Agent backend run: run_id=%s", run_id, exc_info=True)
        return None

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
        binding_id: str,
        snapshot: SessionSnapshot | None,
        metadata: dict[str, Any],
    ) -> None:
        try:
            self._session_store.save_active_snapshot(
                scope=session_scope,
                binding_id=binding_id,
                snapshot=snapshot,
            )
            agent_backend = dict(metadata.get("agent_backend") or {})
            agent_backend["session_snapshot_persisted"] = snapshot is not None
            metadata["agent_backend"] = agent_backend
        except Exception:
            logger.warning(
                "Failed to persist workflow Agent Binding session snapshot: "
                "tenant_id=%s workflow_run_id=%s node_id=%s binding_id=%s agent_id=%s",
                session_scope.tenant_id,
                session_scope.workflow_run_id,
                session_scope.node_id,
                session_scope.workflow_agent_binding_id,
                session_scope.agent_id,
                exc_info=True,
            )
            agent_backend = dict(metadata.get("agent_backend") or {})
            agent_backend["session_snapshot_persisted"] = False
            agent_backend["session_snapshot_persist_error"] = "workflow_agent_workspace_store_error"
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

    @staticmethod
    def _record_agent_message_delta_metadata(
        metadata: dict[str, Any], event: AgentBackendAgentMessageDeltaInternalEvent
    ) -> None:
        agent_backend = dict(metadata.get("agent_backend") or {})
        agent_backend["agent_message_delta_count"] = int(agent_backend.get("agent_message_delta_count") or 0) + 1
        agent_backend["agent_message_delta_length"] = int(agent_backend.get("agent_message_delta_length") or 0) + len(
            event.delta
        )
        metadata["agent_backend"] = agent_backend

    @classmethod
    @override
    def _extract_variable_selector_to_variable_mapping(
        cls,
        *,
        graph_config: Mapping[str, Any],
        node_id: str,
        node_data: DifyAgentNodeData,
    ) -> Mapping[str, Sequence[str]]:
        """Reuse frontend workflow-marker parsing for graph variable loading.

        Task mentions use the publish parser. Enabled route conditions use
        Graphon template selectors, including environment and system variables;
        disabled jobs do not load their saved conditions.
        """
        del graph_config

        if isinstance(node_data, Mapping):
            task = node_data.get("agent_task", "")
            routes = WorkflowOutputRoutes.model_validate(node_data.get("agent_output_routes", {}))
        else:
            task = node_data.agent_task
            routes = node_data.agent_output_routes
        selectors = list(extract_workflow_node_output_selectors(task))
        if routes.enabled:
            for route in routes.routes:
                selectors.extend(
                    tuple(selector.value_selector)
                    for selector in VariableTemplateParser(template=route.name).extract_variable_selectors()
                )
        return {f"{node_id}.{'.'.join(selector)}": list(selector) for selector in selectors}
