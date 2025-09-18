import logging
import time
from typing import cast

from core.app.apps.base_app_queue_manager import AppQueueManager
from core.app.apps.workflow.app_config_manager import WorkflowAppConfig
from core.app.apps.workflow_app_runner import WorkflowBasedAppRunner
from core.app.entities.app_invoke_entities import (
    InvokeFrom,
    WorkflowAppGenerateEntity,
)
from core.workflow.entities import GraphRuntimeState, VariablePool
from core.workflow.graph_engine.command_channels.redis_channel import RedisChannel
from core.workflow.system_variable import SystemVariable
from core.workflow.variable_loader import VariableLoader
from core.workflow.workflow_entry import WorkflowEntry
from extensions.ext_redis import redis_client
from models.enums import UserFrom
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
    ):
        super().__init__(
            queue_manager=queue_manager,
            variable_loader=variable_loader,
            app_id=application_generate_entity.app_config.app_id,
        )
        self.application_generate_entity = application_generate_entity
        self._workflow = workflow
        self._sys_user_id = system_user_id

    def run(self):
        """
        Run application
        """
        app_config = self.application_generate_entity.app_config
        app_config = cast(WorkflowAppConfig, app_config)

        # if only single iteration run is requested
        if self.application_generate_entity.single_iteration_run:
            # if only single iteration run is requested
            graph_runtime_state = GraphRuntimeState(
                variable_pool=VariablePool.empty(),
                start_at=time.time(),
            )
            graph, variable_pool = self._get_graph_and_variable_pool_of_single_iteration(
                workflow=self._workflow,
                node_id=self.application_generate_entity.single_iteration_run.node_id,
                user_inputs=self.application_generate_entity.single_iteration_run.inputs,
                graph_runtime_state=graph_runtime_state,
            )
        elif self.application_generate_entity.single_loop_run:
            # if only single loop run is requested
            graph_runtime_state = GraphRuntimeState(
                variable_pool=VariablePool.empty(),
                start_at=time.time(),
            )
            graph, variable_pool = self._get_graph_and_variable_pool_of_single_loop(
                workflow=self._workflow,
                node_id=self.application_generate_entity.single_loop_run.node_id,
                user_inputs=self.application_generate_entity.single_loop_run.inputs,
                graph_runtime_state=graph_runtime_state,
            )
        else:
            inputs = self.application_generate_entity.inputs
            files = self.application_generate_entity.files

            # Create a variable pool.

            system_inputs = SystemVariable(
                files=files,
                user_id=self._sys_user_id,
                app_id=app_config.app_id,
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

            # init graph
            graph = self._init_graph(
                graph_config=self._workflow.graph_dict,
                graph_runtime_state=graph_runtime_state,
                workflow_id=self._workflow.id,
                tenant_id=self._workflow.tenant_id,
                user_id=self.application_generate_entity.user_id,
            )

        # RUN WORKFLOW
        # Create Redis command channel for this workflow execution
        task_id = self.application_generate_entity.task_id
        channel_key = f"workflow:{task_id}:commands"
        command_channel = RedisChannel(redis_client, channel_key)

        workflow_entry = WorkflowEntry(
            tenant_id=self._workflow.tenant_id,
            app_id=self._workflow.app_id,
            workflow_id=self._workflow.id,
            graph=graph,
            graph_config=self._workflow.graph_dict,
            user_id=self.application_generate_entity.user_id,
            user_from=(
                UserFrom.ACCOUNT
                if self.application_generate_entity.invoke_from in {InvokeFrom.EXPLORE, InvokeFrom.DEBUGGER}
                else UserFrom.END_USER
            ),
            invoke_from=self.application_generate_entity.invoke_from,
            call_depth=self.application_generate_entity.call_depth,
            variable_pool=variable_pool,
            graph_runtime_state=graph_runtime_state,
            command_channel=command_channel,
        )

        generator = workflow_entry.run()

        for event in generator:
            self._handle_event(workflow_entry, event)
