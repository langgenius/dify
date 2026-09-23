"""Coordinate persistence and publication around a prepared workflow execution."""

import logging
from collections.abc import Generator, Sequence
from contextlib import closing
from dataclasses import replace

from sqlalchemy import Engine
from sqlalchemy.orm import sessionmaker

from core.app.apps.workflow_app_runner import PreparedWorkflowRun, WorkflowBasedAppRunner
from core.app.entities.app_invoke_entities import (
    AdvancedChatAppGenerateEntity,
    RagPipelineGenerateEntity,
    WorkflowAppGenerateEntity,
)
from core.app.layers.conversation_variable_persist_layer import ConversationVariablePersistenceLayer
from core.app.layers.pause_state_persist_layer import (
    PauseStateLayerConfig,
    WorkflowResumptionContext,
    _AdvancedChatAppGenerateEntityWrapper,
    _WorkflowGenerateEntityWrapper,
)
from core.db.session_factory import session_factory
from core.repositories.factory import WorkflowExecutionRepository, WorkflowNodeExecutionRepository
from core.repositories.human_input_repository import HumanInputFormRecord, HumanInputFormSubmissionRepository
from core.tools.workflow_as_tool.repository import WorkflowToolSource
from core.workflow.node_factory import DifyNodeFactory
from core.workflow.node_runtime import DifyHumanInputNodeRuntime, resolve_dify_run_context
from core.workflow.nodes.agent_v2.workspace_retirement_layer import build_workflow_agent_workspace_retirement_layer
from core.workflow.nodes.human_input.boundary import build_human_input_pause_reason
from core.workflow.nodes.human_input.enums import HumanInputFormStatus
from core.workflow.nodes.human_input.pause_reason import PauseReason
from core.workflow.nodes.human_input.session_binding import default_session_binding
from core.workflow.system_variables import SystemVariableKey, get_system_text
from core.workflow.workflow_tool_container_types import WorkflowToolContainerPayload
from extensions.otel import WorkflowAppRunnerHandler, trace_span
from graphon.engine.layer import Layer
from graphon.engine_events import (
    EngineEvent,
    GraphRunAbortedEvent,
    GraphRunFailedEvent,
    GraphRunPartialSucceededEvent,
    GraphRunPausedEvent,
    GraphRunStartedEvent,
    GraphRunSucceededEvent,
    NodeRunHumanInputFormFilledEvent,
    NodeRunHumanInputFormTimeoutEvent,
    NodeRunStartedEvent,
)
from graphon.entities import WorkflowNodeExecution
from graphon.entities.pause_reason import HitlRequired
from graphon.enums import WorkflowExecutionStatus
from graphon.file.runtime import use_workflow_file_runtime
from graphon.runtime.container_state import CustomContainerRunState
from repositories.factory import DifyAPIRepositoryFactory
from repositories.workflow_tool_source_repository import SQLAlchemyWorkflowToolSourceRepository
from services.conversation_variable_updater import ConversationVariableUpdater
from services.workflow_persistence import PersistenceWorkflowInfo, WorkflowPersistenceLayer
from services.workflow_run_index import WorkflowRunIndex
from services.workflow_tool_source_service import WorkflowToolSourceService

logger = logging.getLogger(__name__)


class WorkflowRunAgg:
    """Own one execution attempt's persistence, form refresh, indexes, and durable pause."""

    def __init__(
        self,
        prepared: PreparedWorkflowRun,
        runner: WorkflowBasedAppRunner,
        pause_state_config: PauseStateLayerConfig | None = None,
        *,
        workflow_execution_repository: WorkflowExecutionRepository,
        workflow_node_execution_repository: WorkflowNodeExecutionRepository,
    ) -> None:
        self._workflow_execution_repository = workflow_execution_repository
        self._prepared = prepared
        self._runner = runner
        self._pause_state_config = pause_state_config
        self._entry = prepared.entry
        self._runtime_state = self._entry.graph_engine.runtime_state
        run_id = get_system_text(self._runtime_state.variable_pool, SystemVariableKey.WORKFLOW_EXECUTION_ID)
        if not run_id:
            raise ValueError("Workflow run ID is required")
        self._run_id = run_id
        self._run_context = resolve_dify_run_context(self._entry.graph_engine.graph.root_node.run_context)
        self._entry.workflow_tool_sources.update(
            WorkflowToolSourceService(SQLAlchemyWorkflowToolSourceRepository(session_factory.get_session_maker())).load(
                tenant_id=self._run_context.tenant_id,
                graph_config=self._entry.graph_config,
                allow_human_input=(
                    prepared.generate_entity.allow_human_input
                    if isinstance(prepared.generate_entity, WorkflowAppGenerateEntity)
                    else True
                ),
                suspended_tools=[
                    WorkflowToolContainerPayload.model_validate_json(run.payload)
                    for run in self._runtime_state.container_runs()
                    if isinstance(run, CustomContainerRunState)
                ],
            )
        )
        node_factory = self._entry.graph_engine.graph.node_factory
        if isinstance(node_factory, DifyNodeFactory):
            node_factory.workflow_tools.update(
                (source.tool.workflow_as_tool_id, source.tool)
                for source in self._entry.workflow_tool_sources.values()
                if source.tool is not None
            )
        self._pending_forms = {
            default_session_binding.resolve_form_id_from_session_id(session_id=reason.session_id): reason
            for reason in self._runtime_state.graph_execution.pause_reasons
            if isinstance(reason, HitlRequired)
        }
        self._published_form_ids: set[str] = set()
        self._form_repository = HumanInputFormSubmissionRepository()
        self.pause_reasons: Sequence[PauseReason] = ()
        is_resuming = self._runtime_state.graph_execution.paused
        histories = (
            workflow_node_execution_repository.get_by_workflow_execution(self._run_id, include_paused=True)
            if is_resuming
            else ()
        )
        self._persistence_layer = WorkflowPersistenceLayer(
            application_generate_entity=prepared.generate_entity,
            workflow_info=PersistenceWorkflowInfo(
                workflow_id=self._entry.graph_engine.graph.root_node.workflow_id,
                workflow_type=prepared.workflow_type,
                version=prepared.workflow_version,
                graph_data=self._entry.graph_config,
            ),
            workflow_execution_repository=workflow_execution_repository,
            workflow_node_execution_repository=workflow_node_execution_repository,
            trace_manager=prepared.generate_entity.trace_manager,
        )
        application_layers: list[Layer] = [self._persistence_layer]
        if not isinstance(prepared.generate_entity, RagPipelineGenerateEntity):
            application_layers.append(
                build_workflow_agent_workspace_retirement_layer(dify_run_context=self._run_context)
            )
        if isinstance(prepared.generate_entity, AdvancedChatAppGenerateEntity):
            application_layers.append(
                ConversationVariablePersistenceLayer(ConversationVariableUpdater(session_factory.get_session_maker()))
            )
        self._application_layers = (*application_layers, *prepared.application_layers)
        for layer in self._application_layers:
            self._entry.graph_engine.add_layer(layer)
        self.index = WorkflowRunIndex(histories)
        self._persistence_layer.set_node_run_indices(self.index.indices)
        self._persistence_layer.set_node_execution_history(histories)
        self._entry.graph_engine.add_layer(self.index)
        source_histories: dict[tuple[str, str], Sequence[WorkflowNodeExecution]] = {}
        for source in self._entry.workflow_tool_sources.values():
            key = (source.app_id, source.workflow_id)
            executions: Sequence[WorkflowNodeExecution] = ()
            if is_resuming:
                executions = tuple(
                    execution
                    for execution in workflow_node_execution_repository.for_workflow_tool(
                        source.app_id
                    ).get_by_workflow_execution(self._run_id, include_paused=True)
                    if execution.workflow_id == source.workflow_id
                )
            self.index.seed_source(source.app_id, source.workflow_id, executions)
            source_histories[key] = executions

        def source_listener(source: WorkflowToolSource, caller_workflow_id: str, caller_node_execution_id: str):
            return self._persistence_layer.create_workflow_tool_event_listener(
                source,
                caller_workflow_id,
                caller_node_execution_id,
                node_executions=source_histories[(source.app_id, source.workflow_id)],
            )

        self._entry.workflow_tool_event_listener_factory = source_listener

    @staticmethod
    @trace_span(WorkflowAppRunnerHandler)
    def run(
        runner: WorkflowBasedAppRunner,
        pause_state_config: PauseStateLayerConfig | None,
        workflow_execution_repository: WorkflowExecutionRepository,
        workflow_node_execution_repository: WorkflowNodeExecutionRepository,
    ) -> None:
        prepared = runner.prepare()
        if prepared is None:
            return
        aggregate = WorkflowRunAgg(
            prepared,
            runner,
            pause_state_config,
            workflow_execution_repository=workflow_execution_repository,
            workflow_node_execution_repository=workflow_node_execution_repository,
        )
        with closing(aggregate.iter_events()) as events:
            for event in events:
                runner.handle_event(
                    prepared.entry,
                    event,
                    node_run_index=aggregate.index.index_for(event.id) if isinstance(event, NodeRunStartedEvent) else 1,
                    node_execution_snapshots=aggregate.index.root_snapshots,
                    pause_reasons=aggregate.pause_reasons,
                )

    def iter_events(self) -> Generator[EngineEvent, None, None]:
        """Publish pause only after the engine closes and all persistence succeeds."""
        paused_event = None
        try:
            with closing(self._entry.run()) as events:
                for event in events:
                    if isinstance(event, GraphRunPausedEvent):
                        paused_event = event
                        continue
                    if isinstance(event, NodeRunHumanInputFormFilledEvent | NodeRunHumanInputFormTimeoutEvent):
                        if event.id in self._published_form_ids:
                            continue
                        self._published_form_ids.add(event.id)
                    if isinstance(
                        event,
                        GraphRunSucceededEvent
                        | GraphRunPartialSucceededEvent
                        | GraphRunFailedEvent
                        | GraphRunAbortedEvent,
                    ):
                        self._refresh_form_completions()
                    yield event
                    if isinstance(event, GraphRunStartedEvent):
                        self._refresh_form_completions()
            if paused_event is not None:
                self._refresh_form_completions()
                self._persist_pause(paused_event)
                yield paused_event
        except Exception as error:
            logger.exception("Workflow run orchestration failed")
            failed = GraphRunFailedEvent(
                error=str(error), exceptions_count=self._runtime_state.graph_execution.exceptions_count
            )
            for layer in self._application_layers:
                try:
                    layer.on_event(failed)
                except Exception:
                    logger.exception("Failed to handle workflow orchestration failure in %s", type(layer).__name__)
            yield failed

    def _load_forms(self, form_ids: Sequence[str]) -> dict[str, HumanInputFormRecord]:
        forms = self._form_repository.get_by_form_ids(
            form_ids,
            tenant_id=self._run_context.tenant_id,
            app_id=self._prepared.generate_entity.app_config.app_id,
            workflow_run_id=self._run_id,
        )
        for form_id in form_ids:
            if form_id not in forms:
                raise ValueError(f"Human input form not found or does not belong to this workflow run: {form_id}")
        return forms

    def _refresh_form_completions(self) -> None:
        pending = {key: reason for key, reason in self._pending_forms.items() if key not in self._published_form_ids}
        if not pending:
            return
        forms = self._load_forms(tuple(pending))
        for form_id, form in forms.items():
            if form.status == HumanInputFormStatus.SUBMITTED:
                restored = DifyHumanInputNodeRuntime(self._run_context).restore_submitted_data(
                    inputs=form.definition.inputs, submitted_data=form.submitted_data or {}
                )
                forms[form_id] = replace(form, submitted_data=dict(restored))
        self._runner.publish_human_input_results(self._entry, pending, forms, self._published_form_ids)

    def _persist_pause(self, event: GraphRunPausedEvent) -> None:
        form_ids = tuple(
            default_session_binding.resolve_form_id_from_session_id(session_id=reason.session_id)
            for reason in event.reasons
            if isinstance(reason, HitlRequired)
        )
        forms = self._load_forms(form_ids)
        self.pause_reasons = [
            build_human_input_pause_reason(
                reason=reason,
                record=forms[default_session_binding.resolve_form_id_from_session_id(session_id=reason.session_id)],
                variable_pool=self._runtime_state.variable_pool,
            )
            if isinstance(reason, HitlRequired)
            else reason
            for reason in event.reasons
        ]
        config = self._pause_state_config
        snapshot = None
        if config is not None:
            entity = self._prepared.generate_entity
            wrapper = (
                _WorkflowGenerateEntityWrapper(entity=entity)
                if isinstance(entity, WorkflowAppGenerateEntity)
                else _AdvancedChatAppGenerateEntityWrapper(entity=entity)
            )
            with use_workflow_file_runtime(self._entry.graph_engine.file_runtime):
                snapshot = WorkflowResumptionContext(
                    generate_entity=wrapper,
                    serialized_graph_runtime_state=self._runtime_state.dumps(),
                    serialized_response_stream_filter_state=self._entry.response_stream_filter.dumps(),
                ).dumps()
        execution = self._persistence_layer.workflow_execution
        execution.status = WorkflowExecutionStatus.PAUSED
        execution.outputs = event.outputs or self._runtime_state.outputs
        execution.total_tokens = self._runtime_state.total_tokens
        execution.total_steps = self._runtime_state.node_run_steps
        execution.exceptions_count = max(
            execution.exceptions_count, self._runtime_state.graph_execution.exceptions_count
        )
        execution.finished_at = None
        self._workflow_execution_repository.save(execution)
        if config is not None and snapshot is not None:
            factory = (
                sessionmaker(config.session_factory)
                if isinstance(config.session_factory, Engine)
                else config.session_factory
            )
            repository = DifyAPIRepositoryFactory.create_api_workflow_run_repository(factory)
            repository.create_workflow_pause(
                workflow_run_id=self._run_id,
                state_owner_user_id=config.state_owner_user_id,
                state=snapshot,
                pause_reasons=self.pause_reasons,
            )
