import json
import logging
import time
from collections.abc import Mapping
from typing import Any, cast, override

from sqlalchemy import select
from sqlalchemy.orm import Session

from core.app.apps.advanced_chat.app_config_manager import AdvancedChatAppConfig
from core.app.apps.base_app_queue_manager import AppQueueManager
from core.app.apps.workflow.command_channels import (
    CelerySignalCommandChannel,
    CombinedCommandChannel,
    StopFlagCommandChannel,
)
from core.app.apps.workflow.stop_aware_ready_queue import attach_stop_aware_ready_queue
from core.app.apps.workflow_app_runner import PreparedWorkflowRun, WorkflowBasedAppRunner, WorkflowRunDriver
from core.app.entities.app_invoke_entities import (
    AdvancedChatAppGenerateEntity,
    AppGenerateEntity,
    InvokeFrom,
    get_credit_usage_app_type,
)
from core.app.entities.queue_entities import (
    QueueAnnotationReplyEvent,
    QueueStopEvent,
    QueueTextChunkEvent,
)
from core.app.features.annotation_reply.annotation_reply import AnnotationReplyFeature
from core.db.session_factory import create_session
from core.moderation.base import ModerationError
from core.moderation.input_moderation import InputModeration
from core.workflow.node_factory import get_default_root_node_id
from core.workflow.system_variables import (
    build_bootstrap_variables,
    build_system_variables,
    system_variables_to_mapping,
)
from core.workflow.variable_pool_initializer import add_node_inputs_to_pool, add_variables_to_pool
from core.workflow.variable_prefixes import CONVERSATION_VARIABLE_NODE_ID
from core.workflow.workflow_entry import WorkflowEntry
from extensions.ext_redis import redis_client
from extensions.workflow_warm_shutdown import WORKFLOW_WARM_SHUTDOWN_ABORT_REASON, celery_warm_shutdown_started
from factories import variable_factory
from graphon.engine.command import RedisChannel
from graphon.engine.filter import ResponseStreamFilter
from graphon.enums import WorkflowType
from graphon.runtime import RuntimeState, VariablePool
from graphon.variable_loader import VariableLoader
from graphon.variables.variables import Variable, VariableBase
from models import Workflow
from models.model import App, Conversation, Message, MessageAnnotation
from models.workflow import ConversationVariable

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
        execution_driver: WorkflowRunDriver | None = None,
        graph_runtime_state: RuntimeState | None = None,
        response_stream_filter: ResponseStreamFilter | None = None,
    ):
        super().__init__(
            queue_manager=queue_manager,
            execution_driver=execution_driver,
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
        self._resume_graph_runtime_state = graph_runtime_state
        self._response_stream_filter = response_stream_filter

    @override
    def prepare(self) -> PreparedWorkflowRun | None:
        app_config = self.application_generate_entity.app_config
        app_config = cast(AdvancedChatAppConfig, app_config)

        system_inputs = build_system_variables(
            query=self.application_generate_entity.query,
            files=self.application_generate_entity.files,
            conversation_id=self.conversation.id,
            user_id=self.system_user_id,
            dialogue_count=self._dialogue_count,
            app_id=app_config.app_id,
            workflow_id=app_config.workflow_id,
            workflow_execution_id=self.application_generate_entity.workflow_run_id,
        )

        with create_session() as session:
            app_record = session.scalar(select(App).where(App.id == app_config.app_id))

        if not app_record:
            raise ValueError("App not found")

        invoke_from = self.application_generate_entity.invoke_from
        if self.application_generate_entity.single_iteration_run or self.application_generate_entity.single_loop_run:
            invoke_from = InvokeFrom.DEBUGGER
        user_from = self._resolve_user_from(invoke_from)

        resume_state = self._resume_graph_runtime_state

        if resume_state is not None:
            graph_runtime_state = resume_state
            variable_pool = graph_runtime_state.variable_pool
            graph = self._init_graph(
                graph_config=self._workflow.graph_dict,
                graph_runtime_state=graph_runtime_state,
                workflow_id=self._workflow.id,
                tenant_id=self._workflow.tenant_id,
                user_id=self.application_generate_entity.user_id,
                invoke_from=invoke_from,
                user_from=user_from,
                app_type=get_credit_usage_app_type(app_config.app_mode),
                trace_session_id=self.application_generate_entity.extras.get("trace_session_id"),
                call_depth=self.application_generate_entity.call_depth,
            )
        elif self.application_generate_entity.single_iteration_run or self.application_generate_entity.single_loop_run:
            # Handle single iteration or single loop run
            graph, variable_pool, graph_runtime_state = self._prepare_single_node_execution(
                workflow=self._workflow,
                single_iteration_run=self.application_generate_entity.single_iteration_run,
                single_loop_run=self.application_generate_entity.single_loop_run,
                user_id=self.application_generate_entity.user_id,
                app_type=get_credit_usage_app_type(app_config.app_mode),
                trace_session_id=self.application_generate_entity.extras.get("trace_session_id"),
            )
        else:
            inputs = self.application_generate_entity.inputs
            query = self.application_generate_entity.query

            # moderation
            stop, new_inputs, new_query = self.handle_input_moderation(
                app_record=self._app,
                app_generate_entity=self.application_generate_entity,
                inputs=inputs,
                query=query,
                message_id=self.message.id,
            )
            if stop:
                return None

            self.application_generate_entity.inputs = new_inputs
            self.application_generate_entity.query = new_query
            system_inputs = build_system_variables(
                system_variables_to_mapping(system_inputs),
                query=new_query,
            )

            # annotation reply
            with create_session() as session:
                annotation_reply = self.handle_annotation_reply(
                    app_record=self._app,
                    message=self.message,
                    query=new_query,
                    app_generate_entity=self.application_generate_entity,
                    session=session,
                )
                session.commit()
            if annotation_reply:
                self._publish_event(QueueAnnotationReplyEvent(message_annotation_id=annotation_reply.id))
                self._complete_with_stream_output(
                    text=annotation_reply.content,
                    stopped_by=QueueStopEvent.StopBy.ANNOTATION_REPLY,
                )
                return None

            # Initialize conversation variables
            conversation_variables = self._initialize_conversation_variables()

            # Create a variable pool.
            # init variable pool
            variable_pool = VariablePool()
            add_variables_to_pool(
                variable_pool,
                build_bootstrap_variables(
                    system_variables=system_inputs,
                    environment_variables=self._workflow.environment_variables,
                    conversation_variables=conversation_variables,
                ),
            )
            root_node_id = get_default_root_node_id(self._workflow.graph_dict)
            add_node_inputs_to_pool(variable_pool, node_id=root_node_id, inputs=new_inputs)

            # init graph
            graph_runtime_state = RuntimeState(
                workflow_id=self._workflow.id, variable_pool=variable_pool, start_at=time.time()
            )
            graph = self._init_graph(
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
                call_depth=self.application_generate_entity.call_depth,
            )

        # RUN WORKFLOW
        # Create Redis command channel for this workflow execution
        task_id = self.application_generate_entity.task_id
        channel_key = f"workflow:{task_id}:commands"
        celery_signal_channel = CelerySignalCommandChannel(
            shutdown_state_getter=celery_warm_shutdown_started,
            abort_reason=WORKFLOW_WARM_SHUTDOWN_ABORT_REASON,
        )
        attach_stop_aware_ready_queue(graph_runtime_state, task_id=task_id)
        command_channel = CombinedCommandChannel(
            (
                RedisChannel(redis_client, channel_key),
                StopFlagCommandChannel(task_id=task_id),
                celery_signal_channel,
            )
        )

        workflow_entry = WorkflowEntry(
            graph=graph,
            graph_config=self._workflow.graph_dict,
            call_depth=self.application_generate_entity.call_depth,
            graph_runtime_state=graph_runtime_state,
            command_channel=command_channel,
            response_stream_filter=self._response_stream_filter,
        )

        self._queue_manager.graph_runtime_state = graph_runtime_state

        return PreparedWorkflowRun(
            entry=workflow_entry,
            application_layers=self._graph_engine_layers,
            generate_entity=self.application_generate_entity,
            workflow_type=WorkflowType(self._workflow.type),
            workflow_version=self._workflow.version,
        )

    def handle_input_moderation(
        self,
        app_record: App,
        app_generate_entity: AdvancedChatAppGenerateEntity,
        inputs: Mapping[str, Any],
        query: str,
        message_id: str,
    ) -> tuple[bool, Mapping[str, Any], str]:
        try:
            # process sensitive_word_avoidance
            _, new_inputs, new_query = self.moderation_for_inputs(
                app_id=app_record.id,
                tenant_id=app_generate_entity.app_config.tenant_id,
                app_generate_entity=app_generate_entity,
                inputs=inputs,
                query=query,
                message_id=message_id,
            )
        except ModerationError as e:
            self._complete_with_stream_output(text=str(e), stopped_by=QueueStopEvent.StopBy.INPUT_MODERATION)
            return True, inputs, query

        return False, new_inputs, new_query

    def handle_annotation_reply(
        self,
        app_record: App,
        message: Message,
        query: str,
        app_generate_entity: AdvancedChatAppGenerateEntity,
        session: Session,
    ) -> MessageAnnotation | None:
        return self.query_app_annotations_to_reply(
            app_record=app_record,
            message=message,
            query=query,
            user_id=app_generate_entity.user_id,
            invoke_from=app_generate_entity.invoke_from,
            session=session,
        )

    def _complete_with_stream_output(self, text: str, stopped_by: QueueStopEvent.StopBy):
        """
        Direct output
        """
        self._publish_event(QueueTextChunkEvent(text=text))

        self._publish_event(QueueStopEvent(stopped_by=stopped_by))

    def query_app_annotations_to_reply(
        self,
        app_record: App,
        message: Message,
        query: str,
        user_id: str,
        invoke_from: InvokeFrom,
        session: Session,
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
            app_record=app_record,
            message=message,
            query=query,
            user_id=user_id,
            invoke_from=invoke_from,
            session=session,
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
            trace_scope=app_generate_entity.trace_scope,
        )

    def _initialize_conversation_variables(self) -> list[Variable]:
        """
        Initialize conversation variables for the current conversation.

        This method:
        1. Loads existing variables from the database
        2. Creates new variables if none exist
        3. Syncs missing variables from the workflow definition

        :return: List of conversation variables ready for use
        """
        with create_session() as session, session.begin():
            existing_variables = self._load_existing_conversation_variables(session)

            if not existing_variables:
                # First time initialization - create all variables
                existing_variables = self._create_all_conversation_variables(session)
            else:
                # Check and add any missing variables from the workflow
                existing_variables = self._sync_missing_conversation_variables(existing_variables, session)

            # Convert to Variable objects for use in the workflow
            conversation_variables = [var.to_variable() for var in existing_variables]

            return cast(list[Variable], conversation_variables)

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
        self, existing_variables: list[ConversationVariable], session: Session
    ) -> list[ConversationVariable]:
        """
        Sync conversation variables from the workflow definition.

        This handles variables added to a workflow after conversations were
        created, and reconciles existing rows with the published definition:
        a renamed variable keeps its stored value under the new name, and a
        variable whose type changed resets to the published default. When a
        row under the new storage id already exists, because a turn ran the
        old sync after the rename and inserted a default row there, the stale
        row is dropped instead of replaced, so no two rows share one primary
        key; the stored value carries over when the existing row still holds
        the published default.

        :param session: Database session
        :param existing_variables: List of existing conversation variables
        :return: Updated list including any newly created variables
        """
        # Compare stored primary keys. A non-UUID author id is rewritten by
        # ConversationVariable.storage_id, so the workflow id itself will not match.
        workflow_variables = {
            ConversationVariable.storage_id(variable): variable for variable in self._workflow.conversation_variables
        }
        workflow_variables_by_author_id = {variable.id: variable for variable in self._workflow.conversation_variables}
        existing_by_id = {row.id: row for row in existing_variables}

        synced_variables: list[ConversationVariable] = []
        for row in existing_variables:
            published = workflow_variables.get(row.id)
            if published is None:
                # A rename changes the storage id of a non-UUID author id, so
                # the row no longer matches by primary key. Match by author id.
                published = self._published_variable_for_row(row, workflow_variables_by_author_id)
            if published is None:
                # Variable removed from the workflow; leave the row alone.
                synced_variables.append(row)
            elif ConversationVariable.storage_id(published) == row.id:
                row.data = self._reconciled_conversation_variable_data(row.data, published)
                synced_variables.append(row)
            else:
                # The storage id changed, so the old row cannot be updated in
                # place. Replace it with a row under the new id carrying the
                # stored value over, unless a row under the new id already
                # exists: a turn that ran the old sync after the rename
                # inserted a default row there, and replacing would collide
                # with it. Then drop the stale row instead, carrying the
                # stored value over when the existing row still holds the
                # published default.
                new_id = ConversationVariable.storage_id(published)
                existing_row = existing_by_id.get(new_id)
                if (
                    existing_row is not None
                    and self._published_variable_for_row(existing_row, workflow_variables_by_author_id) is published
                ):
                    if self._holds_published_default(existing_row, published):
                        existing_row.data = self._reconciled_conversation_variable_data(row.data, published)
                    session.delete(row)
                else:
                    replacement = ConversationVariable(
                        id=new_id,
                        app_id=self.conversation.app_id,
                        conversation_id=self.conversation.id,
                        data=self._reconciled_conversation_variable_data(row.data, published),
                    )
                    session.delete(row)
                    session.add(replacement)
                    synced_variables.append(replacement)
                    existing_by_id[new_id] = replacement

        # Find missing variable IDs
        existing_ids = {var.id for var in synced_variables}
        missing_ids = set(workflow_variables.keys()) - existing_ids

        if not missing_ids:
            return synced_variables

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
        return synced_variables + new_variables

    @staticmethod
    def _published_variable_for_row(
        row: ConversationVariable, workflow_variables_by_author_id: Mapping[str, VariableBase]
    ) -> VariableBase | None:
        """
        Find the published variable a stored row belongs to, by author id.

        The stored payload keeps the author id, which is stable across
        renames even when the storage id derived from it changes.

        :param row: Stored conversation variable row
        :param workflow_variables_by_author_id: Published variables by author id
        :return: Matching published variable, or None when there is none
        """
        try:
            author_id = json.loads(row.data).get("id")
        except (ValueError, TypeError, AttributeError):
            return None
        if isinstance(author_id, str):
            return workflow_variables_by_author_id.get(author_id)
        return None

    @staticmethod
    def _holds_published_default(row: ConversationVariable, published: VariableBase) -> bool:
        """
        Whether a stored row still holds the published default value.

        A row inserted by the old sync after a rename carries the published
        default; a row the user has since changed does not. Only a default
        row may take over the stale row's stored value.

        :param row: Stored conversation variable row
        :param published: Published variable definition
        :return: True when the stored value equals the published default
        """
        try:
            stored = variable_factory.build_conversation_variable_from_mapping(json.loads(row.data))
        except (ValueError, TypeError, AttributeError):
            return False
        return stored.value_type == published.value_type and stored.value == published.value

    @staticmethod
    def _reconciled_conversation_variable_data(stored_data: str, published: VariableBase) -> str:
        """
        Reconcile stored variable JSON with the published definition.

        Same type: adopt the published name and selector, keep the value.
        Changed type: reset to the published default.

        :param stored_data: Stored variable JSON
        :param published: Published variable definition
        :return: Reconciled variable JSON
        """
        stored = variable_factory.build_conversation_variable_from_mapping(json.loads(stored_data))
        if stored.name == published.name and stored.value_type == published.value_type:
            return stored_data
        if stored.value_type == published.value_type:
            mapping = json.loads(stored_data)
            mapping["name"] = published.name
            mapping["selector"] = [CONVERSATION_VARIABLE_NODE_ID, published.name]
            return variable_factory.build_conversation_variable_from_mapping(mapping).model_dump_json()
        return published.model_dump_json()
