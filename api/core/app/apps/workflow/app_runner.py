import logging
import time
from typing import cast

from core.app.apps.base_app_queue_manager import AppQueueManager, PublishFrom
from core.app.apps.workflow.app_config_manager import WorkflowAppConfig
from core.app.entities.app_invoke_entities import (
    AppGenerateEntity,
    InvokeFrom,
    WorkflowAppGenerateEntity,
)
from core.app.entities.queue_entities import QueueStopEvent, QueueTextChunkEvent
from core.callback_handler.workflow_event_trigger_callback import WorkflowEventTriggerCallback
from core.moderation.base import ModerationException
from core.moderation.input_moderation import InputModeration
from core.workflow.entities.node_entities import SystemVariable
from core.workflow.workflow_engine_manager import WorkflowEngineManager
from extensions.ext_database import db
from models.account import Account
from models.model import App, EndUser
from models.workflow import WorkflowRunTriggeredFrom

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

        app_record = db.session.query(App).filter(App.id == app_config.app_id).first()
        if not app_record:
            raise ValueError("App not found")

        workflow = WorkflowEngineManager().get_workflow(app_model=app_record, workflow_id=app_config.workflow_id)
        if not workflow:
            raise ValueError("Workflow not initialized")

        inputs = application_generate_entity.inputs
        files = application_generate_entity.files

        # moderation
        if self.handle_input_moderation(
                queue_manager=queue_manager,
                app_record=app_record,
                app_generate_entity=application_generate_entity,
                inputs=inputs
        ):
            return

        # fetch user
        if application_generate_entity.invoke_from in [InvokeFrom.DEBUGGER, InvokeFrom.EXPLORE]:
            user = db.session.query(Account).filter(Account.id == application_generate_entity.user_id).first()
        else:
            user = db.session.query(EndUser).filter(EndUser.id == application_generate_entity.user_id).first()

        # RUN WORKFLOW
        workflow_engine_manager = WorkflowEngineManager()
        workflow_engine_manager.run_workflow(
            workflow=workflow,
            triggered_from=WorkflowRunTriggeredFrom.DEBUGGING
            if application_generate_entity.invoke_from == InvokeFrom.DEBUGGER else WorkflowRunTriggeredFrom.APP_RUN,
            user=user,
            user_inputs=inputs,
            system_inputs={
                SystemVariable.FILES: files
            },
            callbacks=[WorkflowEventTriggerCallback(queue_manager=queue_manager)]
        )

    def handle_input_moderation(self, queue_manager: AppQueueManager,
                                app_record: App,
                                app_generate_entity: WorkflowAppGenerateEntity,
                                inputs: dict) -> bool:
        """
        Handle input moderation
        :param queue_manager: application queue manager
        :param app_record: app record
        :param app_generate_entity: application generate entity
        :param inputs: inputs
        :return:
        """
        try:
            # process sensitive_word_avoidance
            moderation_feature = InputModeration()
            _, inputs, query = moderation_feature.check(
                app_id=app_record.id,
                tenant_id=app_generate_entity.app_config.tenant_id,
                app_config=app_generate_entity.app_config,
                inputs=inputs,
                query=''
            )
        except ModerationException as e:
            if app_generate_entity.stream:
                self._stream_output(
                    queue_manager=queue_manager,
                    text=str(e),
                )

            queue_manager.publish(
                QueueStopEvent(stopped_by=QueueStopEvent.StopBy.INPUT_MODERATION),
                PublishFrom.APPLICATION_MANAGER
            )
            return True

        return False

    def _stream_output(self, queue_manager: AppQueueManager,
                       text: str) -> None:
        """
        Direct output
        :param queue_manager: application queue manager
        :param text: text
        :return:
        """
        index = 0
        for token in text:
            queue_manager.publish(
                QueueTextChunkEvent(
                    text=token
                ), PublishFrom.APPLICATION_MANAGER
            )
            index += 1
            time.sleep(0.01)

    def moderation_for_inputs(self, app_id: str,
                              tenant_id: str,
                              app_generate_entity: AppGenerateEntity,
                              inputs: dict) -> tuple[bool, dict, str]:
        """
        Process sensitive_word_avoidance.
        :param app_id: app id
        :param tenant_id: tenant id
        :param app_generate_entity: app generate entity
        :param inputs: inputs
        :return:
        """
        moderation_feature = InputModeration()
        return moderation_feature.check(
            app_id=app_id,
            tenant_id=tenant_id,
            app_config=app_generate_entity.app_config,
            inputs=inputs,
            query=''
        )
