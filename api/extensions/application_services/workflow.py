"""Composition of Console workflow dependencies."""

from __future__ import annotations

from collections.abc import Callable, Generator, Sequence
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, override

from sqlalchemy.orm import Session, sessionmaker

from core.app.entities.app_invoke_entities import InvokeFrom
from core.callback_handler.agent_tool_callback_handler import DifyAgentCallbackHandler
from core.callback_handler.workflow_tool_callback_handler import DifyWorkflowCallbackHandler
from core.ops.ops_trace_manager import TraceQueueManager
from core.tools.__base.tool import Tool
from core.tools.entities.tool_entities import ToolInvokeMessage, ToolInvokeMeta
from extensions.ext_redis import RedisClientWrapper
from models.agent_runtime_contracts import WorkflowAgentRuntimeBindings
from models.annotation_reply import AnnotationReplies
from models.human_input_contracts import HumanInputFormFactory
from models.model import Message
from models.tool_runtime_contracts import WorkflowToolQueries
from repositories.knowledge.retrieval_repository import KnowledgeRetrievalRepository
from services.agent.chat.ports import AgentDatasetTools, AgentToolInvoker
from services.app.generation.agent_config import AgentAppConfigurations
from services.app.generation.ports import MessageFileWriter
from services.human_input.ports import HumanInputFormReader
from services.knowledge.retrieval.ports import DatasetRetrievalFactory
from services.tools.provider_queries import ToolProviders
from services.tools.tool_engine import ToolEngine
from services.workflow.execution.chatflow_ports import ChatflowRecords, ConversationVariables
from services.workflow.execution.node_queries import ConversationHistory, DatasourceCredentials, RetrieverAttachments
from services.workflow.execution.ports import (
    ExecutionContexts,
    ExecutionWriterFactory,
    NodeExecutionWriterFactory,
    PauseReasonResolver,
    WorkflowExecutionLogs,
    WorkflowToolInvoker,
)
from services.workflow.variable_contracts import WorkflowExecutionVariables


class _SessionBoundWorkflowToolInvoker(WorkflowToolInvoker):
    """Keep a transaction open until a workflow tool's lazy output is fully consumed."""

    def __init__(self, sessions: sessionmaker[Session]) -> None:
        self._sessions = sessions

    @override
    def __call__(
        self,
        *,
        tool: Tool,
        tool_parameters: dict[str, Any],
        user_id: str,
        workflow_tool_callback: DifyWorkflowCallbackHandler,
        workflow_call_depth: int,
        conversation_id: str | None = None,
        app_id: str | None = None,
        message_id: str | None = None,
    ) -> Generator[ToolInvokeMessage, None, None]:
        with self._sessions.begin() as session:
            yield from ToolEngine.generic_invoke(
                session=session,
                tool=tool,
                tool_parameters=tool_parameters,
                user_id=user_id,
                workflow_tool_callback=workflow_tool_callback,
                workflow_call_depth=workflow_call_depth,
                conversation_id=conversation_id,
                app_id=app_id,
                message_id=message_id,
            )


class _SessionBoundAgentToolInvoker(AgentToolInvoker):
    """Own one short-lived Session for each eager Agent tool invocation."""

    def __init__(self, sessions: sessionmaker[Session]) -> None:
        self._sessions = sessions

    @override
    def __call__(
        self,
        tool: Tool,
        tool_parameters: str | dict[str, Any],
        user_id: str,
        tenant_id: str,
        message: Message,
        invoke_from: InvokeFrom,
        agent_tool_callback: DifyAgentCallbackHandler,
        trace_manager: TraceQueueManager | None = None,
        conversation_id: str | None = None,
        app_id: str | None = None,
        message_id: str | None = None,
        *,
        records: MessageFileWriter,
    ) -> tuple[str, list[str], ToolInvokeMeta]:
        with self._sessions() as session:
            return ToolEngine.agent_invoke(
                session=session,
                tool=tool,
                tool_parameters=tool_parameters,
                user_id=user_id,
                tenant_id=tenant_id,
                message=message,
                invoke_from=invoke_from,
                agent_tool_callback=agent_tool_callback,
                trace_manager=trace_manager,
                conversation_id=conversation_id,
                app_id=app_id,
                message_id=message_id,
                records=records,
            )


@dataclass(frozen=True)
class WorkflowExecutionDependencies:
    history: ConversationHistory
    attachments: RetrieverAttachments
    datasource_credentials: DatasourceCredentials
    contexts: ExecutionContexts
    logs: WorkflowExecutionLogs
    tools: WorkflowToolQueries
    tool_providers: ToolProviders
    tool_invoker: WorkflowToolInvoker
    agent_tool_invoker: AgentToolInvoker
    agent_bindings: WorkflowAgentRuntimeBindings
    chat_records: ChatflowRecords
    annotation_replies: AnnotationReplies
    human_forms: HumanInputFormFactory
    human_form_reader: HumanInputFormReader
    execution_writer: ExecutionWriterFactory
    node_writer: NodeExecutionWriterFactory
    conversation_variables: ConversationVariables
    resolve_pause: PauseReasonResolver
    notify_pause: Callable[[Sequence[object]], None]
    agent_configs: AgentAppConfigurations
    dataset_tools: AgentDatasetTools
    retrieval: DatasetRetrievalFactory


def build_workflow_execution_dependencies(database_client: sessionmaker[Session]) -> WorkflowExecutionDependencies:
    from functools import partial

    from core.repositories import DifyCoreRepositoryFactory
    from extensions.application_services.annotation import build_annotation_replies
    from extensions.application_services.data_sources import build_data_source_credentials
    from extensions.application_services.retrieval import build_dataset_retrieval
    from repositories.agent.app_execution_repository import AgentAppExecutionRepository
    from repositories.agent.runtime_repository import WorkflowAgentBindingResolver
    from repositories.app.generation_repository import AppGenerationRepository
    from repositories.human_input.form_repository import (
        HumanInputFormRepositoryImpl,
        HumanInputFormSubmissionRepository,
    )
    from repositories.knowledge.segment_repository import SQLAlchemySegmentRepository
    from repositories.tools.provider_repository import ToolProviderRepository
    from repositories.tools.workflow_repository import WorkflowToolRepository
    from repositories.workflow.app_log_repository import WorkflowAppLogRepository
    from repositories.workflow.conversation_variable_repository import WorkflowConversationVariableRepository
    from repositories.workflow.runtime_context_repository import WorkflowRuntimeContextRepository
    from services.tools.dataset.tool import DatasetRetrieverTool
    from services.workflow.execution.adapters.events import enqueue_human_input_notifications
    from services.workflow.execution.adapters.human_input_events import enrich_graph_pause_reasons

    retrieval = build_dataset_retrieval(database_client)
    records = AppGenerationRepository(database_client)
    human_form_reader = HumanInputFormSubmissionRepository(sessions=database_client)
    return WorkflowExecutionDependencies(
        history=records,
        attachments=SQLAlchemySegmentRepository(session_factory=database_client),
        datasource_credentials=build_data_source_credentials(
            database_client=database_client
        ).providers.get_datasource_credentials,
        contexts=WorkflowRuntimeContextRepository(database_client),
        logs=WorkflowAppLogRepository(session_factory=database_client),
        agent_configs=AgentAppExecutionRepository(database_client),
        dataset_tools=partial(
            DatasetRetrieverTool.get_dataset_tools,
            records=KnowledgeRetrievalRepository(database_client),
            retrieval=retrieval,
        ),
        retrieval=retrieval,
        tools=WorkflowToolRepository(database_client),
        tool_providers=ToolProviderRepository(database_client),
        tool_invoker=_SessionBoundWorkflowToolInvoker(database_client),
        agent_tool_invoker=_SessionBoundAgentToolInvoker(database_client),
        agent_bindings=WorkflowAgentBindingResolver(database_client),
        chat_records=records,
        annotation_replies=build_annotation_replies(database_client),
        human_forms=partial(HumanInputFormRepositoryImpl, sessions=database_client),
        human_form_reader=human_form_reader,
        conversation_variables=WorkflowConversationVariableRepository(database_client),
        resolve_pause=partial(enrich_graph_pause_reasons, form_repository=human_form_reader),
        notify_pause=enqueue_human_input_notifications,
        execution_writer=partial(
            DifyCoreRepositoryFactory.create_workflow_execution_repository, session_factory=database_client
        ),
        node_writer=partial(
            DifyCoreRepositoryFactory.create_workflow_node_execution_repository, session_factory=database_client
        ),
    )


if TYPE_CHECKING:
    from services.agent.workflow_contracts import WorkflowAgentBindingStore
    from services.app_dsl_service import AppDslService
    from services.workflow.console_service import ConsoleWorkflowService
    from services.workflow.debug_reservation_service import WorkflowDebugReservationService
    from services.workflow.definition_gateway import (
        WorkflowDefinitionGateway,
        WorkflowDefinitionReader,
        WorkflowDraftReader,
    )
    from services.workflow.draft_service import DraftDefinitions, DraftLifecycle, WorkflowDraftService
    from services.workflow_service import WorkflowService


def build_console_workflow_service(
    *, database_client: sessionmaker[Session], redis: RedisClientWrapper, variables: WorkflowExecutionVariables
) -> ConsoleWorkflowService[WorkflowAgentBindingStore]:
    from core.app.file_access import DatabaseFileAccessController
    from core.helper.encrypter import decrypt_token
    from graphon.graph_engine.manager import GraphEngineManager
    from repositories.app.console_repository import ConsoleAppRepository
    from repositories.workflow.collaboration_repository import WorkflowCollaborationRepository
    from repositories.workflow.debug_reservation_repository import WorkflowDebugReservationRepository
    from repositories.workflow.definition_repository import WorkflowDefinitionRepository
    from repositories.workflow.draft_repository import WorkflowDraftRepository
    from repositories.workflow.node_execution_repository import WorkflowNodeExecutionRepository
    from services.agent.workflow_publish_service import WorkflowAgentPublishService
    from services.app.console_gateway import EnterpriseConsoleAppAccess
    from services.app_generate_service import AppGenerateService
    from services.app_service import AppService
    from services.workflow.access_gateway import WorkflowAccessGateway
    from services.workflow.console_service import ConsoleWorkflowService
    from services.workflow.conversion_service import WorkflowConversionService
    from services.workflow.runtime_gateway import WorkflowRuntimeGateway
    from services.workflow.workflow_converter import WorkflowConverter
    from services.workflow_service import WorkflowService

    workflows = WorkflowService(
        session_maker=database_client, runtime=build_workflow_execution_dependencies(database_client)
    )

    definitions = WorkflowDefinitionRepository(session_factory=database_client)
    drafts = WorkflowDraftRepository(database_client)
    lifecycle = build_workflow_definition_gateway(database_client, definitions, workflows, drafts=drafts)
    apps = ConsoleAppRepository(session_factory=database_client)
    return ConsoleWorkflowService(
        conversion=WorkflowConversionService(
            apps,
            converter=WorkflowConverter(),
            decrypt_token=decrypt_token,
            notify_created=AppService.notify_created_app,
        ),
        agent_services=WorkflowAgentPublishService,
        definitions=definitions,
        drafts=build_workflow_draft_service(drafts, lifecycle, database_client),
        lifecycle=lifecycle,
        runtime=WorkflowRuntimeGateway(
            runtime=build_workflow_execution_dependencies(database_client),
            variables=variables,
            session_factory=database_client,
            workflows=workflows,
            definitions=definitions,
            reservations=WorkflowDebugReservationRepository(database_client),
            executions=WorkflowNodeExecutionRepository(database_client),
            generator=AppGenerateService,
            graph_engine=GraphEngineManager(redis),
            file_access=DatabaseFileAccessController(),
        ),
        apps=apps,
        presence=WorkflowCollaborationRepository(redis=redis),
        access=WorkflowAccessGateway(
            session_factory=database_client, apps=EnterpriseConsoleAppAccess(session_factory=database_client)
        ),
    )


def build_app_dsl_service(session: Session) -> AppDslService:
    from repositories.app.dsl_repository import AppDslOverwriteRepository
    from services.app_dsl_service import AppDslService

    sessions = sessionmaker(bind=session.get_bind(), expire_on_commit=False)
    return AppDslService(
        session,
        drafts=build_workflow_drafts(sessions, import_session=session),
        overwrites=AppDslOverwriteRepository(sessions=sessions, import_session=session),
    )


def build_workflow_definition_gateway(
    database_client: sessionmaker[Session],
    definitions: WorkflowDefinitionReader,
    workflows: WorkflowService,
    *,
    drafts: WorkflowDraftReader,
) -> WorkflowDefinitionGateway:
    from repositories.credentials.query_repository import CredentialQueryRepository
    from services.agent.workflow_resources_gateway import WorkflowAgentSkillReader
    from services.skill_management_service import SkillManagementService
    from services.workflow.definition_gateway import WorkflowDefinitionGateway

    return WorkflowDefinitionGateway(
        session_factory=database_client,
        definitions=definitions,
        drafts=drafts,
        workflows=workflows,
        credentials=CredentialQueryRepository(session_factory=database_client),
        skills=WorkflowAgentSkillReader(SkillManagementService(session_maker=database_client)),
    )


def build_workflow_draft_service(
    definitions: DraftDefinitions[WorkflowAgentBindingStore], lifecycle: DraftLifecycle, sessions: sessionmaker[Session]
) -> WorkflowDraftService[WorkflowAgentBindingStore]:
    from repositories.agent.retirement_repository import WorkflowAgentRetirementRepository
    from services.agent.retirement_service import WorkflowAgentRetirementService
    from services.agent.workflow_publish_service import WorkflowAgentPublishService
    from services.workflow.draft_service import WorkflowDraftService

    return WorkflowDraftService(
        agent_services=WorkflowAgentPublishService,
        definitions=definitions,
        lifecycle=lifecycle,
        retirement=WorkflowAgentRetirementService(WorkflowAgentRetirementRepository(sessions)),
    )


def build_workflow_debug_recovery_service(database_client: sessionmaker[Session]) -> WorkflowDebugReservationService:
    from repositories.agent.retirement_repository import WorkflowAgentRetirementRepository
    from repositories.agent.runtime_repository import WorkflowAgentExecutionRepository
    from repositories.workflow.debug_reservation_repository import WorkflowDebugReservationRepository
    from services.agent.retirement_service import WorkflowAgentRetirementService
    from services.workflow.debug_reservation_service import WorkflowDebugReservationService

    return WorkflowDebugReservationService(
        WorkflowDebugReservationRepository(database_client),
        WorkflowAgentExecutionRepository(database_client),
        WorkflowAgentRetirementService(WorkflowAgentRetirementRepository(database_client)),
    )


def build_workflow_drafts(
    database_client: sessionmaker[Session], *, import_session: Session | None = None
) -> WorkflowDraftService[WorkflowAgentBindingStore]:
    from repositories.workflow.definition_repository import WorkflowDefinitionRepository
    from repositories.workflow.draft_repository import WorkflowDraftRepository
    from services.workflow_service import WorkflowService

    definitions = WorkflowDefinitionRepository(session_factory=database_client, import_session=import_session)
    drafts = WorkflowDraftRepository(database_client, import_session=import_session)
    lifecycle = build_workflow_definition_gateway(
        database_client,
        definitions,
        WorkflowService(database_client, runtime=build_workflow_execution_dependencies(database_client)),
        drafts=drafts,
    )
    return build_workflow_draft_service(drafts, lifecycle, database_client)


def build_workflow_suggestions(database_client: sessionmaker[Session]):
    from repositories.knowledge.dataset_repository import SQLAlchemyDatasetRepository
    from services.workflow.generation.suggestions import WorkflowInstructionSuggestions
    from services.workflow.generation.tool_catalogue import build_tool_catalogue, format_tool_catalogue

    return WorkflowInstructionSuggestions(
        datasets=SQLAlchemyDatasetRepository(session_factory=database_client),
        tools=lambda tenant_id: format_tool_catalogue(build_tool_catalogue(tenant_id)),
    )
