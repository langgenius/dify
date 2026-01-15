"""
Repository factory for dynamically creating repository instances based on configuration.

This module provides a Django-like settings system for repository implementations,
allowing users to configure different repository backends through string paths.
"""

from typing import Union

from sqlalchemy.engine import Engine
from sqlalchemy.orm import sessionmaker

from configs import dify_config
from core.workflow.repositories.workflow_execution_repository import WorkflowExecutionRepository
from core.workflow.repositories.workflow_node_execution_repository import WorkflowNodeExecutionRepository
from libs.module_loading import import_string
from models import Account, EndUser
from models.enums import WorkflowRunTriggeredFrom
from models.workflow import WorkflowNodeExecutionTriggeredFrom


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
        session_factory: Union[sessionmaker, Engine],
        user: Union[Account, EndUser],
        app_id: str,
        triggered_from: WorkflowRunTriggeredFrom,
    ) -> WorkflowExecutionRepository:
        """
        Create a WorkflowExecutionRepository instance based on configuration.

        Args:
            session_factory: SQLAlchemy sessionmaker or engine
            user: Account or EndUser object
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
                user=user,
                app_id=app_id,
                triggered_from=triggered_from,
            )
        except (ImportError, Exception) as e:
            raise RepositoryImportError(f"Failed to create WorkflowExecutionRepository from '{class_path}': {e}") from e

    @classmethod
    def create_workflow_node_execution_repository(
        cls,
        session_factory: Union[sessionmaker, Engine],
        user: Union[Account, EndUser],
        app_id: str,
        triggered_from: WorkflowNodeExecutionTriggeredFrom,
    ) -> WorkflowNodeExecutionRepository:
        """
        Create a WorkflowNodeExecutionRepository instance based on configuration.

        Args:
            session_factory: SQLAlchemy sessionmaker or engine
            user: Account or EndUser object
            app_id: Application ID
            triggered_from: Source of the execution trigger

        Returns:
            Configured WorkflowNodeExecutionRepository instance

        Raises:
            RepositoryImportError: If the configured repository cannot be created
        """
        class_path = dify_config.CORE_WORKFLOW_NODE_EXECUTION_REPOSITORY

        try:
            repository_class = import_string(class_path)
            return repository_class(
                session_factory=session_factory,
                user=user,
                app_id=app_id,
                triggered_from=triggered_from,
            )
        except (ImportError, Exception) as e:
            raise RepositoryImportError(
                f"Failed to create WorkflowNodeExecutionRepository from '{class_path}': {e}"
            ) from e
