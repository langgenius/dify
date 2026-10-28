"""Application service that drives prepared workflow executions.

Workflow-based app runners hand each prepared run to ``WorkflowRunExecutionService.run``.
The service attaches persistence, run indexes, and human input form refresh to the graph
engine, and publishes a durable pause only after the engine closes and persistence succeeds.
It reaches storage only through the ports below; the composition root supplies them.
"""

import logging
from collections.abc import Generator, Mapping, Sequence
from contextlib import closing
from dataclasses import replace
from typing import Any, Protocol

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
from core.repositories.factory import WorkflowExecutionRepository, WorkflowNodeExecutionRepository
from core.repositories.human_input_repository import HumanInputFormRecord
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
from graphon.variables.variables import VariableBase
from services.entities.workflow_tool_source_entities import MaterializedWorkflowTools, WorkflowToolSnapshot
from services.workflow_persistence import PersistenceWorkflowInfo, WorkflowPersistenceLayer
from services.workflow_run_index import WorkflowRunIndex

logger = logging.getLogger(__name__)

_WORKFLOW_TOOL_SNAPSHOT_KEY = "workflow_tool_snapshot"


class WorkflowRunPauseStoppedError(Exception):
    """A requested stop won while the engine was persisting its pause."""


class WorkflowRunForms(Protocol):
    """Read-only lookup of the human input forms that belong to one workflow run."""

    def get_by_form_ids(
        self, form_ids: Sequence[str], *, tenant_id: str, app_id: str, workflow_run_id: str
    ) -> dict[str, HumanInputFormRecord]:
        """Return the requested forms of this run; a form outside the run's scope is absent."""
        ...


class WorkflowRunTasks(Protocol):
    """Durable task binding, stop, and pause records of a workflow run."""

    def bind_task(self, *, tenant_id: str, app_id: str, workflow_run_id: str, task_id: str) -> None:
        """Bind the public task to the run before its started event is exposed.

        One conditional write in the tenant and app binds only a run without a task, so the first binding wins.
        A missing or already bound run is left unchanged without an error.
        """
        ...

    def stop_paused_task(self, *, tenant_id: str, app_id: str, task_id: str) -> None:
        """Record stop intent for the task and finish its paused run.

        One transaction locks the task's run in the tenant and app, so a concurrent resume cannot reopen it,
        and expires the run's waiting forms. A task without a running or paused run is left unchanged
        without an error.
        """
        ...

    def save_pause(
        self, *, workflow_run_id: str, state_owner_user_id: str, state: str, pause_reasons: Sequence[PauseReason]
    ) -> None:
        """Persist the resumable pause of the run with this id under a lock on its row.

        The state is stored before the transaction opens. Raise ``WorkflowRunPauseStoppedError`` when the
        locked run already records stop intent, so a concurrent stop always wins over the pause. A missing
        run, or one that is neither running nor paused, fails with the adapter's own error.
        """
        ...


class PipelineDocumentFailures(Protocol):
    """Marks a pipeline document failed when its run cannot start."""

    def mark_failed(self, *, workspace_id: str, dataset_id: str, document_id: str, error: str) -> None:
        """Record the error on the document in one write scoped to the workspace and dataset.

        A missing document is left unchanged without an error.
        """
        ...


class WorkflowRunToolSources(Protocol):
    """Read-only lookup of the Workflow Tool definitions, in one tenant, that a run pins before it starts."""

    def load(
        self,
        *,
        tenant_id: str,
        graph_config: Mapping[str, Any],
        allow_human_input: bool,
        suspended_tools: Sequence[WorkflowToolContainerPayload],
        snapshot: WorkflowToolSnapshot | None,
    ) -> MaterializedWorkflowTools:
        """Restore the snapshot's definitions, or materialize the current providers when there is none.

        A present snapshot is authoritative: mutable provider records are never read for it.
        Raise ``ValueError`` when a pinned source no longer exists in the tenant, or when ``allow_human_input``
        is false and the graph or a Workflow Tool graph it reaches contains a human input node.
        """
        ...


class WorkflowRunConversationVariables(Protocol):
    """Conversation variables that an advanced chat run updates, scoped to one app's conversation."""

    def update(self, *, app_id: str, conversation_id: str, variable: VariableBase) -> None:
        """Save the variable's new value in one bounded write.

        Raise when the app's conversation has no such variable.
        """
        ...


class _RunConversationVariables:
    """Supply the run's app to the conversation variable writes of the kernel persistence layer."""

    def __init__(self, conversation_variables: WorkflowRunConversationVariables, *, app_id: str) -> None:
        self._conversation_variables = conversation_variables
        self._app_id = app_id

    def update(self, conversation_id: str, variable: VariableBase) -> None:
        self._conversation_variables.update(app_id=self._app_id, conversation_id=conversation_id, variable=variable)


class WorkflowRunAttempt:
    """Own one execution attempt's persistence, form refresh, indexes, and durable pause."""

    def __init__(
        self,
        prepared: PreparedWorkflowRun,
        runner: WorkflowBasedAppRunner,
        pause_state_config: PauseStateLayerConfig | None,
        *,
        workflow_execution_repository: WorkflowExecutionRepository,
        workflow_node_execution_repository: WorkflowNodeExecutionRepository,
        tool_sources: WorkflowRunToolSources,
        conversation_variables: WorkflowRunConversationVariables,
        forms: WorkflowRunForms,
        tasks: WorkflowRunTasks,
    ) -> None:
        self._workflow_execution_repository = workflow_execution_repository
        self._forms = forms
        self._tasks = tasks
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
        extras = prepared.generate_entity.extras
        tool_snapshot = (
            WorkflowToolSnapshot.model_validate(extras[_WORKFLOW_TOOL_SNAPSHOT_KEY])
            if _WORKFLOW_TOOL_SNAPSHOT_KEY in extras
            else None
        )
        materialized_tools = tool_sources.load(
            tenant_id=self._run_context.tenant_id,
            graph_config=self._entry.graph_config,
            allow_human_input=(
                not isinstance(prepared.generate_entity, RagPipelineGenerateEntity)
                and (
                    prepared.generate_entity.allow_human_input
                    if isinstance(prepared.generate_entity, WorkflowAppGenerateEntity)
                    else True
                )
            ),
            suspended_tools=[
                WorkflowToolContainerPayload.model_validate_json(run.payload)
                for run in self._runtime_state.container_runs()
                if isinstance(run, CustomContainerRunState)
            ],
            snapshot=tool_snapshot,
        )
        self._entry.workflow_tool_sources.update(materialized_tools.sources)
        if tool_snapshot is None:
            # The generate entity is serialized by both durable pause/resume paths.
            # Capture every reachable provider before any node can pause or republish it.
            extras[_WORKFLOW_TOOL_SNAPSHOT_KEY] = materialized_tools.snapshot().model_dump(mode="json")
        node_factory = self._entry.graph_engine.graph.node_factory
        if isinstance(node_factory, DifyNodeFactory):
            node_factory.workflow_tools.update(materialized_tools.tools)
        self._pending_forms = {
            default_session_binding.resolve_form_id_from_session_id(session_id=reason.session_id): reason
            for reason in self._runtime_state.graph_execution.pause_reasons
            if isinstance(reason, HitlRequired)
        }
        self._published_form_ids: set[str] = set()
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
        application_layers: list[Layer] = [
            self._persistence_layer,
            build_workflow_agent_workspace_retirement_layer(dify_run_context=self._run_context),
        ]
        if isinstance(prepared.generate_entity, AdvancedChatAppGenerateEntity):
            application_layers.append(
                ConversationVariablePersistenceLayer(
                    _RunConversationVariables(conversation_variables, app_id=self._run_context.app_id)
                )
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

    def iter_events(self) -> Generator[EngineEvent]:
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
                    if isinstance(event, GraphRunStartedEvent):
                        self._tasks.bind_task(
                            tenant_id=self._run_context.tenant_id,
                            app_id=self._prepared.generate_entity.app_config.app_id,
                            workflow_run_id=self._run_id,
                            task_id=self._prepared.generate_entity.task_id,
                        )
                    yield event
                    if isinstance(event, GraphRunStartedEvent):
                        self._refresh_form_completions()
            if paused_event is not None:
                self._refresh_form_completions()
                try:
                    self._persist_pause(paused_event)
                except WorkflowRunPauseStoppedError:
                    self._tasks.stop_paused_task(
                        tenant_id=self._run_context.tenant_id,
                        app_id=self._prepared.generate_entity.app_config.app_id,
                        task_id=self._prepared.generate_entity.task_id,
                    )
                    aborted = GraphRunAbortedEvent(reason="User requested stop")
                    for layer in self._application_layers:
                        layer.on_event(aborted)
                    yield aborted
                else:
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
        forms = self._forms.get_by_form_ids(
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
        entity = self._prepared.generate_entity
        elapsed_time = entity.workflow_execution_timing.finish()
        config = self._pause_state_config
        snapshot = None
        if config is not None:
            wrapper = (
                _WorkflowGenerateEntityWrapper(entity=entity)
                if isinstance(entity, WorkflowAppGenerateEntity)
                else _AdvancedChatAppGenerateEntityWrapper(entity=entity)
            )
            with use_workflow_file_runtime(self._entry.graph_engine.file_runtime):
                snapshot = WorkflowResumptionContext(
                    generate_entity=wrapper,
                    elapsed_time=elapsed_time,
                    serialized_graph_runtime_state=self._runtime_state.dumps(),
                    serialized_response_stream_filter_state=self._entry.response_stream_filter.dumps(),
                ).dumps()
        execution = self._persistence_layer.workflow_execution
        execution.status = WorkflowExecutionStatus.PAUSED
        execution.accumulated_elapsed_time = elapsed_time
        execution.outputs = event.outputs or self._runtime_state.outputs
        execution.total_tokens = self._runtime_state.total_tokens
        execution.total_steps = self._runtime_state.node_run_steps
        execution.exceptions_count = max(
            execution.exceptions_count, self._runtime_state.graph_execution.exceptions_count
        )
        execution.finished_at = None
        self._persistence_layer.persist_unfinished_nodes_synchronously()
        self._workflow_execution_repository.save_synchronously(execution)
        if config is not None and snapshot is not None:
            self._tasks.save_pause(
                workflow_run_id=self._run_id,
                state_owner_user_id=config.state_owner_user_id,
                state=snapshot,
                pause_reasons=self.pause_reasons,
            )


class WorkflowRunExecutionService:
    """Drive prepared workflow executions for every workflow-based app runner."""

    def __init__(
        self,
        *,
        tool_sources: WorkflowRunToolSources,
        conversation_variables: WorkflowRunConversationVariables,
        forms: WorkflowRunForms,
        tasks: WorkflowRunTasks,
        documents: PipelineDocumentFailures,
    ) -> None:
        self._tool_sources = tool_sources
        self._conversation_variables = conversation_variables
        self._forms = forms
        self._tasks = tasks
        self._documents = documents

    def create_attempt(
        self,
        prepared: PreparedWorkflowRun,
        runner: WorkflowBasedAppRunner,
        pause_state_config: PauseStateLayerConfig | None,
        *,
        workflow_execution_repository: WorkflowExecutionRepository,
        workflow_node_execution_repository: WorkflowNodeExecutionRepository,
    ) -> WorkflowRunAttempt:
        """Attach persistence, indexes, and form refresh to a prepared run before its engine starts."""
        return WorkflowRunAttempt(
            prepared,
            runner,
            pause_state_config,
            workflow_execution_repository=workflow_execution_repository,
            workflow_node_execution_repository=workflow_node_execution_repository,
            tool_sources=self._tool_sources,
            conversation_variables=self._conversation_variables,
            forms=self._forms,
            tasks=self._tasks,
        )

    def run(
        self,
        runner: WorkflowBasedAppRunner,
        pause_state_config: PauseStateLayerConfig | None,
        workflow_execution_repository: WorkflowExecutionRepository,
        workflow_node_execution_repository: WorkflowNodeExecutionRepository,
    ) -> None:
        prepared = runner.prepare()
        if prepared is None:
            return
        try:
            attempt = self.create_attempt(
                prepared,
                runner,
                pause_state_config,
                workflow_execution_repository=workflow_execution_repository,
                workflow_node_execution_repository=workflow_node_execution_repository,
            )
        except ValueError as error:
            entity = prepared.generate_entity
            if isinstance(entity, RagPipelineGenerateEntity) and entity.document_id is not None:
                self._documents.mark_failed(
                    workspace_id=entity.app_config.tenant_id,
                    dataset_id=entity.dataset_id,
                    document_id=entity.document_id,
                    error=str(error),
                )
            raise
        with closing(attempt.iter_events()) as events:
            for event in events:
                runner.handle_event(
                    prepared.entry,
                    event,
                    node_run_index=attempt.index.index_for(event.id) if isinstance(event, NodeRunStartedEvent) else 1,
                    node_execution_snapshots=attempt.index.root_snapshots,
                    pause_reasons=attempt.pause_reasons,
                )
