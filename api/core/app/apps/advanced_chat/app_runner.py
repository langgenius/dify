import logging
from collections.abc import Mapping
from typing import Any, Optional, cast

from sqlalchemy import select
from sqlalchemy.orm import Session

from configs import dify_config
from core.app.apps.advanced_chat.app_config_manager import AdvancedChatAppConfig
from core.app.apps.base_app_queue_manager import AppQueueManager
from core.app.apps.workflow_app_runner import WorkflowBasedAppRunner
from core.app.entities.app_invoke_entities import (
    AdvancedChatAppGenerateEntity,
    AppGenerateEntity,
    InvokeFrom,
)
from core.app.entities.queue_entities import (
    QueueAnnotationReplyEvent,
    QueueStopEvent,
    QueueTextChunkEvent,
)
from core.app.features.annotation_reply.annotation_reply import AnnotationReplyFeature
from core.moderation.base import ModerationError
from core.moderation.input_moderation import InputModeration
from core.variables.variables import VariableUnion
from core.workflow.callbacks import WorkflowCallback, WorkflowLoggingCallback
from core.workflow.entities.variable_pool import VariablePool
from core.workflow.system_variable import SystemVariable
from core.workflow.variable_loader import VariableLoader
from core.workflow.workflow_entry import WorkflowEntry
from extensions.ext_database import db
from models import Workflow
from models.enums import UserFrom
from models.model import App, Conversation, Message, MessageAnnotation
from models.workflow import ConversationVariable, WorkflowType

logger = logging.getLogger(__name__)


class AdvancedChatAppRunner(WorkflowBasedAppRunner):
    """
    AdvancedChat Application Runner
    """

    def __init__(
        self,
        *,
        application_generate_entity: AdvancedChatAppGenerateEntity,
        queue_manager: AppQueueManager,
        conversation: Conversation,
        message: Message,
        dialogue_count: int,
        variable_loader: VariableLoader,
        workflow: Workflow,
        system_user_id: str,
        app: App,
    ) -> None:
        super().__init__(
            queue_manager=queue_manager,
            variable_loader=variable_loader,
            app_id=application_generate_entity.app_config.app_id,
        )
        self.application_generate_entity = application_generate_entity
        self.conversation = conversation
        self.message = message
        self._dialogue_count = dialogue_count
        self._workflow = workflow
        self.system_user_id = system_user_id
        self._app = app

    def run(self) -> None:
        app_config = self.application_generate_entity.app_config
        app_config = cast(AdvancedChatAppConfig, app_config)

        app_record = db.session.query(App).where(App.id == app_config.app_id).first()
        if not app_record:
            raise ValueError("App not found")

        workflow_callbacks: list[WorkflowCallback] = []
        if dify_config.DEBUG:
            workflow_callbacks.append(WorkflowLoggingCallback())

        if self.application_generate_entity.single_iteration_run:
            # if only single iteration run is requested
            graph, variable_pool = self._get_graph_and_variable_pool_of_single_iteration(
                workflow=self._workflow,
                node_id=self.application_generate_entity.single_iteration_run.node_id,
                user_inputs=dict(self.application_generate_entity.single_iteration_run.inputs),
            )
        elif self.application_generate_entity.single_loop_run:
            # if only single loop run is requested
            graph, variable_pool = self._get_graph_and_variable_pool_of_single_loop(
                workflow=self._workflow,
                node_id=self.application_generate_entity.single_loop_run.node_id,
                user_inputs=dict(self.application_generate_entity.single_loop_run.inputs),
            )
        else:
            inputs = self.application_generate_entity.inputs
            query = self.application_generate_entity.query
            files = self.application_generate_entity.files

            # moderation
            if self.handle_input_moderation(
                app_record=self._app,
                app_generate_entity=self.application_generate_entity,
                inputs=inputs,
                query=query,
                message_id=self.message.id,
            ):
                return

            # annotation reply
            if self.handle_annotation_reply(
                app_record=self._app,
                message=self.message,
                query=query,
                app_generate_entity=self.application_generate_entity,
            ):
                return

            # Init conversation variables
            stmt = select(ConversationVariable).where(
                ConversationVariable.app_id == self.conversation.app_id,
                ConversationVariable.conversation_id == self.conversation.id,
            )
            with Session(db.engine) as session:
                db_conversation_variables = session.scalars(stmt).all()
                if not db_conversation_variables:
                    # Create conversation variables if they don't exist.
                    db_conversation_variables = [
                        ConversationVariable.from_variable(
                            app_id=self.conversation.app_id, conversation_id=self.conversation.id, variable=variable
                        )
                        for variable in self._workflow.conversation_variables
                    ]
                    session.add_all(db_conversation_variables)
                # Convert database entities to variables.
                conversation_variables = [item.to_variable() for item in db_conversation_variables]

                session.commit()

            # Create a variable pool.
            system_inputs = SystemVariable(
                query=query,
                files=files,
                conversation_id=self.conversation.id,
                user_id=self.system_user_id,
                dialogue_count=self._dialogue_count,
                app_id=app_config.app_id,
                workflow_id=app_config.workflow_id,
                workflow_execution_id=self.application_generate_entity.workflow_run_id,
            )

            # init variable pool
            variable_pool = VariablePool(
                system_variables=system_inputs,
                user_inputs=inputs,
                environment_variables=self._workflow.environment_variables,
                # Based on the definition of `VariableUnion`,
                # `list[Variable]` can be safely used as `list[VariableUnion]` since they are compatible.
                conversation_variables=cast(list[VariableUnion], conversation_variables),
            )

            # init graph
            graph = self._init_graph(graph_config=self._workflow.graph_dict)

        db.session.close()

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
        )

        generator = workflow_entry.run(
            callbacks=workflow_callbacks,
        )

        for event in generator:
            self._handle_event(workflow_entry, event)

    def handle_input_moderation(
        self,
        app_record: App,
        app_generate_entity: AdvancedChatAppGenerateEntity,
        inputs: Mapping[str, Any],
        query: str,
        message_id: str,
    ) -> bool:
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
        except ModerationError as e:
            self._complete_with_stream_output(text=str(e), stopped_by=QueueStopEvent.StopBy.INPUT_MODERATION)
            return True

        return False

    def handle_annotation_reply(
        self, app_record: App, message: Message, query: str, app_generate_entity: AdvancedChatAppGenerateEntity
    ) -> bool:
        annotation_reply = self.query_app_annotations_to_reply(
            app_record=app_record,
            message=message,
            query=query,
            user_id=app_generate_entity.user_id,
            invoke_from=app_generate_entity.invoke_from,
        )

        if annotation_reply:
            self._publish_event(QueueAnnotationReplyEvent(message_annotation_id=annotation_reply.id))

            self._complete_with_stream_output(
                text=annotation_reply.content, stopped_by=QueueStopEvent.StopBy.ANNOTATION_REPLY
            )
            return True

        return False

    def _complete_with_stream_output(self, text: str, stopped_by: QueueStopEvent.StopBy) -> None:
        """
        Direct output
        """
        self._publish_event(QueueTextChunkEvent(text=text))

        self._publish_event(QueueStopEvent(stopped_by=stopped_by))

    def query_app_annotations_to_reply(
        self, app_record: App, message: Message, query: str, user_id: str, invoke_from: InvokeFrom
    ) -> Optional[MessageAnnotation]:
        """
        Query app annotations to reply
        :param app_record: app record
        :param message: message
        :param query: query
        :param user_id: user id
        :param invoke_from: invoke from
        :return:
        """
        annotation_reply_feature = AnnotationReplyFeature()
        return annotation_reply_feature.query(
            app_record=app_record, message=message, query=query, user_id=user_id, invoke_from=invoke_from
        )

    def moderation_for_inputs(
        self,
        *,
        app_id: str,
        tenant_id: str,
        app_generate_entity: AppGenerateEntity,
        inputs: Mapping[str, Any],
        query: str | None = None,
        message_id: str,
    ) -> tuple[bool, Mapping[str, Any], str]:
        """
        Process sensitive_word_avoidance.
        :param app_id: app id
        :param tenant_id: tenant id
        :param app_generate_entity: app generate entity
        :param inputs: inputs
        :param query: query
        :param message_id: message id
        :return:
        """
        moderation_feature = InputModeration()
        return moderation_feature.check(
            app_id=app_id,
            tenant_id=tenant_id,
            app_config=app_generate_entity.app_config,
            inputs=dict(inputs),
            query=query or "",
            message_id=message_id,
            trace_manager=app_generate_entity.trace_manager,
        )
