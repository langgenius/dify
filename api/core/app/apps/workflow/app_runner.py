import logging
from typing import Optional, cast

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
from core.workflow.enums import SystemVariableKey
from core.workflow.workflow_entry import WorkflowEntry
from models import Workflow
from models.enums import UserFrom
from models.workflow import WorkflowType

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
        workflow_thread_pool_id: Optional[str] = None,
        workflow: Workflow,
    ) -> None:
        super().__init__(queue_manager=queue_manager)

        self.application_generate_entity = application_generate_entity
        self.workflow_thread_pool_id = workflow_thread_pool_id
        self.workflow = workflow

    def run(self) -> None:
        """
        Run application
        :param application_generate_entity: application generate entity
        :param queue_manager: application queue manager
        :return:
        """
        app_config = cast(WorkflowAppConfig, self.application_generate_entity.app_config)

        workflow_callbacks: list[WorkflowCallback] = []
        if dify_config.DEBUG:
            workflow_callbacks.append(WorkflowLoggingCallback())

        # if only single iteration run is requested
        if self.application_generate_entity.single_iteration_run:
            # if only single iteration run is requested
            graph, variable_pool = self._get_graph_and_variable_pool_of_single_iteration(
                workflow=self.workflow,
                node_id=self.application_generate_entity.single_iteration_run.node_id,
                user_inputs=self.application_generate_entity.single_iteration_run.inputs,
            )
        else:
            inputs = self.application_generate_entity.inputs
            files = self.application_generate_entity.files

            # Create a variable pool.
            system_inputs = {
                SystemVariableKey.FILES: files,
                SystemVariableKey.USER_ID: self.application_generate_entity.user_id,
                SystemVariableKey.APP_ID: app_config.app_id,
                SystemVariableKey.WORKFLOW_ID: app_config.workflow_id,
                SystemVariableKey.WORKFLOW_RUN_ID: self.application_generate_entity.workflow_run_id,
            }

            variable_pool = VariablePool(
                system_variables=system_inputs,
                user_inputs=inputs,
                environment_variables=self.workflow.environment_variables,
                conversation_variables=[],
            )

            # init graph
            graph = self._init_graph(graph_config=self.workflow.graph_dict)

        # RUN WORKFLOW
        workflow_entry = WorkflowEntry(
            tenant_id=self.workflow.tenant_id,
            app_id=self.workflow.app_id,
            workflow_id=self.workflow.id,
            workflow_type=WorkflowType.value_of(self.workflow.type),
            graph=graph,
            graph_config=self.workflow.graph_dict,
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
