"""Compose workflow variable persistence and offloaded file storage."""

from sqlalchemy.orm import Session, sessionmaker

from core.app.file_access import DatabaseFileAccessController
from extensions.ext_storage import storage
from repositories.factory import DifyAPIRepositoryFactory
from repositories.workflow.draft_repository import WorkflowDraftRepository
from repositories.workflow.draft_variable_repository import WorkflowDraftVariableRepository
from services.file_service import FileService
from services.workflow.console_variable_service import ConsoleWorkflowVariableService
from services.workflow.variable_file_gateway import WorkflowVariableFileGateway
from services.workflow.variable_service import WorkflowVariableService
from tasks.workflow_draft_var_tasks import cleanup_draft_variable_files_task


def build_workflow_variable_service(*, database_client: sessionmaker[Session]) -> WorkflowVariableService:
    return WorkflowVariableService(
        repository=WorkflowDraftVariableRepository(sessions=database_client),
        files=FileService(database_client),
        file_inputs=WorkflowVariableFileGateway(database_client, DatabaseFileAccessController()),
        executions=DifyAPIRepositoryFactory.create_api_workflow_node_execution_repository(database_client),
        storage=storage,
        defer_file_cleanup=cleanup_draft_variable_files_task.delay,
    )


def build_console_workflow_variables(
    *, database_client: sessionmaker[Session], variables: WorkflowVariableService
) -> ConsoleWorkflowVariableService:
    return ConsoleWorkflowVariableService(
        definitions=WorkflowDraftRepository(database_client),
        variables=variables,
        files=WorkflowVariableFileGateway(database_client, DatabaseFileAccessController()),
    )
