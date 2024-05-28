import logging
import os
from typing import Optional, cast

from core.app.apps.base_app_queue_manager import AppQueueManager
from core.app.apps.workflow.app_config_manager import WorkflowAppConfig
from core.app.apps.workflow.workflow_event_trigger_callback import WorkflowEventTriggerCallback
from core.app.apps.workflow_logging_callback import WorkflowLoggingCallback
from core.app.entities.app_invoke_entities import (
    InvokeFrom,
    WorkflowAppGenerateEntity,
)
from core.workflow.entities.node_entities import SystemVariable
from core.workflow.nodes.base_node import UserFrom
from core.workflow.workflow_engine_manager import WorkflowEngineManager
from extensions.ext_database import db
from models.model import App, EndUser
from models.workflow import Workflow

logger = logging.getLogger(__name__)


class WorkflowAppRunner:
    """
    Workflow Application Runner
    """

    def run(self, application_generate_entity: WorkflowAppGenerateEntity,
            queue_manager: AppQueueManager) -> None:
        """
        Run application
        :param application_generate_entity: application generate entity
        :param queue_manager: application queue manager
        :return:
        """
        app_config = application_generate_entity.app_config
        app_config = cast(WorkflowAppConfig, app_config)

        user_id = None
        if application_generate_entity.invoke_from in [InvokeFrom.WEB_APP, InvokeFrom.SERVICE_API]:
            end_user = db.session.query(EndUser).filter(EndUser.id == application_generate_entity.user_id).first()
            if end_user:
                user_id = end_user.session_id
        else:
            user_id = application_generate_entity.user_id

        app_record = db.session.query(App).filter(App.id == app_config.app_id).first()
        if not app_record:
            raise ValueError("App not found")

        workflow = self.get_workflow(app_model=app_record, workflow_id=app_config.workflow_id)
        if not workflow:
            raise ValueError("Workflow not initialized")

        inputs = application_generate_entity.inputs
        files = application_generate_entity.files

        db.session.close()

        workflow_callbacks = [WorkflowEventTriggerCallback(
            queue_manager=queue_manager,
            workflow=workflow
        )]

        if bool(os.environ.get("DEBUG", 'False').lower() == 'true'):
            workflow_callbacks.append(WorkflowLoggingCallback())

        # RUN WORKFLOW
        workflow_engine_manager = WorkflowEngineManager()
        workflow_engine_manager.run_workflow(
            workflow=workflow,
            user_id=application_generate_entity.user_id,
            user_from=UserFrom.ACCOUNT
            if application_generate_entity.invoke_from in [InvokeFrom.EXPLORE, InvokeFrom.DEBUGGER]
            else UserFrom.END_USER,
            invoke_from=application_generate_entity.invoke_from,
            user_inputs=inputs,
            system_inputs={
                SystemVariable.FILES: files,
                SystemVariable.USER_ID: user_id
            },
            callbacks=workflow_callbacks,
            call_depth=application_generate_entity.call_depth
        )

    def single_iteration_run(self, app_id: str, workflow_id: str,
                             queue_manager: AppQueueManager,
                             inputs: dict, node_id: str, user_id: str) -> None:
        """
        Single iteration run
        """
        app_record: App = db.session.query(App).filter(App.id == app_id).first()
        if not app_record:
            raise ValueError("App not found")
        
        if not app_record.workflow_id:
            raise ValueError("Workflow not initialized")

        workflow = self.get_workflow(app_model=app_record, workflow_id=workflow_id)
        if not workflow:
            raise ValueError("Workflow not initialized")
        
        workflow_callbacks = [WorkflowEventTriggerCallback(
            queue_manager=queue_manager,
            workflow=workflow
        )]

        workflow_engine_manager = WorkflowEngineManager()
        workflow_engine_manager.single_step_run_iteration_workflow_node(
            workflow=workflow,
            node_id=node_id,
            user_id=user_id,
            user_inputs=inputs,
            callbacks=workflow_callbacks
        )

    def get_workflow(self, app_model: App, workflow_id: str) -> Optional[Workflow]:
        """
        Get workflow
        """
        # fetch workflow by workflow_id
        workflow = db.session.query(Workflow).filter(
            Workflow.tenant_id == app_model.tenant_id,
            Workflow.app_id == app_model.id,
            Workflow.id == workflow_id
        ).first()

        # return workflow
        return workflow
