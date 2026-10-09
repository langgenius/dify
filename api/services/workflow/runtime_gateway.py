from services.workflow.node_execution_extras import node_execution_extras

"""Adapt the existing workflow engine to framework-neutral Console ports."""

from collections.abc import Mapping, Sequence
from typing import Any

from sqlalchemy.orm import Session, sessionmaker

from core.app.app_config.features.file_upload.manager import FileUploadConfigManager
from core.app.apps.base_app_queue_manager import AppQueueManager
from core.app.entities.app_invoke_entities import InvokeFrom
from core.app.file_access import DatabaseFileAccessController
from core.plugin.impl.exc import PluginInvokeError
from core.trigger.constants import TRIGGER_SCHEDULE_NODE_TYPE
from core.trigger.debug.event_selectors import create_event_poller, select_trigger_debug_events
from factories import file_factory
from graphon.file import File
from graphon.graph_engine.manager import GraphEngineManager
from machinery.context import RequestContext
from models import Account, App
from models.workflow import Workflow, WorkflowNodeExecutionModel
from repositories.agent.retirement_repository import WorkflowAgentRetirementRepository
from repositories.workflow.debug_reservation_repository import WorkflowDebugReservationRepository
from repositories.workflow.definition_repository import (
    WorkflowDefinitionRepository,
    workflow_from_snapshot,
    workflow_snapshot,
)
from repositories.workflow.node_execution_repository import WorkflowNodeExecutionRepository
from services.agent.retirement_service import WorkflowAgentRetirementService
from services.app.generation.runtime import AppGenerationRuntime
from services.app_generate_service import AppGenerateService
from services.errors.app import WorkflowNotFoundError
from services.workflow.contracts import (
    WorkflowGeneration,
    WorkflowSnapshot,
    WorkflowTriggerError,
    WorkflowTriggerEvent,
)
from services.workflow.stream_reservation import WorkflowStreamReservation
from services.workflow.variable_contracts import WorkflowExecutionVariables
from services.workflow_service import WorkflowService


class WorkflowRuntimeGateway:
    def __init__(
        self,
        *,
        session_factory: sessionmaker[Session],
        workflows: WorkflowService,
        definitions: WorkflowDefinitionRepository,
        reservations: WorkflowDebugReservationRepository,
        executions: WorkflowNodeExecutionRepository,
        generator: type[AppGenerateService],
        graph_engine: GraphEngineManager,
        file_access: DatabaseFileAccessController,
        variables: WorkflowExecutionVariables,
        runtime: AppGenerationRuntime,
    ) -> None:
        self._sessions = session_factory
        self._workflows = workflows
        self._definitions = definitions
        self._reservations = reservations
        self._executions = executions
        self._generator = generator
        self._graph_engine = graph_engine
        self._file_access = file_access
        self._variables = variables
        self._runtime = runtime

    def generate(
        self,
        context: RequestContext,
        app_id: str,
        args: dict[str, Any],
        *,
        root_node_id: str | None,
        workflow: WorkflowSnapshot | None,
    ) -> WorkflowGeneration:
        reservation = (
            WorkflowStreamReservation(lambda: self._cancel_trigger_debug(workflow, context.account_id))
            if workflow is not None and workflow.execution_id is not None
            else None
        )
        try:
            app, actor, definition = self._definitions.debug_context(
                context, app_id, workflow_id=args.get("workflow_id"), snapshot=workflow
            )
            stream = self._generator.generate_workflow_stream(
                runtime=self._runtime,
                variables=self._variables,
                app_model=app,
                user=actor,
                workflow=definition,
                args=args,
                invoke_from=InvokeFrom.DEBUGGER,
                root_node_id=root_node_id,
                workflow_snapshot=workflow,
                reservation=reservation,
            )
            return reservation.wrap(stream) if reservation is not None else stream
        except Exception as error:
            if reservation is not None:
                reservation.close()
            if isinstance(error, PluginInvokeError) and root_node_id is not None:
                raise WorkflowTriggerError(error.to_user_friendly_error()) from error
            raise

    def _cancel_trigger_debug(self, snapshot: WorkflowSnapshot, account_id: str) -> None:
        if snapshot.execution_id is None:
            return
        WorkflowAgentRetirementService.finish_execution(
            sessions=self._sessions,
            tenant_id=snapshot.tenant_id,
            app_id=snapshot.app_id,
            workflow_id=snapshot.id,
            execution_id=snapshot.execution_id,
            account_id=account_id,
            cancel=True,
        )

    def iteration(
        self, context: RequestContext, app_id: str, node_id: str, inputs: dict[str, Any] | None
    ) -> WorkflowGeneration:
        app, actor, workflow = self._definitions.debug_context(context, app_id, workflow_id=None, snapshot=None)
        return self._generator.generate_single_iteration(
            runtime=self._runtime,
            variables=self._variables,
            app_model=app,
            user=actor,
            workflow=workflow,
            node_id=node_id,
            args={"inputs": inputs} if inputs is not None else {},
            streaming=True,
        )

    def loop(
        self, context: RequestContext, app_id: str, node_id: str, inputs: dict[str, Any] | None
    ) -> WorkflowGeneration:
        app, actor, workflow = self._definitions.debug_context(context, app_id, workflow_id=None, snapshot=None)
        return self._generator.generate_single_loop(
            runtime=self._runtime,
            variables=self._variables,
            app_model=app,
            user=actor,
            workflow=workflow,
            node_id=node_id,
            args={"inputs": inputs},
            streaming=True,
        )

    def _draft(self, context: RequestContext, app_id: str, missing_message: str) -> tuple[App, Account, Workflow]:
        try:
            return self._definitions.debug_context(context, app_id, workflow_id=None, snapshot=None)
        except ValueError as error:
            raise ValueError(missing_message) from error

    def _files(self, workflow: Workflow, files: list[dict[str, Any]] | None) -> Sequence[File]:
        config = FileUploadConfigManager.convert(workflow.features_dict, is_vision=False)
        if config is None:
            return []
        return file_factory.build_from_mappings(
            mappings=files or [],
            tenant_id=workflow.tenant_id,
            config=config,
            access_controller=self._file_access,
            sessions=self._sessions,
        )

    def _execution(self, execution: WorkflowNodeExecutionModel, *, include_details: bool) -> dict[str, Any]:
        detail = self._executions.execution_record(execution, include_details=include_details)
        if include_details:
            # Plugin icons can perform external I/O; repository reads are closed.
            detail["extras"] = node_execution_extras(execution, tool_providers=self._runtime.tool_providers)
        return detail

    def run_node(
        self,
        context: RequestContext,
        app_id: str,
        node_id: str,
        args: dict[str, Any],
        *,
        include_details: bool,
        workflow: WorkflowSnapshot | None,
    ) -> dict[str, Any]:
        if workflow is None:
            app, actor, draft = self._draft(context, app_id, "Workflow not initialized")
        else:
            app, actor, draft = self._definitions.debug_context(context, app_id, workflow_id=None, snapshot=workflow)
        raw_files = args.get("files")
        execution = self._workflows.run_draft_workflow_node(
            variables=self._variables,
            app_model=app,
            draft_workflow=draft,
            account=actor,
            node_id=node_id,
            user_inputs=args.get("inputs") or {},
            query=args.get("query", ""),
            files=self._files(draft, raw_files if isinstance(raw_files, list) else None),
        )
        return self._execution(execution, include_details=include_details)

    def last_run(self, context: RequestContext, app_id: str, node_id: str) -> dict[str, Any] | None:
        try:
            app, _, workflow = self._draft(context, app_id, "Workflow not found")
        except ValueError as error:
            raise WorkflowNotFoundError(str(error)) from error
        execution = self._workflows.get_node_last_run(app_model=app, workflow=workflow, node_id=node_id)
        return self._execution(execution, include_details=True) if execution is not None else None

    def poll_trigger(
        self, context: RequestContext, app_id: str, node_ids: list[str], *, single_node: bool, select_all: bool
    ) -> WorkflowTriggerEvent | None:
        if single_node:
            app, _, workflow = self._draft(context, app_id, "Workflow not found")
            snapshot = workflow_snapshot(workflow)
        else:
            app, snapshot = self._reservations.reserve_trigger_debug(context, app_id)
            workflow = workflow_from_snapshot(snapshot)
        if single_node:
            node_id = node_ids[0]
            config = workflow.get_node_config_by_id(node_id=node_id)
            if not config:
                raise ValueError("Node data not found for node %s", node_id)
            if workflow.get_node_type_from_node_config(config) == TRIGGER_SCHEDULE_NODE_TYPE:
                return WorkflowTriggerEvent(node_id=node_id, workflow_args={}, workflow=snapshot)
        try:
            if select_all:
                event = select_trigger_debug_events(
                    draft_workflow=workflow, app_model=app, user_id=context.account_id, node_ids=node_ids
                )
            else:
                event = create_event_poller(
                    draft_workflow=workflow,
                    tenant_id=context.active_workspace_id,
                    user_id=context.account_id,
                    app_id=app_id,
                    node_id=node_ids[0],
                ).poll()
        except Exception as error:
            self._cancel_trigger_debug(snapshot, context.account_id)
            if isinstance(error, PluginInvokeError):
                raise WorkflowTriggerError(error.to_user_friendly_error()) from error
            raise
        if event is None:
            self._cancel_trigger_debug(snapshot, context.account_id)
            return None
        return WorkflowTriggerEvent(event.node_id, dict(event.workflow_args), snapshot)

    def stop(self, task_id: str) -> None:
        # Both mechanisms are still consumed by running workflows.
        AppQueueManager.set_stop_flag_no_user_check(task_id)
        self._graph_engine.send_stop_command(task_id)

    def default_blocks(self) -> Sequence[Mapping[str, object]]:
        return self._workflows.get_default_block_configs()

    def default_block(self, block_type: str, filters: dict[str, Any] | None) -> Mapping[str, object]:
        return self._workflows.get_default_block_config(node_type=block_type, filters=filters)

    def retire_agents(self, context: RequestContext, agent_ids: list[str]) -> None:
        WorkflowAgentRetirementService(WorkflowAgentRetirementRepository(self._sessions)).retire_unowned(
            tenant_id=context.active_workspace_id, account_id=context.account_id, agent_ids=agent_ids
        )
