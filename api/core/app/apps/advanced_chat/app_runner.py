import logging
import time
from collections.abc import Mapping, MutableMapping
from typing import Any, cast

from sqlalchemy import select
from sqlalchemy.orm import Session
from typing_extensions import override

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
from core.memory.entities import MemoryCreatedBy, MemoryScope
from core.model_runtime.entities import AssistantPromptMessage, UserPromptMessage
from core.moderation.base import ModerationError
from core.moderation.input_moderation import InputModeration
from core.variables.variables import VariableUnion
from core.workflow.enums import WorkflowType
from core.workflow.graph_engine.command_channels.redis_channel import RedisChannel
from core.workflow.graph_engine.layers.persistence import PersistenceWorkflowInfo, WorkflowPersistenceLayer
from core.workflow.graph_events import GraphRunSucceededEvent
from core.workflow.repositories.workflow_execution_repository import WorkflowExecutionRepository
from core.workflow.repositories.workflow_node_execution_repository import WorkflowNodeExecutionRepository
from core.workflow.runtime import GraphRuntimeState, VariablePool
from core.workflow.system_variable import SystemVariable
from core.workflow.variable_loader import VariableLoader
from core.workflow.workflow_entry import WorkflowEntry
from extensions.ext_database import db
from extensions.ext_redis import redis_client
from models import Workflow
from models.enums import UserFrom
from models.model import App, Conversation, Message, MessageAnnotation
from models.workflow import ConversationVariable
from services.chatflow_history_service import ChatflowHistoryService
from services.chatflow_memory_service import ChatflowMemoryService

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
        workflow_execution_repository: WorkflowExecutionRepository,
        workflow_node_execution_repository: WorkflowNodeExecutionRepository,
    ):
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
        self._workflow_execution_repository = workflow_execution_repository
        self._workflow_node_execution_repository = workflow_node_execution_repository

    def run(self):
        ChatflowMemoryService.wait_for_sync_memory_completion(
            workflow=self._workflow,
            conversation_id=self.conversation.id
        )

        app_config = self.application_generate_entity.app_config
        app_config = cast(AdvancedChatAppConfig, app_config)

        system_inputs = SystemVariable(
            query=self.application_generate_entity.query,
            files=self.application_generate_entity.files,
            conversation_id=self.conversation.id,
            user_id=self.system_user_id,
            dialogue_count=self._dialogue_count,
            app_id=app_config.app_id,
            workflow_id=app_config.workflow_id,
            workflow_execution_id=self.application_generate_entity.workflow_run_id,
        )

        with Session(db.engine, expire_on_commit=False) as session:
            app_record = session.scalar(select(App).where(App.id == app_config.app_id))

        if not app_record:
            raise ValueError("App not found")

        if self.application_generate_entity.single_iteration_run or self.application_generate_entity.single_loop_run:
            # Handle single iteration or single loop run
            graph, variable_pool, graph_runtime_state = self._prepare_single_node_execution(
                workflow=self._workflow,
                single_iteration_run=self.application_generate_entity.single_iteration_run,
                single_loop_run=self.application_generate_entity.single_loop_run,
            )
        else:
            inputs = self.application_generate_entity.inputs
            query = self.application_generate_entity.query

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

            # Initialize conversation variables
            conversation_variables = self._initialize_conversation_variables()

            # Create a variable pool.
            # init variable pool
            variable_pool = VariablePool(
                system_variables=system_inputs,
                user_inputs=inputs,
                environment_variables=self._workflow.environment_variables,
                # Based on the definition of `VariableUnion`,
                # `list[Variable]` can be safely used as `list[VariableUnion]` since they are compatible.
                conversation_variables=conversation_variables,
                memory_blocks=self._fetch_memory_blocks(),
            )

            # init graph
            graph_runtime_state = GraphRuntimeState(variable_pool=variable_pool, start_at=time.time())
            graph = self._init_graph(
                graph_config=self._workflow.graph_dict,
                graph_runtime_state=graph_runtime_state,
                workflow_id=self._workflow.id,
                tenant_id=self._workflow.tenant_id,
                user_id=self.application_generate_entity.user_id,
            )

        db.session.close()

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

        self._queue_manager.graph_runtime_state = graph_runtime_state

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

        generator = workflow_entry.run()

        for event in generator:
            self._handle_event(workflow_entry, event)

        try:
            self._check_app_memory_updates(variable_pool)
        except Exception as e:
            logger.exception("Failed to check app memory updates", exc_info=e)

    @override
    def _handle_event(self, workflow_entry: WorkflowEntry, event: Any) -> None:
        super()._handle_event(workflow_entry, event)
        if isinstance(event, GraphRunSucceededEvent):
            workflow_outputs = event.outputs
            if not workflow_outputs:
                logger.warning("Chatflow output is empty.")
                return
            assistant_message = workflow_outputs.get('answer')
            if not assistant_message:
                logger.warning("Chatflow output does not contain 'answer'.")
                return
            if not isinstance(assistant_message, str):
                logger.warning("Chatflow output 'answer' is not a string.")
                return
            try:
                self._sync_conversation_to_chatflow_tables(assistant_message)
            except Exception as e:
                logger.exception("Failed to sync conversation to memory tables", exc_info=e)

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

    def _complete_with_stream_output(self, text: str, stopped_by: QueueStopEvent.StopBy):
        """
        Direct output
        """
        self._publish_event(QueueTextChunkEvent(text=text))

        self._publish_event(QueueStopEvent(stopped_by=stopped_by))

    def query_app_annotations_to_reply(
        self, app_record: App, message: Message, query: str, user_id: str, invoke_from: InvokeFrom
    ) -> MessageAnnotation | None:
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

    def _initialize_conversation_variables(self) -> list[VariableUnion]:
        """
        Initialize conversation variables for the current conversation.

        This method:
        1. Loads existing variables from the database
        2. Creates new variables if none exist
        3. Syncs missing variables from the workflow definition

        :return: List of conversation variables ready for use
        """
        with Session(db.engine) as session:
            existing_variables = self._load_existing_conversation_variables(session)

            if not existing_variables:
                # First time initialization - create all variables
                existing_variables = self._create_all_conversation_variables(session)
            else:
                # Check and add any missing variables from the workflow
                existing_variables = self._sync_missing_conversation_variables(session, existing_variables)

            # Convert to Variable objects for use in the workflow
            conversation_variables = [var.to_variable() for var in existing_variables]

            session.commit()
            return cast(list[VariableUnion], conversation_variables)

    def _load_existing_conversation_variables(self, session: Session) -> list[ConversationVariable]:
        """
        Load existing conversation variables from the database.

        :param session: Database session
        :return: List of existing conversation variables
        """
        stmt = select(ConversationVariable).where(
            ConversationVariable.app_id == self.conversation.app_id,
            ConversationVariable.conversation_id == self.conversation.id,
        )
        return list(session.scalars(stmt).all())

    def _create_all_conversation_variables(self, session: Session) -> list[ConversationVariable]:
        """
        Create all conversation variables for a new conversation.

        :param session: Database session
        :return: List of created conversation variables
        """
        new_variables = [
            ConversationVariable.from_variable(
                app_id=self.conversation.app_id, conversation_id=self.conversation.id, variable=variable
            )
            for variable in self._workflow.conversation_variables
        ]

        if new_variables:
            session.add_all(new_variables)

        return new_variables

    def _sync_missing_conversation_variables(
        self, session: Session, existing_variables: list[ConversationVariable]
    ) -> list[ConversationVariable]:
        """
        Sync missing conversation variables from the workflow definition.

        This handles the case where new variables are added to a workflow
        after conversations have already been created.

        :param session: Database session
        :param existing_variables: List of existing conversation variables
        :return: Updated list including any newly created variables
        """
        # Get IDs of existing and workflow variables
        existing_ids = {var.id for var in existing_variables}
        workflow_variables = {var.id: var for var in self._workflow.conversation_variables}

        # Find missing variable IDs
        missing_ids = set(workflow_variables.keys()) - existing_ids

        if not missing_ids:
            return existing_variables

        # Create missing variables with their default values
        new_variables = [
            ConversationVariable.from_variable(
                app_id=self.conversation.app_id,
                conversation_id=self.conversation.id,
                variable=workflow_variables[var_id],
            )
            for var_id in missing_ids
        ]

        session.add_all(new_variables)

        # Return combined list
        return existing_variables + new_variables

    def _fetch_memory_blocks(self) -> Mapping[str, str]:
        """fetch all memory blocks for current app"""

        memory_blocks_dict: MutableMapping[str, str] = {}
        is_draft = (self.application_generate_entity.invoke_from == InvokeFrom.DEBUGGER)
        conversation_id = self.conversation.id
        memory_block_specs = self._workflow.memory_blocks
        # Get runtime memory values
        memories = ChatflowMemoryService.get_memories_by_specs(
            memory_block_specs=memory_block_specs,
            tenant_id=self._workflow.tenant_id,
            app_id=self._workflow.app_id,
            node_id=None,
            conversation_id=conversation_id,
            is_draft=is_draft,
            created_by=self._get_created_by(),
        )

        # Build memory_id -> value mapping
        for memory in memories:
            if memory.spec.scope == MemoryScope.APP:
                # App level: use memory_id directly
                memory_blocks_dict[memory.spec.id] = memory.value
            else:  # NODE scope
                node_id = memory.node_id
                if not node_id:
                    logger.warning("Memory block %s has no node_id, skip.", memory.spec.id)
                    continue
                key = f"{node_id}.{memory.spec.id}"
                memory_blocks_dict[key] = memory.value

        return memory_blocks_dict

    def _sync_conversation_to_chatflow_tables(self, assistant_message: str):
        ChatflowHistoryService.save_app_message(
            prompt_message=UserPromptMessage(content=(self.application_generate_entity.query)),
            conversation_id=self.conversation.id,
            app_id=self._workflow.app_id,
            tenant_id=self._workflow.tenant_id
        )
        ChatflowHistoryService.save_app_message(
            prompt_message=AssistantPromptMessage(content=assistant_message),
            conversation_id=self.conversation.id,
            app_id=self._workflow.app_id,
            tenant_id=self._workflow.tenant_id
        )

    def _check_app_memory_updates(self, variable_pool: VariablePool):
        is_draft = (self.application_generate_entity.invoke_from == InvokeFrom.DEBUGGER)

        ChatflowMemoryService.update_app_memory_if_needed(
            workflow=self._workflow,
            conversation_id=self.conversation.id,
            variable_pool=variable_pool,
            is_draft=is_draft,
            created_by=self._get_created_by()
        )

    def _get_created_by(self) -> MemoryCreatedBy:
        if self.application_generate_entity.invoke_from in {InvokeFrom.DEBUGGER, InvokeFrom.EXPLORE}:
            return MemoryCreatedBy(account_id=self.application_generate_entity.user_id)
        else:
            return MemoryCreatedBy(end_user_id=self.application_generate_entity.user_id)
