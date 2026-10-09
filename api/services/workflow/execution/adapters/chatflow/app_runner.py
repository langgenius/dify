import logging
import time
from collections.abc import Callable, Mapping, Sequence
from typing import Any, cast

from core.app.apps.base_app_queue_manager import AppQueueManager
from core.app.apps.draft_variable_saver import DraftVariableSaverFactory
from core.app.entities.app_invoke_entities import (
    AdvancedChatAppGenerateEntity,
    AppGenerateEntity,
    DifyRunContext,
    InvokeFrom,
    get_credit_usage_app_type,
)
from core.app.entities.queue_entities import (
    QueueAnnotationReplyEvent,
    QueueStopEvent,
    QueueTextChunkEvent,
)
from core.moderation.base import ModerationError
from core.moderation.input_moderation import InputModeration
from core.repositories.factory import WorkflowExecutionRepository, WorkflowNodeExecutionRepository
from core.workflow.nodes.agent_v2.workspace_retirement_layer import build_workflow_agent_workspace_retirement_layer
from core.workflow.system_variables import (
    build_bootstrap_variables,
    build_system_variables,
    system_variables_to_mapping,
)
from core.workflow.variable_pool_initializer import add_node_inputs_to_pool, add_variables_to_pool
from extensions.ext_redis import redis_client
from extensions.otel import WorkflowAppRunnerHandler, trace_span
from extensions.workflow_warm_shutdown import WORKFLOW_WARM_SHUTDOWN_ABORT_REASON, celery_warm_shutdown_started
from graphon.enums import WorkflowType
from graphon.filters import ResponseStreamFilter
from graphon.graph_engine.command_channels import RedisChannel
from graphon.graph_engine.layers import GraphEngineLayer
from graphon.runtime import GraphRuntimeState, VariablePool
from graphon.variable_loader import VariableLoader
from graphon.variables.variables import Variable
from models import Account, Workflow
from models.annotation_reply import AnnotationReply
from models.enums import ConversationFromSource
from models.model import App, Conversation, Message
from services.workflow.execution.adapters.chatflow.app_config_manager import AdvancedChatAppConfig
from services.workflow.execution.adapters.chatflow.conversation_variables import ConversationVariablePersistenceLayer
from services.workflow.execution.adapters.events import WorkflowEventPublisher
from services.workflow.execution.adapters.graph import WorkflowGraphBuilder
from services.workflow.execution.adapters.node_factory import get_default_root_node_id
from services.workflow.execution.adapters.persistence import PersistenceWorkflowInfo, WorkflowPersistenceLayer
from services.workflow.execution.adapters.workflow.command_channels import (
    CelerySignalCommandChannel,
    CombinedCommandChannel,
    StopFlagCommandChannel,
)
from services.workflow.execution.adapters.workflow.stop_aware_ready_queue import attach_stop_aware_ready_queue
from services.workflow.execution.adapters.workflow_entry import WorkflowEntry
from services.workflow.execution.chatflow_ports import ChatflowRuntime

logger = logging.getLogger(__name__)


class AdvancedChatAppRunner:
    """
    AdvancedChat Application Runner
    """

    def __init__(
        self,
        *,
        runtime: ChatflowRuntime,
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
        graph_engine_layers: Sequence[GraphEngineLayer] = (),
        graph_runtime_state: GraphRuntimeState | None = None,
        response_stream_filter: ResponseStreamFilter | None = None,
        draft_variable_saver: Callable[[str, Account], DraftVariableSaverFactory] | None = None,
    ):
        self._runtime = runtime
        self._graphs = WorkflowGraphBuilder(
            variable_loader=variable_loader,
            app_id=application_generate_entity.app_config.app_id,
            draft_variable_saver=draft_variable_saver,
            agent_binding_resolver=runtime.agent_bindings,
            workflow_runtime=runtime,
        )
        self._queue_manager = queue_manager
        self._events = WorkflowEventPublisher(
            queue_manager, resolve_pause=runtime.resolve_pause, notify_pause=runtime.notify_pause
        )
        self._draft_variable_saver = draft_variable_saver
        self._graph_engine_layers = graph_engine_layers
        self.application_generate_entity = application_generate_entity
        self.conversation = conversation
        self.message = message
        self._dialogue_count = dialogue_count
        self._workflow = workflow
        self.system_user_id = system_user_id
        self._app = app
        self._workflow_execution_repository = workflow_execution_repository
        self._workflow_node_execution_repository = workflow_node_execution_repository
        self._resume_graph_runtime_state = graph_runtime_state
        self._response_stream_filter = response_stream_filter

    @trace_span(WorkflowAppRunnerHandler)
    def run(self):
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

        invoke_from = self.application_generate_entity.invoke_from
        if self.application_generate_entity.single_iteration_run or self.application_generate_entity.single_loop_run:
            invoke_from = InvokeFrom.DEBUGGER
        user_from = self._graphs.resolve_user_from(invoke_from)

        resume_state = self._resume_graph_runtime_state

        if resume_state is not None:
            graph_runtime_state = resume_state
            variable_pool = graph_runtime_state.variable_pool
            graph = self._graphs.build(
                graph_config=self._workflow.graph_dict,
                graph_runtime_state=graph_runtime_state,
                workflow_id=self._workflow.id,
                tenant_id=self._workflow.tenant_id,
                user_id=self.application_generate_entity.user_id,
                invoke_from=invoke_from,
                user_from=user_from,
                app_type=get_credit_usage_app_type(app_config.app_mode),
                trace_session_id=self.application_generate_entity.extras.get("trace_session_id"),
            )
        elif self.application_generate_entity.single_iteration_run or self.application_generate_entity.single_loop_run:
            # Handle single iteration or single loop run
            graph, variable_pool, graph_runtime_state = self._graphs.build_single_node(
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
                return

            self.application_generate_entity.inputs = new_inputs
            self.application_generate_entity.query = new_query
            system_inputs = build_system_variables(
                system_variables_to_mapping(system_inputs),
                query=new_query,
            )

            # annotation reply
            annotation_reply = self.handle_annotation_reply(
                app_record=self._app,
                message=self.message,
                query=new_query,
                app_generate_entity=self.application_generate_entity,
            )
            if annotation_reply:
                self._events._publish_event(QueueAnnotationReplyEvent(message_annotation_id=annotation_reply.id))
                self._complete_with_stream_output(
                    text=annotation_reply.content,
                    stopped_by=QueueStopEvent.StopBy.ANNOTATION_REPLY,
                )
                return

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
            graph_runtime_state = GraphRuntimeState(variable_pool=variable_pool, start_at=time.time())
            graph = self._graphs.build(
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
            human_form_reader=self._runtime.human_form_reader,
            tenant_id=self._workflow.tenant_id,
            app_id=self._workflow.app_id,
            workflow_id=self._workflow.id,
            graph=graph,
            graph_config=self._workflow.graph_dict,
            user_id=self.application_generate_entity.user_id,
            user_from=user_from,
            invoke_from=invoke_from,
            call_depth=self.application_generate_entity.call_depth,
            variable_pool=variable_pool,
            graph_runtime_state=graph_runtime_state,
            command_channel=command_channel,
            response_stream_filter=self._response_stream_filter,
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
        workflow_entry.graph_engine.layer(
            build_workflow_agent_workspace_retirement_layer(
                dify_run_context=DifyRunContext(
                    tenant_id=self._workflow.tenant_id,
                    app_id=self._workflow.app_id,
                    user_id=self.application_generate_entity.user_id,
                    user_from=user_from,
                    invoke_from=invoke_from,
                    app_type=get_credit_usage_app_type(app_config.app_mode),
                    trace_session_id=self.application_generate_entity.extras.get("trace_session_id"),
                )
            )
        )
        conversation_variable_layer = ConversationVariablePersistenceLayer(self._runtime.conversation_variables)
        workflow_entry.graph_engine.layer(conversation_variable_layer)
        for layer in self._graph_engine_layers:
            workflow_entry.graph_engine.layer(layer)

        generator = workflow_entry.run()
        for event in generator:
            self._events.publish(workflow_entry, event)

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
    ) -> AnnotationReply | None:
        return self._runtime.annotation_replies.query(
            tenant_id=app_record.tenant_id,
            app_id=app_record.id,
            message_id=message.id,
            query=query,
            user_id=app_generate_entity.user_id,
            from_source=ConversationFromSource.CONSOLE
            if app_generate_entity.invoke_from.runs_as_account()
            else ConversationFromSource.API,
        )

    def _complete_with_stream_output(self, text: str, stopped_by: QueueStopEvent.StopBy):
        """
        Direct output
        """
        self._events._publish_event(QueueTextChunkEvent(text=text))

        self._events._publish_event(QueueStopEvent(stopped_by=stopped_by))

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

    def _initialize_conversation_variables(self) -> list[Variable]:
        return list(
            self._runtime.conversation_variables.initialize(
                app_id=self.conversation.app_id,
                conversation_id=self.conversation.id,
                defaults=self._workflow.conversation_variables,
            )
        )
