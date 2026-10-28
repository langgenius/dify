"""Compose the workflow run execution service and the traced driver that runners call."""

from sqlalchemy.orm import Session, sessionmaker

from core.app.apps.workflow_app_runner import WorkflowRunDriver
from core.repositories.human_input_repository import HumanInputFormSubmissionRepository
from extensions.otel import WorkflowAppRunnerHandler, trace_span
from repositories.factory import DifyAPIRepositoryFactory
from repositories.knowledge.document_repository import SQLAlchemyDocumentRepository
from repositories.workflow_run_task_repository import WorkflowRunTaskRepository
from repositories.workflow_tool_source_repository import SQLAlchemyWorkflowToolSourceRepository
from services.conversation_variable_updater import ConversationVariableUpdater
from services.workflow_run_execution_service import WorkflowRunExecutionService
from services.workflow_tool_source_service import WorkflowToolSourceService


def build_workflow_run_execution_service(*, database_client: sessionmaker[Session]) -> WorkflowRunExecutionService:
    return WorkflowRunExecutionService(
        tool_sources=WorkflowToolSourceService(SQLAlchemyWorkflowToolSourceRepository(database_client)),
        conversation_variables=ConversationVariableUpdater(database_client),
        forms=HumanInputFormSubmissionRepository(),
        tasks=WorkflowRunTaskRepository(
            workflow_runs=DifyAPIRepositoryFactory.create_api_workflow_run_repository(database_client)
        ),
        documents=SQLAlchemyDocumentRepository(session_factory=database_client),
    )


def build_workflow_run_driver(*, database_client: sessionmaker[Session]) -> WorkflowRunDriver:
    """Build the execution driver that workflow-based runners call, traced as one span per run."""
    service = build_workflow_run_execution_service(database_client=database_client)
    return trace_span(WorkflowAppRunnerHandler)(service.run)
