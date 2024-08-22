import logging
import os
import time
from collections.abc import Mapping
from typing import Any, Optional, cast

from core.app.apps.advanced_chat.app_config_manager import AdvancedChatAppConfig
from core.app.apps.advanced_chat.workflow_event_trigger_callback import WorkflowEventTriggerCallback
from core.app.apps.base_app_queue_manager import AppQueueManager, PublishFrom
from core.app.apps.base_app_runner import AppRunner
from core.app.apps.workflow_logging_callback import WorkflowLoggingCallback
from core.app.entities.app_invoke_entities import (
    AdvancedChatAppGenerateEntity,
    InvokeFrom,
)
from core.app.entities.queue_entities import QueueAnnotationReplyEvent, QueueStopEvent, QueueTextChunkEvent
from core.moderation.base import ModerationException
from core.workflow.callbacks.base_workflow_callback import WorkflowCallback
from core.workflow.nodes.base_node import UserFrom
from core.workflow.workflow_engine_manager import WorkflowEngineManager
from extensions.ext_database import db
from models import App, Message, Workflow

logger = logging.getLogger(__name__)


class AdvancedChatAppRunner(AppRunner):
    """
    AdvancedChat Application Runner
    """

    def run(
        self,
        application_generate_entity: AdvancedChatAppGenerateEntity,
        queue_manager: AppQueueManager,
        message: Message,
    ) -> None:
        """
        Run application
        :param application_generate_entity: application generate entity
        :param queue_manager: application queue manager
        :param conversation: conversation
        :param message: message
        :return:
        """
        app_config = application_generate_entity.app_config
        app_config = cast(AdvancedChatAppConfig, app_config)

        app_record = db.session.query(App).filter(App.id == app_config.app_id).first()
        if not app_record:
            raise ValueError('App not found')

        workflow = self.get_workflow(app_model=app_record, workflow_id=app_config.workflow_id)
        if not workflow:
            raise ValueError('Workflow not initialized')

        inputs = application_generate_entity.inputs
        query = application_generate_entity.query

        # moderation
        if self.handle_input_moderation(
            queue_manager=queue_manager,
            app_record=app_record,
            app_generate_entity=application_generate_entity,
            inputs=inputs,
            query=query,
            message_id=message.id,
        ):
            return

        # annotation reply
        if self.handle_annotation_reply(
            app_record=app_record,
            message=message,
            query=query,
            queue_manager=queue_manager,
            app_generate_entity=application_generate_entity,
        ):
            return

        db.session.close()

        workflow_callbacks: list[WorkflowCallback] = [
            WorkflowEventTriggerCallback(queue_manager=queue_manager, workflow=workflow)
        ]

        if bool(os.environ.get('DEBUG', 'False').lower() == 'true'):
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
            callbacks=workflow_callbacks,
            call_depth=application_generate_entity.call_depth,
        )

    def single_iteration_run(
        self, app_id: str, workflow_id: str, queue_manager: AppQueueManager, inputs: dict, node_id: str, user_id: str
    ) -> None:
        """
        Single iteration run
        """
        app_record = db.session.query(App).filter(App.id == app_id).first()
        if not app_record:
            raise ValueError('App not found')

        workflow = self.get_workflow(app_model=app_record, workflow_id=workflow_id)
        if not workflow:
            raise ValueError('Workflow not initialized')

        workflow_callbacks = [WorkflowEventTriggerCallback(queue_manager=queue_manager, workflow=workflow)]

        workflow_engine_manager = WorkflowEngineManager()
        workflow_engine_manager.single_step_run_iteration_workflow_node(
            workflow=workflow, node_id=node_id, user_id=user_id, user_inputs=inputs, callbacks=workflow_callbacks
        )

    def get_workflow(self, app_model: App, workflow_id: str) -> Optional[Workflow]:
        """
        Get workflow
        """
        # fetch workflow by workflow_id
        workflow = (
            db.session.query(Workflow)
            .filter(
                Workflow.tenant_id == app_model.tenant_id, Workflow.app_id == app_model.id, Workflow.id == workflow_id
            )
            .first()
        )

        # return workflow
        return workflow

    def handle_input_moderation(
        self,
        queue_manager: AppQueueManager,
        app_record: App,
        app_generate_entity: AdvancedChatAppGenerateEntity,
        inputs: Mapping[str, Any],
        query: str,
        message_id: str,
    ) -> bool:
        """
        Handle input moderation
        :param queue_manager: application queue manager
        :param app_record: app record
        :param app_generate_entity: application generate entity
        :param inputs: inputs
        :param query: query
        :param message_id: message id
        :return:
        """
        try:
            # process sensitive_word_avoidance
            _, inputs, query = self.moderation_for_inputs(
                app_id=app_record.id,
                tenant_id=app_generate_entity.app_config.tenant_id,
                app_generate_entity=app_generate_entity,
                inputs=inputs,
                query=query,
                message_id=message_id,
            )
        except ModerationException as e:
            self._stream_output(
                queue_manager=queue_manager,
                text=str(e),
                stream=app_generate_entity.stream,
                stopped_by=QueueStopEvent.StopBy.INPUT_MODERATION,
            )
            return True

        return False

    def handle_annotation_reply(
        self,
        app_record: App,
        message: Message,
        query: str,
        queue_manager: AppQueueManager,
        app_generate_entity: AdvancedChatAppGenerateEntity,
    ) -> bool:
        """
        Handle annotation reply
        :param app_record: app record
        :param message: message
        :param query: query
        :param queue_manager: application queue manager
        :param app_generate_entity: application generate entity
        """
        # annotation reply
        annotation_reply = self.query_app_annotations_to_reply(
            app_record=app_record,
            message=message,
            query=query,
            user_id=app_generate_entity.user_id,
            invoke_from=app_generate_entity.invoke_from,
        )

        if annotation_reply:
            queue_manager.publish(
                QueueAnnotationReplyEvent(message_annotation_id=annotation_reply.id), PublishFrom.APPLICATION_MANAGER
            )

            self._stream_output(
                queue_manager=queue_manager,
                text=annotation_reply.content,
                stream=app_generate_entity.stream,
                stopped_by=QueueStopEvent.StopBy.ANNOTATION_REPLY,
            )
            return True

        return False

    def _stream_output(
        self, queue_manager: AppQueueManager, text: str, stream: bool, stopped_by: QueueStopEvent.StopBy
    ) -> None:
        """
        Direct output
        :param queue_manager: application queue manager
        :param text: text
        :param stream: stream
        :return:
        """
        if stream:
            index = 0
            for token in text:
                queue_manager.publish(QueueTextChunkEvent(text=token), PublishFrom.APPLICATION_MANAGER)
                index += 1
                time.sleep(0.01)
        else:
            queue_manager.publish(QueueTextChunkEvent(text=text), PublishFrom.APPLICATION_MANAGER)

        queue_manager.publish(QueueStopEvent(stopped_by=stopped_by), PublishFrom.APPLICATION_MANAGER)
