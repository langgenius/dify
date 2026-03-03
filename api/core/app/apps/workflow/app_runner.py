import logging
import time
from collections.abc import Mapping, Sequence
from typing import Any, cast

from core.app.apps.base_app_queue_manager import AppQueueManager
from core.app.apps.workflow.app_config_manager import WorkflowAppConfig
from core.app.apps.workflow_app_runner import WorkflowBasedAppRunner
from core.app.entities.app_invoke_entities import InvokeFrom, WorkflowAppGenerateEntity
from core.app.workflow.layers.persistence import PersistenceWorkflowInfo, WorkflowPersistenceLayer
from core.workflow.workflow_entry import WorkflowEntry
from dify_graph.entities.workflow_execution import WorkflowRunRerunMetadata
from dify_graph.enums import WorkflowType
from dify_graph.graph_engine.command_channels.redis_channel import RedisChannel
from dify_graph.graph_engine.layers.base import GraphEngineLayer
from dify_graph.graph_engine.replay import (
    DefaultNodeExecutionStrategyResolver,
    DefaultReplayExecutionExecutor,
    ReplayExecutionStrategyConfig,
)
from dify_graph.repositories.workflow_execution_repository import WorkflowExecutionRepository
from dify_graph.repositories.workflow_node_execution_repository import WorkflowNodeExecutionRepository
from dify_graph.runtime import GraphRuntimeState, VariablePool
from dify_graph.system_variable import SystemVariable
from dify_graph.variable_loader import VariableLoader
from extensions.ext_redis import redis_client
from extensions.otel import WorkflowAppRunnerHandler, trace_span
from libs.datetime_utils import naive_utc_now
from models.workflow import Workflow

logger = logging.getLogger(__name__)


class WorkflowAppRunner(WorkflowBasedAppRunner):
    """
    Workflow Application Runner
    """

    def __init__(
        self,
        *,
        application_generate_entity: WorkflowAppGenerateEntity,
        queue_manager: AppQueueManager,
        variable_loader: VariableLoader,
        workflow: Workflow,
        system_user_id: str,
        root_node_id: str | None = None,
        workflow_execution_repository: WorkflowExecutionRepository,
        workflow_node_execution_repository: WorkflowNodeExecutionRepository,
        graph_engine_layers: Sequence[GraphEngineLayer] = (),
        graph_runtime_state: GraphRuntimeState | None = None,
        execution_graph_config: Mapping[str, Any] | None = None,
        skip_validation: bool = False,
        rerun_metadata: WorkflowRunRerunMetadata | None = None,
        rerun_strategy_config: ReplayExecutionStrategyConfig | None = None,
    ):
        super().__init__(
            queue_manager=queue_manager,
            variable_loader=variable_loader,
            app_id=application_generate_entity.app_config.app_id,
            graph_engine_layers=graph_engine_layers,
        )
        self.application_generate_entity = application_generate_entity
        self._workflow = workflow
        self._sys_user_id = system_user_id
        self._root_node_id = root_node_id
        self._workflow_execution_repository = workflow_execution_repository
        self._workflow_node_execution_repository = workflow_node_execution_repository
        self._resume_graph_runtime_state = graph_runtime_state
        self._execution_graph_config = execution_graph_config
        self._skip_validation = skip_validation
        self._rerun_metadata = rerun_metadata
        self._rerun_strategy_config = rerun_strategy_config

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
        user_from = self._resolve_user_from(invoke_from)

        resume_state = self._resume_graph_runtime_state

        graph_config = self._execution_graph_config or self._workflow.graph_dict

        if resume_state is not None:
            graph_runtime_state = resume_state
            variable_pool = graph_runtime_state.variable_pool
            graph = self._init_graph(
                graph_config=graph_config,
                graph_runtime_state=graph_runtime_state,
                workflow_id=self._workflow.id,
                tenant_id=self._workflow.tenant_id,
                user_id=self.application_generate_entity.user_id,
                user_from=user_from,
                invoke_from=invoke_from,
                root_node_id=self._root_node_id,
                skip_validation=self._skip_validation,
            )
        elif self.application_generate_entity.single_iteration_run or self.application_generate_entity.single_loop_run:
            graph, variable_pool, graph_runtime_state = self._prepare_single_node_execution(
                workflow=self._workflow,
                single_iteration_run=self.application_generate_entity.single_iteration_run,
                single_loop_run=self.application_generate_entity.single_loop_run,
            )
        else:
            inputs = self.application_generate_entity.inputs

            # Create a variable pool.
            system_inputs = SystemVariable(
                files=self.application_generate_entity.files,
                user_id=self._sys_user_id,
                app_id=app_config.app_id,
                timestamp=int(naive_utc_now().timestamp()),
                workflow_id=app_config.workflow_id,
                workflow_execution_id=self.application_generate_entity.workflow_execution_id,
            )
            variable_pool = VariablePool(
                system_variables=system_inputs,
                user_inputs=inputs,
                environment_variables=self._workflow.environment_variables,
                conversation_variables=[],
            )

            graph_runtime_state = GraphRuntimeState(variable_pool=variable_pool, start_at=time.perf_counter())
            graph = self._init_graph(
                graph_config=graph_config,
                graph_runtime_state=graph_runtime_state,
                workflow_id=self._workflow.id,
                tenant_id=self._workflow.tenant_id,
                user_id=self.application_generate_entity.user_id,
                user_from=user_from,
                invoke_from=invoke_from,
                root_node_id=self._root_node_id,
                skip_validation=self._skip_validation,
            )

        # RUN WORKFLOW
        # Create Redis command channel for this workflow execution
        task_id = self.application_generate_entity.task_id
        channel_key = f"workflow:{task_id}:commands"
        command_channel = RedisChannel(redis_client, channel_key)

        self._queue_manager.graph_runtime_state = graph_runtime_state

        node_execution_strategy_resolver = None
        replay_execution_executor = None
        rerun_strategy_config = self._rerun_strategy_config
        if rerun_strategy_config is not None:
            node_execution_strategy_resolver = DefaultNodeExecutionStrategyResolver(
                real_node_ids=set(rerun_strategy_config.real_node_ids),
                baseline_snapshots_by_node_id=rerun_strategy_config.baseline_snapshots_by_node_id,
            )
            replay_execution_executor = DefaultReplayExecutionExecutor(
                variable_pool=graph_runtime_state.variable_pool,
                override_context=rerun_strategy_config.override_context,
            )

        workflow_entry = WorkflowEntry(
            tenant_id=self._workflow.tenant_id,
            app_id=self._workflow.app_id,
            workflow_id=self._workflow.id,
            graph=graph,
            graph_config=graph_config,
            user_id=self.application_generate_entity.user_id,
            user_from=user_from,
            invoke_from=invoke_from,
            call_depth=self.application_generate_entity.call_depth,
            variable_pool=variable_pool,
            graph_runtime_state=graph_runtime_state,
            command_channel=command_channel,
            node_execution_strategy_resolver=node_execution_strategy_resolver,
            replay_execution_executor=replay_execution_executor,
        )

        persistence_layer = WorkflowPersistenceLayer(
            application_generate_entity=self.application_generate_entity,
            workflow_info=PersistenceWorkflowInfo(
                workflow_id=self._workflow.id,
                workflow_type=WorkflowType(self._workflow.type),
                version=self._workflow.version,
                graph_data=graph_config,
            ),
            workflow_execution_repository=self._workflow_execution_repository,
            workflow_node_execution_repository=self._workflow_node_execution_repository,
            trace_manager=self.application_generate_entity.trace_manager,
            rerun_metadata=self._rerun_metadata,
        )

        workflow_entry.graph_engine.layer(persistence_layer)
        for layer in self._graph_engine_layers:
            workflow_entry.graph_engine.layer(layer)

        generator = workflow_entry.run()

        for event in generator:
            self._handle_event(workflow_entry, event)
