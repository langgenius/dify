"""
Repository factory for dynamically creating repository instances based on configuration.

This module provides a Django-like settings system for repository implementations,
allowing users to configure different repository backends through string paths.
"""

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Literal, Protocol

from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from configs import dify_config
from core.file.uploads import FileUploadWriter
from graphon.entities import WorkflowExecution, WorkflowNodeExecution
from libs.module_loading import import_string
from models import Account, EndUser
from models.enums import WorkflowRunTriggeredFrom
from models.workflow import WorkflowNodeExecutionTriggeredFrom


@dataclass
class OrderConfig:
    """Configuration for ordering node execution instances."""

    order_by: list[str]
    order_direction: Literal["asc", "desc"] | None = None


class WorkflowExecutionRepository(Protocol):
    def save(self, execution: WorkflowExecution): ...


class WorkflowNodeExecutionWriter(Protocol):
    def save(self, execution: WorkflowNodeExecution) -> None: ...

    def save_synchronously(self, execution: WorkflowNodeExecution) -> None: ...

    def save_execution_data(self, execution: WorkflowNodeExecution) -> None: ...


class WorkflowNodeExecutionQuery(Protocol):
    def get_by_workflow_execution(
        self,
        workflow_execution_id: str,
        order_config: OrderConfig | None = None,
    ) -> Sequence[WorkflowNodeExecution]: ...


class WorkflowNodeExecutionRepository(WorkflowNodeExecutionWriter, WorkflowNodeExecutionQuery, Protocol):
    """Legacy combined contract for configured third-party repository implementations."""


@dataclass(frozen=True)
class WorkflowNodeExecutionRepositories:
    """Read and write dependencies belonging to one workflow execution lifecycle."""

    writer: WorkflowNodeExecutionWriter
    query: WorkflowNodeExecutionQuery


class RepositoryImportError(Exception):
    """Raised when a repository implementation cannot be imported or instantiated."""

    pass


class DifyCoreRepositoryFactory:
    """
    Factory for creating repository instances based on configuration.

    This factory supports Django-like settings where repository implementations
    are specified as module paths (e.g., 'module.submodule.ClassName').
    """

    @classmethod
    def create_workflow_execution_repository(
        cls,
        session_factory: sessionmaker | Engine,
        tenant_id: str,
        user: Account | EndUser,
        app_id: str,
        triggered_from: WorkflowRunTriggeredFrom,
    ) -> WorkflowExecutionRepository:
        """
        Create a WorkflowExecutionRepository instance based on configuration.

        Args:
            session_factory: SQLAlchemy sessionmaker or engine
            tenant_id: Tenant that owns the workflow execution
            user: Account or EndUser used for creator attribution
            app_id: Application ID
            triggered_from: Source of the execution trigger

        Returns:
            Configured WorkflowExecutionRepository instance

        Raises:
            RepositoryImportError: If the configured repository cannot be created
        """
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
    def create_workflow_node_execution_repositories(
        cls,
        session_factory: sessionmaker[Session] | Engine,
        tenant_id: str,
        user: Account | EndUser,
        app_id: str,
        triggered_from: WorkflowNodeExecutionTriggeredFrom,
        *,
        file_uploads: FileUploadWriter,
    ) -> WorkflowNodeExecutionRepositories:
        """Assemble independent read/write ports, sharing pending Celery executions.

        Uploads are injected only into built-in writers. Configured third-party
        backends retain their original five constructor arguments and expose
        their read and write methods through the two ports on the same instance.
        """
        from core.repositories.celery_workflow_node_execution_query_repository import (
            CeleryWorkflowNodeExecutionCache,
            CeleryWorkflowNodeExecutionQueryRepository,
        )
        from core.repositories.celery_workflow_node_execution_write_repository import (
            CeleryWorkflowNodeExecutionWriteRepository,
        )
        from core.repositories.sqlalchemy_workflow_node_execution_query_repository import (
            SQLAlchemyWorkflowNodeExecutionQueryRepository,
        )
        from core.repositories.sqlalchemy_workflow_node_execution_write_repository import (
            SQLAlchemyWorkflowNodeExecutionWriteRepository,
        )
        from extensions.logstore.repositories.logstore_workflow_node_execution_query_repository import (
            LogstoreWorkflowNodeExecutionQueryRepository,
        )
        from extensions.logstore.repositories.logstore_workflow_node_execution_write_repository import (
            LogstoreWorkflowNodeExecutionWriteRepository,
        )

        class_path = dify_config.CORE_WORKFLOW_NODE_EXECUTION_REPOSITORY
        try:
            repository_class = import_string(class_path)
            if repository_class is CeleryWorkflowNodeExecutionWriteRepository:
                cache = CeleryWorkflowNodeExecutionCache()
                celery_writer = repository_class(
                    session_factory=session_factory,
                    tenant_id=tenant_id,
                    user=user,
                    app_id=app_id,
                    triggered_from=triggered_from,
                    file_uploads=file_uploads,
                    cache=cache,
                )
                return WorkflowNodeExecutionRepositories(
                    writer=celery_writer,
                    query=CeleryWorkflowNodeExecutionQueryRepository(
                        query=SQLAlchemyWorkflowNodeExecutionQueryRepository(
                            session_factory=session_factory, tenant_id=tenant_id, app_id=app_id
                        ),
                        cache=cache,
                    ),
                )
            if repository_class is SQLAlchemyWorkflowNodeExecutionWriteRepository:
                return WorkflowNodeExecutionRepositories(
                    writer=repository_class(
                        session_factory=session_factory,
                        tenant_id=tenant_id,
                        user=user,
                        app_id=app_id,
                        triggered_from=triggered_from,
                        file_uploads=file_uploads,
                    ),
                    query=SQLAlchemyWorkflowNodeExecutionQueryRepository(
                        session_factory=session_factory, tenant_id=tenant_id, app_id=app_id
                    ),
                )
            if repository_class is LogstoreWorkflowNodeExecutionWriteRepository:
                logstore_writer = repository_class(
                    session_factory=session_factory,
                    tenant_id=tenant_id,
                    user=user,
                    app_id=app_id,
                    triggered_from=triggered_from,
                    file_uploads=file_uploads,
                )
                return WorkflowNodeExecutionRepositories(
                    writer=logstore_writer,
                    query=LogstoreWorkflowNodeExecutionQueryRepository(
                        tenant_id=tenant_id, app_id=app_id, logstore_client=logstore_writer.logstore_client
                    ),
                )

            legacy_repository = repository_class(
                session_factory=session_factory,
                tenant_id=tenant_id,
                user=user,
                app_id=app_id,
                triggered_from=triggered_from,
            )
            return WorkflowNodeExecutionRepositories(writer=legacy_repository, query=legacy_repository)
        except Exception as error:
            raise RepositoryImportError(
                f"Failed to create workflow node execution repositories from '{class_path}': {error}"
            ) from error

    @classmethod
    def create_workflow_node_execution_query(
        cls,
        session_factory: sessionmaker[Session] | Engine,
        tenant_id: str,
        user: Account | EndUser,
        app_id: str,
        triggered_from: WorkflowNodeExecutionTriggeredFrom,
    ) -> WorkflowNodeExecutionQuery:
        """Create a reader without initializing any built-in writer or upload service.

        The user and trigger are retained solely for the original constructor
        contract of configured third-party backends.
        """
        from core.repositories.celery_workflow_node_execution_query_repository import (
            CeleryWorkflowNodeExecutionCache,
            CeleryWorkflowNodeExecutionQueryRepository,
        )
        from core.repositories.celery_workflow_node_execution_write_repository import (
            CeleryWorkflowNodeExecutionWriteRepository,
        )
        from core.repositories.sqlalchemy_workflow_node_execution_query_repository import (
            SQLAlchemyWorkflowNodeExecutionQueryRepository,
        )
        from core.repositories.sqlalchemy_workflow_node_execution_write_repository import (
            SQLAlchemyWorkflowNodeExecutionWriteRepository,
        )
        from extensions.logstore.repositories.logstore_workflow_node_execution_query_repository import (
            LogstoreWorkflowNodeExecutionQueryRepository,
        )
        from extensions.logstore.repositories.logstore_workflow_node_execution_write_repository import (
            LogstoreWorkflowNodeExecutionWriteRepository,
        )

        class_path = dify_config.CORE_WORKFLOW_NODE_EXECUTION_REPOSITORY
        try:
            repository_class = import_string(class_path)
            if repository_class is SQLAlchemyWorkflowNodeExecutionWriteRepository:
                return SQLAlchemyWorkflowNodeExecutionQueryRepository(
                    session_factory=session_factory, tenant_id=tenant_id, app_id=app_id
                )
            if repository_class is CeleryWorkflowNodeExecutionWriteRepository:
                return CeleryWorkflowNodeExecutionQueryRepository(
                    query=SQLAlchemyWorkflowNodeExecutionQueryRepository(
                        session_factory=session_factory, tenant_id=tenant_id, app_id=app_id
                    ),
                    cache=CeleryWorkflowNodeExecutionCache(),
                )
            if repository_class is LogstoreWorkflowNodeExecutionWriteRepository:
                return LogstoreWorkflowNodeExecutionQueryRepository(tenant_id=tenant_id, app_id=app_id)
            return repository_class(
                session_factory=session_factory,
                tenant_id=tenant_id,
                user=user,
                app_id=app_id,
                triggered_from=triggered_from,
            )
        except Exception as error:
            raise RepositoryImportError(
                f"Failed to create workflow node execution query from '{class_path}': {error}"
            ) from error
