from __future__ import annotations

import logging
from collections.abc import Generator, Mapping, Sequence
from typing import TYPE_CHECKING, Any, cast, override

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
    AgentBackendRunWaitingInternalEvent,
    AgentBackendStreamError,
    AgentBackendStreamInternalEvent,
    AgentBackendTransportError,
    AgentBackendValidationError,
)
from core.app.entities.app_invoke_entities import DIFY_RUN_CONTEXT_KEY, DifyRunContext
from core.workflow.nodes.agent_v2.entities import DifyAgentNodeData
from core.workflow.nodes.agent_v2.output_adapter import WorkflowAgentOutputAdapter
from core.workflow.nodes.agent_v2.output_failure_orchestrator import (
    FailedOutput,
    OutputFailureDecision,
    OutputFailureKind,
    OutputFailureOrchestrator,
)
from core.workflow.nodes.agent_v2.output_type_checker import OutputTypeCheckOutcome, PerOutputTypeChecker
from core.workflow.nodes.agent_v2.runtime_request_builder import (
    WorkflowAgentRuntimeBuildContext,
    WorkflowAgentRuntimeRequestBuilder,
    WorkflowAgentRuntimeRequestBuildError,
)
from core.workflow.nodes.agent_v2.session_store import WorkflowAgentSessionScope, WorkflowAgentWorkspaceStore
from core.workflow.system_variables import SystemVariableKey, get_system_text
from graphon.engine_events import NodeRunPauseRequestedEvent
from graphon.entities.pause_reason import SchedulingPause
from graphon.enums import (
    BuiltinNodeTypes,
    ErrorStrategy,
    NodeExecutionType,
    WorkflowNodeExecutionMetadataKey,
    WorkflowNodeExecutionStatus,
)
from graphon.node_events import NodeEventPayload, NodeRunResult, StreamChunkEvent, StreamCompletedEvent
from graphon.nodes.base.node import Node
from graphon.nodes.base.variable_template_parser import VariableTemplateParser
from models.agent_config_entities import WorkflowNodeJobConfig, WorkflowOutputRoutes
from services.agent.prompt_mentions import extract_workflow_node_output_selectors
from services.agent.workspace_service import AgentWorkspaceNotFoundError
from services.workflow_runtime.agent_binding import WorkflowAgentBindingError, WorkflowAgentBindingResolver

if TYPE_CHECKING:
    from graphon.runtime import InitParams, RuntimeState
    from services.agent.workflow_run_recovery import AgentCreateRecoveryClient, WorkflowAgentRunRecovery
    from services.dify_builder.native_testing.agent_preparation import AgentPreparationService
    from services.dify_builder.native_testing.confirmed_agent_commands import ConfirmedAgentCommands

logger = logging.getLogger(__name__)


# Terminal and waiting controls that `_consume_event_stream` may return.
# Stream + started events are filtered out (plain-run text deltas are yielded
# as stream chunks instead); transport errors
# are surfaced as a separate StreamCompletedEvent in the second tuple slot.
type _TerminalAgentBackendEvent = (
    AgentBackendRunSucceededInternalEvent
    | AgentBackendRunFailedInternalEvent
    | AgentBackendRunCancelledInternalEvent
    | AgentBackendRunWaitingInternalEvent
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
        agent_preparation: AgentPreparationService | None = None,
        agent_commands: ConfirmedAgentCommands | None = None,
        agent_run_recovery: WorkflowAgentRunRecovery | None = None,
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
        self._agent_preparation = agent_preparation
        self._agent_commands = agent_commands
        self._agent_run_recovery = agent_run_recovery

    @override
    def _get_error_strategy(self) -> ErrorStrategy | None:
        context = DifyRunContext.model_validate(self.require_run_context_value(DIFY_RUN_CONTEXT_KEY))
        # Confirmed control failures cannot become default output or an alternate branch.
        if context.builder_agent_execution is not None:
            return None
        return super()._get_error_strategy()

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
        from runtime_contracts.builder.execution import BuilderExecutionPolicyError
        from services.dify_builder.native_testing.agent_binding import AgentSnapshotChanged

        dify_ctx = DifyRunContext.model_validate(self.require_run_context_value(DIFY_RUN_CONTEXT_KEY))
        confirmed = dify_ctx.builder_agent_execution
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
        if confirmed is not None and (
            workflow_run_id != confirmed.native_run_id
            or conversation_id is not None
            or dify_ctx.invoke_from.value != "debugger"
            or dify_ctx.user_from.value != "account"
            or dify_ctx.builder_execution is not None
            or dify_ctx.native_test_required
            or dify_ctx.native_test_ref is not None
            or self._agent_preparation is None
            or self._agent_commands is None
            or self._agent_run_recovery is None
        ):
            raise BuilderExecutionPolicyError("native_agent_owner_mismatch")

        # ──── Setup: resolve binding once + extract declared outputs for stage 4 checks ────
        try:
            builder_resolution: dict[str, Any] = {}
            # The ordinary Builder Test Run always supplies this server-owned
            # map, including {} for Agent-only graphs. Ordinary runs leave it
            # None. Recheck its graph selection at the actual Agent boundary.
            if dify_ctx.builder_tool_credential_bindings is not None:
                from core.dify_builder.models import Actor
                from services.dify_builder.native_testing.agent_binding import authorize_graph_agent_selection

                nodes = [
                    node
                    for node in self.init_params.graph_config.get("nodes", [])
                    if isinstance(node, Mapping) and node.get("id") == self._node_id
                ]
                if len(nodes) != 1 or not isinstance(nodes[0].get("data"), Mapping):
                    raise BuilderExecutionPolicyError("agent_binding_not_prepared")
                actor = Actor(tenant_id=dify_ctx.tenant_id, account_id=dify_ctx.user_id)
                selection = authorize_graph_agent_selection(
                    actor=actor, app_id=dify_ctx.app_id, node_data=nodes[0]["data"]
                )
                builder_resolution = {
                    "builder_actor": actor,
                    "builder_authorization": selection.authorization,
                    "selected_agent_id": selection.agent_id,
                    "selected_snapshot_id": selection.snapshot_id,
                }
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
                **builder_resolution,
            )
        except (AgentSnapshotChanged, BuilderExecutionPolicyError) as error:
            yield self._failure_event(
                inputs=inputs,
                process_data=process_data,
                metadata=metadata,
                error=str(error),
                error_type="agent_snapshot_changed" if isinstance(error, AgentSnapshotChanged) else error.reason_code,
            )
            return
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
            parent_node = None
            after = None
            runtime_request = None
            create_response = None
            try:
                if confirmed is not None:
                    from services.agent.workflow_run_recovery import AgentCreateAcknowledgementUnknown

                    try:
                        create_response, parent_node, after = self._start_or_resume_confirmed(
                            dify_context=dify_ctx,
                            session_scope=session_scope,
                            stored_session=stored_session,
                            process_data=process_data,
                        )
                    except AgentCreateAcknowledgementUnknown:
                        yield self._control_pause(inputs, process_data, metadata, "agent_create_ack_unknown")
                        return
                    except BuilderExecutionPolicyError as error:
                        if error.reason_code == "native_agent_continuation_unknown":
                            yield self._control_pause(inputs, process_data, metadata, error.reason_code)
                            return
                        raise
                    inputs["agent_backend_request"] = {"execution_mode": "builder_test", "profile": "confirmed"}
                    metadata["attempt"] = 0
                    metadata["agent_backend"] = {"run_id": create_response.run_id, "status": create_response.status}
                else:
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
            if confirmed is None:
                assert runtime_request is not None
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

            assert create_response is not None
            metadata["agent_backend"] = {
                **dict(metadata.get("agent_backend") or {}),
                "run_id": create_response.run_id,
                "status": create_response.status,
            }

            terminal_event, exhausted = yield from self._consume_event_stream(
                create_response.run_id,
                inputs=inputs,
                process_data=process_data,
                metadata=metadata,
                stream_text=not custom_outputs
                and not node_job.output_routes.enabled
                and self.error_strategy != ErrorStrategy.DEFAULT_VALUE,
                after=after,
            )
            if isinstance(terminal_event, AgentBackendRunWaitingInternalEvent):
                if confirmed is None or parent_node is None:
                    yield self._failure_event(
                        inputs=inputs,
                        process_data=process_data,
                        metadata=metadata,
                        error="Agent wait has no confirmed owner",
                        error_type="agent_wait_unsupported",
                    )
                    return
                try:
                    if terminal_event.run_id != create_response.run_id or terminal_event.source_event_id is None:
                        raise BuilderExecutionPolicyError("native_agent_checkpoint_unavailable")
                    assert self._agent_commands is not None
                    wait = self._agent_commands.prepare_wait(
                        ref=confirmed.ref,
                        parent_node=parent_node,
                        agent_generation=terminal_event.generation,
                        backend_wait_event_id=terminal_event.source_event_id,
                    )
                    process_data["agent_wait"] = wait.model_dump(mode="json")
                except BuilderExecutionPolicyError:
                    yield self._control_pause(inputs, process_data, metadata, "native_agent_wait_unverified")
                    return
                yield self._control_pause(inputs, process_data, metadata, "agent_tool_approval")
                return
            if (
                confirmed is not None
                and not self._is_graph_aborted()
                and (exhausted is not None or terminal_event is None)
            ):
                yield self._control_pause(inputs, process_data, metadata, "agent_stream_ack_unknown")
                return
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
                        if confirmed is not None:
                            yield self._failure_event(
                                inputs=inputs,
                                process_data=process_data,
                                metadata=metadata,
                                error="Confirmed Agent output validation cannot create another child automatically.",
                                error_type="native_agent_output_retry_unavailable",
                            )
                            return
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

    def _start_or_resume_confirmed(self, *, dify_context, session_scope, stored_session, process_data):
        from runtime_contracts.builder.execution import BuilderExecutionPolicyError, canonical_digest
        from runtime_contracts.builder.native.agent_contracts import AgentCreateInserted, AgentParentNodeRef
        from services.agent.workflow_run_recovery import AgentCreateAcknowledgementUnknown, AgentCreateScope
        from services.dify_builder.native_testing.agent_confirmed_workspace import (
            load_confirmed_agent_parent,
            prepare_confirmed_agent_request,
        )

        marker = dify_context.builder_agent_execution
        assert marker is not None
        assert self._agent_preparation is not None
        assert self._agent_commands is not None
        assert self._agent_run_recovery is not None
        scope = AgentCreateScope(
            tenant_id=session_scope.tenant_id,
            app_id=session_scope.app_id,
            workflow_id=session_scope.workflow_id,
            workflow_run_id=session_scope.workflow_run_id,
            node_id=self._node_id,
            execution_id=self.execution_id,
            workflow_binding_id=session_scope.workflow_agent_binding_id,
        )
        parent = load_confirmed_agent_parent(
            service=self._agent_preparation, ref=marker.ref, execution_id=self.execution_id
        )
        response = self._agent_run_recovery.recover_existing(
            scope=scope,
            client=cast("AgentCreateRecoveryClient", self._agent_backend_client),
            on_persisted=process_data.update,
        )
        if parent is not None:
            if response is None:
                # A previously prepared occurrence cannot acquire first-POST
                # authority merely because another process stopped before ACK.
                raise AgentCreateAcknowledgementUnknown("Agent create acknowledgement is unknown")
            protected = self._agent_commands.load_wait(ref=marker.ref, parent_node=parent)
            if protected is not None:
                if protected.association.agent_run_id != response.run_id:
                    raise BuilderExecutionPolicyError("native_agent_owner_mismatch")
                continued = self._agent_commands.continue_wait(ref=marker.ref, parent_node=parent)
                if continued.association.agent_run_id != response.run_id or continued.wait is None:
                    raise BuilderExecutionPolicyError("native_agent_owner_mismatch")
                return response, parent, continued.wait.backend_wait_event_id
            return response, parent, None
        if response is not None:
            raise BuilderExecutionPolicyError("native_agent_input_unavailable")
        context = self._agent_preparation.state_store.load_context(ref=marker.ref)
        builder = self._agent_preparation.config_builder
        if builder is None:
            raise BuilderExecutionPolicyError("native_agent_preparation_unavailable")
        definition = builder.load_definition(context=context, node_id=self._node_id)
        typed_inputs = builder.typed_inputs(
            runtime_state=self.runtime_state,
            definition=definition,
        )
        input_ref = self._agent_preparation.state_store.store_node_inputs(
            ref=marker.ref,
            generation=context.generation,
            native_execution_id=self.execution_id,
            inputs=typed_inputs,
        )
        parent = AgentParentNodeRef(
            ref=marker.ref,
            execution_id=self.execution_id,
            input_result_ref=input_ref,
            input_digest=canonical_digest(typed_inputs),
        )
        prepared = prepare_confirmed_agent_request(
            service=self._agent_preparation,
            ref=marker.ref,
            parent_node=parent,
            node_id=self._node_id,
            stored_session=stored_session,
            inputs=typed_inputs,
        )
        if not isinstance(prepared.claim, AgentCreateInserted):
            raise AgentCreateAcknowledgementUnknown("Agent create acknowledgement is unknown")
        response = self._agent_run_recovery.start_or_recover(
            scope=scope,
            attempt=0,
            request=prepared.request,
            client=cast("AgentCreateRecoveryClient", self._agent_backend_client),
            on_persisted=process_data.update,
        )
        return response, parent, None

    def _control_pause(self, inputs, process_data, metadata, reason):
        metadata["agent_backend"] = {**dict(metadata.get("agent_backend") or {}), "status": reason}
        return NodeRunPauseRequestedEvent(
            id=self.execution_id,
            node_id=self._node_id,
            node_type=self.node_type,
            node_version=self.version(),
            reason=SchedulingPause(message=reason),
            node_run_result=NodeRunResult(
                status=WorkflowNodeExecutionStatus.PAUSED,
                inputs=inputs,
                process_data=process_data,
                outputs={},
                metadata={WorkflowNodeExecutionMetadataKey.AGENT_LOG: metadata},
            ),
        )

    def _consume_event_stream(
        self,
        run_id: str,
        *,
        inputs: dict[str, Any],
        process_data: dict[str, Any],
        metadata: dict[str, Any],
        stream_text: bool,
        after: str | None = None,
    ) -> Generator[
        StreamChunkEvent,
        None,
        tuple[_TerminalAgentBackendEvent | None, StreamCompletedEvent | None],
    ]:
        """Consume the SSE stream for one Agent backend run.

        When ``stream_text`` is set (plain runs whose final string becomes the
        ``text`` output), agent-message deltas are yielded as ``text`` stream
        chunks so Answer nodes can stream them. The stream is closed only after
        at least one chunk was sent; otherwise the response coordinator falls
        back to the final ``text`` variable. Structured runs keep deltas as
        metadata because their ``text`` comes from the structured output.
        Plain runs with the default-value error strategy stay buffered too:
        once a selector has stream chunks, the response filter no longer reads
        the variable pool, so a configured fallback ``text`` would be dropped
        after a partial stream.

        Returns a 2-tuple ``(terminal_event, transport_failure)``:
        - ``terminal_event``: the first non-stream/non-started internal event,
          or ``None`` if the stream ended without one.
        - ``transport_failure``: a populated ``StreamCompletedEvent`` when the
          stream itself errored (backend/HTTP/protocol fault). A cancellation
          terminal may accompany it so the caller can persist the final session
          snapshot while preserving the original transport failure.
        """
        result = yield from self._read_event_stream(
            run_id,
            inputs=inputs,
            process_data=process_data,
            metadata=metadata,
            stream_text=stream_text,
            after=after,
        )
        if (
            not isinstance(result[0], AgentBackendRunWaitingInternalEvent)
            and stream_text
            and (metadata.get("agent_backend") or {}).get("agent_message_delta_count")
        ):
            yield StreamChunkEvent(selector=[self._node_id, "text"], chunk="", is_final=True)
        return result

    def _read_event_stream(
        self,
        run_id: str,
        *,
        inputs: dict[str, Any],
        process_data: dict[str, Any],
        metadata: dict[str, Any],
        stream_text: bool,
        after: str | None = None,
    ) -> Generator[
        StreamChunkEvent,
        None,
        tuple[_TerminalAgentBackendEvent | None, StreamCompletedEvent | None],
    ]:
        stream_event_count = 0
        last_event_id: str | None = None
        confirmed = (
            DifyRunContext.model_validate(self.require_run_context_value(DIFY_RUN_CONTEXT_KEY)).builder_agent_execution
            is not None
        )
        try:
            for public_event in self._agent_backend_client.stream_events(
                run_id,
                should_stop=self._is_graph_aborted,
                **({"after": after} if after is not None else {}),
            ):
                stream_event_count += 1
                if public_event.id is not None:
                    last_event_id = public_event.id
                for internal_event in self._event_adapter.adapt(public_event):
                    if internal_event.type in (
                        AgentBackendInternalEventType.RUN_STARTED,
                        AgentBackendInternalEventType.RUN_RESUMED,
                    ):
                        continue
                    if internal_event.type == AgentBackendInternalEventType.STREAM_EVENT:
                        if isinstance(internal_event, AgentBackendStreamInternalEvent):
                            self._record_stream_metadata(metadata, internal_event)
                        continue
                    if internal_event.type == AgentBackendInternalEventType.AGENT_MESSAGE_DELTA:
                        if isinstance(internal_event, AgentBackendAgentMessageDeltaInternalEvent):
                            self._record_agent_message_delta_metadata(metadata, internal_event)
                            if stream_text:
                                yield StreamChunkEvent(
                                    selector=[self._node_id, "text"],
                                    chunk=internal_event.delta,
                                    is_final=False,
                                )
                        continue
                    metadata["agent_backend"] = {
                        **dict(metadata.get("agent_backend") or {}),
                        "stream_event_count": stream_event_count,
                    }
                    # Known waiting is control only on the explicit confirmed path.
                    if isinstance(internal_event, AgentBackendRunWaitingInternalEvent) and confirmed:
                        return internal_event, None
                    if isinstance(
                        internal_event,
                        AgentBackendRunSucceededInternalEvent
                        | AgentBackendRunFailedInternalEvent
                        | AgentBackendRunCancelledInternalEvent,
                    ):
                        return internal_event, None
                    cancellation = (
                        None
                        if confirmed
                        else self._cancel_backend_run(
                            run_id,
                            reason="unexpected_event",
                            after=last_event_id,
                        )
                    )
                    return cancellation, self._failure_event(
                        inputs=inputs,
                        process_data=process_data,
                        metadata=metadata,
                        error=f"Unexpected internal event type {internal_event.type!r}",
                        error_type="agent_backend_stream_error",
                    )
        except AgentBackendError as error:
            cancellation = (
                None
                if confirmed and not self._is_graph_aborted()
                else self._cancel_backend_run(
                    run_id,
                    reason=self._stream_stop_reason(),
                    after=last_event_id,
                )
            )
            return cancellation, self._failure_event(
                inputs=inputs,
                process_data=process_data,
                metadata=metadata,
                error=str(error),
                error_type=self._agent_backend_error_type(error),
            )
        except Exception as error:
            cancellation = (
                None
                if confirmed and not self._is_graph_aborted()
                else self._cancel_backend_run(
                    run_id,
                    reason=self._stream_stop_reason(),
                    after=last_event_id,
                )
            )
            return cancellation, self._failure_event(
                inputs=inputs,
                process_data=process_data,
                metadata=metadata,
                error=str(error),
                error_type="agent_backend_stream_error",
            )

        cancellation = (
            None
            if confirmed and not self._is_graph_aborted()
            else self._cancel_backend_run(
                run_id,
                reason=self._stream_stop_reason()
                if self._is_graph_aborted()
                else "stream_ended_without_terminal_event",
                after=last_event_id,
            )
        )
        return cancellation, None

    def _is_graph_aborted(self) -> bool:
        """Let Agent SSE consumption observe Engine's cooperative abort state."""
        return self.runtime_state.graph_execution.aborted

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
