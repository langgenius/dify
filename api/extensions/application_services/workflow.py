"""Composition of Console workflow dependencies."""

from __future__ import annotations

from collections.abc import Callable, Generator, Sequence
from dataclasses import dataclass
from typing import Any, override

from sqlalchemy.orm import Session, sessionmaker

from core.callback_handler.workflow_tool_callback_handler import DifyWorkflowCallbackHandler
from core.tools.__base.tool import Tool
from core.tools.entities.tool_entities import ToolInvokeMessage
from models.agent_runtime_contracts import WorkflowAgentRuntimeBindings
from models.annotation_reply import AnnotationReplies
from models.human_input_contracts import HumanInputFormFactory
from models.tool_runtime_contracts import WorkflowToolQueries
from repositories.knowledge.retrieval_repository import KnowledgeRetrievalRepository
from services.agent.chat.ports import AgentDatasetTools
from services.app.generation.agent_config import AgentAppConfigurations
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
