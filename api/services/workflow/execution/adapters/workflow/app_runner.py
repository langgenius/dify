import logging
import time
from collections.abc import Callable, Sequence
from typing import Protocol, cast

from core.app.apps.base_app_queue_manager import AppQueueManager
from core.app.apps.draft_variable_saver import DraftVariableSaverFactory
from core.app.apps.execution_coordinator import app_task_command_channel_key
from core.app.entities.app_invoke_entities import (
    DifyRunContext,
    InvokeFrom,
    WorkflowAppGenerateEntity,
    get_credit_usage_app_type,
)
from core.repositories.factory import WorkflowExecutionRepository, WorkflowNodeExecutionRepository
from core.workflow.nodes.agent_v2.workspace_retirement_layer import build_workflow_agent_workspace_retirement_layer
from core.workflow.snippet_start import get_compatible_start_aliases
from core.workflow.system_variables import build_bootstrap_variables, build_system_variables
from core.workflow.variable_pool_initializer import add_node_inputs_to_pool, add_variables_to_pool
from extensions.ext_redis import redis_client
from extensions.otel import WorkflowAppRunnerHandler, trace_span
from extensions.workflow_warm_shutdown import WORKFLOW_WARM_SHUTDOWN_ABORT_REASON, celery_warm_shutdown_started
from graphon.enums import WorkflowType
from graphon.filters import ResponseStreamFilter
from graphon.graph_engine.command_channels import RedisChannel
from graphon.graph_engine.layers import GraphEngineLayer
from graphon.runtime import GraphRuntimeState, VariablePool
from graphon.runtime.graph_runtime_state import GraphExecutionProtocol
from graphon.variable_loader import VariableLoader
from libs.datetime_utils import naive_utc_now
from models import Account
from models.workflow import Workflow
from services.workflow.execution.adapters.events import WorkflowEventPublisher
from services.workflow.execution.adapters.graph import WorkflowGraphBuilder
from services.workflow.execution.adapters.node_factory import get_default_root_node_id
from services.workflow.execution.adapters.persistence import PersistenceWorkflowInfo, WorkflowPersistenceLayer
from services.workflow.execution.adapters.workflow.app_config_manager import WorkflowAppConfig
from services.workflow.execution.adapters.workflow.command_channels import (
    CelerySignalCommandChannel,
    CombinedCommandChannel,
    StopFlagCommandChannel,
)
from services.workflow.execution.adapters.workflow.stop_aware_ready_queue import attach_stop_aware_ready_queue
from services.workflow.execution.adapters.workflow_entry import WorkflowEntry
from services.workflow.execution.ports import WorkflowRuntime

logger = logging.getLogger(__name__)


class WorkflowExecutionCancellation(Protocol):
    """Cancellation supplied by the execution owner, independent of its lease policy."""

    def bind(self, execution: GraphExecutionProtocol) -> None: ...
    def is_cancelled(self) -> bool: ...
    def raise_if_cancelled(self) -> None: ...


class WorkflowAppRunner:
    """
    Workflow Application Runner
    """

    def __init__(
        self,
        *,
        runtime: WorkflowRuntime,
        application_generate_entity: WorkflowAppGenerateEntity,
        queue_manager: AppQueueManager,
        variable_loader: VariableLoader,
        workflow: Workflow,
        system_user_id: str,
        root_node_id: str | None = None,
        workflow_execution_repository: WorkflowExecutionRepository,
        workflow_node_execution_repository: WorkflowNodeExecutionRepository,
        graph_engine_layers: Sequence[GraphEngineLayer] = (),
        cancellation: WorkflowExecutionCancellation | None = None,
        graph_runtime_state: GraphRuntimeState | None = None,
        response_stream_filter: ResponseStreamFilter | None = None,
        draft_variable_saver: Callable[[str, Account], DraftVariableSaverFactory] | None = None,
    ):
        self._runtime = runtime
        self._graphs = WorkflowGraphBuilder(
            variable_loader=variable_loader,
            app_id=application_generate_entity.app_config.app_id,
            draft_variable_saver=draft_variable_saver,
            agent_binding_resolver=runtime.agent_bindings,
            workflow_runtime=runtime,
        )
        self._queue_manager = queue_manager
        self._events = WorkflowEventPublisher(
            queue_manager, resolve_pause=runtime.resolve_pause, notify_pause=runtime.notify_pause
        )
        self._draft_variable_saver = draft_variable_saver
        self._graph_engine_layers = graph_engine_layers
        self.application_generate_entity = application_generate_entity
        self._cancellation = cancellation
        self._workflow = workflow
        self._sys_user_id = system_user_id
        self._root_node_id = root_node_id
        self._workflow_execution_repository = workflow_execution_repository
        self._workflow_node_execution_repository = workflow_node_execution_repository
        self._resume_graph_runtime_state = graph_runtime_state
        self._response_stream_filter = response_stream_filter

    @trace_span(WorkflowAppRunnerHandler)
    def run(self):
        """
        Run application
        """
        app_config = self.application_generate_entity.app_config
        app_config = cast(WorkflowAppConfig, app_config)
        invoke_from = self.application_generate_entity.invoke_from
        # if only single iteration or single loop run is requested
        if self.application_generate_entity.single_iteration_run or self.application_generate_entity.single_loop_run:
            invoke_from = InvokeFrom.DEBUGGER
        user_from = self._graphs.resolve_user_from(invoke_from)

        resume_state = self._resume_graph_runtime_state

        if resume_state is not None:
            graph_runtime_state = resume_state
            variable_pool = graph_runtime_state.variable_pool
            graph = self._graphs.build(
                graph_config=self._workflow.graph_dict,
                graph_runtime_state=graph_runtime_state,
                workflow_id=self._workflow.id,
                tenant_id=self._workflow.tenant_id,
                user_id=self.application_generate_entity.user_id,
                user_from=user_from,
                invoke_from=invoke_from,
                root_node_id=self._root_node_id,
                app_type=get_credit_usage_app_type(app_config.app_mode),
                trace_session_id=self.application_generate_entity.extras.get("trace_session_id"),
            )
        elif self.application_generate_entity.single_iteration_run or self.application_generate_entity.single_loop_run:
            graph, variable_pool, graph_runtime_state = self._graphs.build_single_node(
                workflow=self._workflow,
                single_iteration_run=self.application_generate_entity.single_iteration_run,
                single_loop_run=self.application_generate_entity.single_loop_run,
                user_id=self.application_generate_entity.user_id,
                app_type=get_credit_usage_app_type(app_config.app_mode),
                trace_session_id=self.application_generate_entity.extras.get("trace_session_id"),
            )
        else:
            inputs = self.application_generate_entity.inputs

            # Create a variable pool.
            system_inputs = build_system_variables(
                files=self.application_generate_entity.files,
                user_id=self._sys_user_id,
                app_id=app_config.app_id,
                timestamp=int(naive_utc_now().timestamp()),
                workflow_id=app_config.workflow_id,
                workflow_execution_id=self.application_generate_entity.workflow_execution_id,
            )
            variable_pool = VariablePool()
            add_variables_to_pool(
                variable_pool,
                build_bootstrap_variables(
                    system_variables=system_inputs,
                    environment_variables=self._workflow.environment_variables,
                ),
            )
            root_node_id = self._root_node_id or get_default_root_node_id(self._workflow.graph_dict)
            add_node_inputs_to_pool(
                variable_pool,
                node_id=root_node_id,
                inputs=inputs,
                aliases=get_compatible_start_aliases(
                    workflow_kind=self._workflow.kind_or_standard,
                    root_node_id=root_node_id,
                ),
            )

            graph_runtime_state = GraphRuntimeState(variable_pool=variable_pool, start_at=time.perf_counter())
            graph = self._graphs.build(
                graph_config=self._workflow.graph_dict,
                graph_runtime_state=graph_runtime_state,
                workflow_id=self._workflow.id,
                tenant_id=self._workflow.tenant_id,
                user_id=self.application_generate_entity.user_id,
                user_from=user_from,
                invoke_from=invoke_from,
                root_node_id=root_node_id,
                app_type=get_credit_usage_app_type(app_config.app_mode),
                trace_session_id=self.application_generate_entity.extras.get("trace_session_id"),
            )

        # RUN WORKFLOW
        # Create Redis command channel for this workflow execution
        task_id = self.application_generate_entity.task_id
        channel_key = app_task_command_channel_key(task_id)
        celery_signal_channel = CelerySignalCommandChannel(
            shutdown_state_getter=celery_warm_shutdown_started,
            abort_reason=WORKFLOW_WARM_SHUTDOWN_ABORT_REASON,
        )
        if self._cancellation is not None:
            if resume_state is not None:
                # This pause belongs to the previous attempt. GraphEngine also
                # clears it at startup, but lease loss can happen while the
                # resumed engine is still being constructed.
                graph_runtime_state.graph_execution.paused = False
            self._cancellation.bind(graph_runtime_state.graph_execution)
        attach_stop_aware_ready_queue(
            graph_runtime_state,
            task_id=task_id,
            should_stop=self._cancellation.is_cancelled if self._cancellation is not None else None,
        )
        command_channel = CombinedCommandChannel(
            (
                RedisChannel(redis_client, channel_key),
                StopFlagCommandChannel(task_id=task_id),
                celery_signal_channel,
            )
        )

        self._queue_manager.graph_runtime_state = graph_runtime_state

        workflow_entry = WorkflowEntry(
            human_form_reader=self._runtime.human_form_reader,
            tenant_id=self._workflow.tenant_id,
            app_id=self._workflow.app_id,
            workflow_id=self._workflow.id,
            graph=graph,
            graph_config=self._workflow.graph_dict,
            user_id=self.application_generate_entity.user_id,
            user_from=user_from,
            invoke_from=invoke_from,
            call_depth=self.application_generate_entity.call_depth,
            variable_pool=variable_pool,
            graph_runtime_state=graph_runtime_state,
            command_channel=command_channel,
            response_stream_filter=self._response_stream_filter,
        )

        persistence_layer = WorkflowPersistenceLayer(
            application_generate_entity=self.application_generate_entity,
            workflow_info=PersistenceWorkflowInfo(
                workflow_id=self._workflow.id,
                workflow_type=WorkflowType(self._workflow.type),
                version=self._workflow.version,
                graph_data=self._workflow.graph_dict,
            ),
            workflow_execution_repository=self._workflow_execution_repository,
            workflow_node_execution_repository=self._workflow_node_execution_repository,
            trace_manager=self.application_generate_entity.trace_manager,
        )

        workflow_entry.graph_engine.layer(persistence_layer)
        workflow_entry.graph_engine.layer(
            build_workflow_agent_workspace_retirement_layer(
                dify_run_context=DifyRunContext(
                    tenant_id=self._workflow.tenant_id,
                    app_id=self._workflow.app_id,
                    user_id=self.application_generate_entity.user_id,
                    user_from=user_from,
                    invoke_from=invoke_from,
                    app_type=get_credit_usage_app_type(app_config.app_mode),
                    trace_session_id=self.application_generate_entity.extras.get("trace_session_id"),
                )
            )
        )
        for layer in self._graph_engine_layers:
            workflow_entry.graph_engine.layer(layer)

        generator = workflow_entry.run()

        for event in generator:
            self._events.publish(workflow_entry, event)
