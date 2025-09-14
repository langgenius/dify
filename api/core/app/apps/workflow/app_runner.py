import logging
from typing import cast

from configs import dify_config
from core.app.apps.base_app_queue_manager import AppQueueManager
from core.app.apps.workflow.app_config_manager import WorkflowAppConfig
from core.app.apps.workflow_app_runner import WorkflowBasedAppRunner
from core.app.entities.app_invoke_entities import (
    InvokeFrom,
    WorkflowAppGenerateEntity,
)
from core.workflow.callbacks import WorkflowCallback, WorkflowLoggingCallback
from core.workflow.entities.variable_pool import VariablePool
from core.workflow.system_variable import SystemVariable
from core.workflow.variable_loader import VariableLoader
from core.workflow.workflow_entry import WorkflowEntry
from models.enums import UserFrom
from models.workflow import Workflow, WorkflowType

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
        workflow_thread_pool_id: str | None = None,
        workflow: Workflow,
        system_user_id: str,
    ):
        super().__init__(
            queue_manager=queue_manager,
            variable_loader=variable_loader,
            app_id=application_generate_entity.app_config.app_id,
        )
        self.application_generate_entity = application_generate_entity
        self.workflow_thread_pool_id = workflow_thread_pool_id
        self._workflow = workflow
        self._sys_user_id = system_user_id

    def run(self):
        """
        Run application
        """
        app_config = self.application_generate_entity.app_config
        app_config = cast(WorkflowAppConfig, app_config)

        workflow_callbacks: list[WorkflowCallback] = []
        if dify_config.DEBUG:
            workflow_callbacks.append(WorkflowLoggingCallback())

        # if only single iteration run is requested
        if self.application_generate_entity.single_iteration_run:
            # if only single iteration run is requested
            graph, variable_pool = self._get_graph_and_variable_pool_of_single_iteration(
                workflow=self._workflow,
                node_id=self.application_generate_entity.single_iteration_run.node_id,
                user_inputs=self.application_generate_entity.single_iteration_run.inputs,
            )
        elif self.application_generate_entity.single_loop_run:
            # if only single loop run is requested
            graph, variable_pool = self._get_graph_and_variable_pool_of_single_loop(
                workflow=self._workflow,
                node_id=self.application_generate_entity.single_loop_run.node_id,
                user_inputs=self.application_generate_entity.single_loop_run.inputs,
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

            # init graph
            graph = self._init_graph(graph_config=self._workflow.graph_dict)

        # RUN WORKFLOW
        workflow_entry = WorkflowEntry(
            tenant_id=self._workflow.tenant_id,
            app_id=self._workflow.app_id,
            workflow_id=self._workflow.id,
            workflow_type=WorkflowType.value_of(self._workflow.type),
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
            thread_pool_id=self.workflow_thread_pool_id,
        )

        generator = workflow_entry.run(callbacks=workflow_callbacks)

        for event in generator:
            self._handle_event(workflow_entry, event)
