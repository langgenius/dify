"""Construct configured workflow execution writers and query repositories."""

from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from configs import dify_config
from libs.module_loading import import_string
from models import Account, EndUser
from models.enums import WorkflowRunTriggeredFrom
from models.workflow import WorkflowNodeExecutionTriggeredFrom
from repositories.api_workflow_node_execution_repository import DifyAPIWorkflowNodeExecutionRepository
from repositories.api_workflow_run_repository import APIWorkflowRunRepository
from services.file_service import UploadFileCreator
from services.workflow.persistence import WorkflowExecutionRepository, WorkflowNodeExecutionRepository


class RepositoryImportError(Exception):
    """Raised when a repository implementation cannot be imported or instantiated."""


_BUILTIN_WORKFLOW_NODE_EXECUTION_REPOSITORIES = frozenset(
    {
        "core.repositories.sqlalchemy_workflow_node_execution_repository.SQLAlchemyWorkflowNodeExecutionRepository",
        "core.repositories.celery_workflow_node_execution_repository.CeleryWorkflowNodeExecutionRepository",
        "extensions.logstore.repositories.logstore_workflow_node_execution_repository."
        "LogstoreWorkflowNodeExecutionRepository",
    }
)


class WorkflowRepositoryFactory:
    """Build workflow repositories from the configured implementation paths."""

    @classmethod
    def create_workflow_execution_repository(
        cls,
        session_factory: sessionmaker | Engine,
        tenant_id: str,
        user: Account | EndUser,
        app_id: str,
        triggered_from: WorkflowRunTriggeredFrom,
    ) -> WorkflowExecutionRepository:
        """Create an execution writer scoped to its tenant, creator, app, and origin."""
        class_path = dify_config.CORE_WORKFLOW_EXECUTION_REPOSITORY

        try:
            repository_class = import_string(class_path)
            return repository_class(
                session_factory=session_factory,
                tenant_id=tenant_id,
                user=user,
                app_id=app_id,
                triggered_from=triggered_from,
            )
        except (ImportError, Exception) as e:
            raise RepositoryImportError(f"Failed to create WorkflowExecutionRepository from '{class_path}': {e}") from e

    @classmethod
    def create_workflow_node_execution_repository(
        cls,
        session_factory: sessionmaker | Engine,
        tenant_id: str,
        user: Account | EndUser,
        app_id: str,
        triggered_from: WorkflowNodeExecutionTriggeredFrom,
        *,
        files: UploadFileCreator | None = None,
    ) -> WorkflowNodeExecutionRepository:
        """Create a node execution writer scoped to its tenant, creator, app, and origin."""
        class_path = dify_config.CORE_WORKFLOW_NODE_EXECUTION_REPOSITORY

        try:
            repository_class = import_string(class_path)
            if class_path in _BUILTIN_WORKFLOW_NODE_EXECUTION_REPOSITORIES:
                if files is None:
                    raise ValueError(f"Workflow node execution repository '{class_path}' requires a file creator")
                return repository_class(
                    session_factory=session_factory,
                    tenant_id=tenant_id,
                    user=user,
                    app_id=app_id,
                    triggered_from=triggered_from,
                    files=files,
                )
            return repository_class(
                session_factory=session_factory,
                tenant_id=tenant_id,
                user=user,
                app_id=app_id,
                triggered_from=triggered_from,
            )
        except (ImportError, Exception) as e:
            raise RepositoryImportError(
                f"Failed to create WorkflowNodeExecutionRepository from '{class_path}': {e}"
            ) from e

    @classmethod
    def create_api_workflow_node_execution_repository(
        cls, session_maker: sessionmaker[Session]
    ) -> DifyAPIWorkflowNodeExecutionRepository:
        """
        Create a DifyAPIWorkflowNodeExecutionRepository instance based on configuration.

        This repository is designed for service-layer operations and uses dependency injection
        with a sessionmaker for better testability and separation of concerns. It provides
        database access patterns specifically needed by service classes, handling queries
        that involve database-specific fields and multi-tenancy concerns.

        Args:
            session_maker: SQLAlchemy sessionmaker to inject for database session management.

        Returns:
            Configured DifyAPIWorkflowNodeExecutionRepository instance

        Raises:
            RepositoryImportError: If the configured repository cannot be imported or instantiated
        """
        class_path = dify_config.API_WORKFLOW_NODE_EXECUTION_REPOSITORY

        try:
            repository_class = import_string(class_path)
            return repository_class(session_maker=session_maker)
        except (ImportError, Exception) as e:
            raise RepositoryImportError(
                f"Failed to create DifyAPIWorkflowNodeExecutionRepository from '{class_path}': {e}"
            ) from e

    @classmethod
    def create_api_workflow_run_repository(cls, session_maker: sessionmaker[Session]) -> APIWorkflowRunRepository:
        """
        Create an APIWorkflowRunRepository instance based on configuration.

        This repository is designed for service-layer WorkflowRun operations and uses dependency
        injection with a sessionmaker for better testability and separation of concerns. It provides
        database access patterns specifically needed by service classes for workflow run management,
        including pagination, filtering, and bulk operations.

        Args:
            session_maker: SQLAlchemy sessionmaker to inject for database session management.

        Returns:
            Configured APIWorkflowRunRepository instance

        Raises:
            RepositoryImportError: If the configured repository cannot be imported or instantiated
        """
        class_path = dify_config.API_WORKFLOW_RUN_REPOSITORY

        try:
            repository_class = import_string(class_path)
            return repository_class(session_maker=session_maker)
        except (ImportError, Exception) as e:
            raise RepositoryImportError(f"Failed to create APIWorkflowRunRepository from '{class_path}': {e}") from e
