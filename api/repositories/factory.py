"""
DifyAPI Repository Factory for creating repository instances.

This factory is specifically designed for DifyAPI repositories that handle
service-layer operations with dependency injection patterns.
"""

import logging

from sqlalchemy.orm import sessionmaker

from configs import dify_config
from core.repositories import DifyCoreRepositoryFactory, RepositoryImportError
from repositories.api_workflow_node_execution_repository import DifyAPIWorkflowNodeExecutionRepository
from repositories.api_workflow_run_repository import APIWorkflowRunRepository

logger = logging.getLogger(__name__)


class DifyAPIRepositoryFactory(DifyCoreRepositoryFactory):
    """
    Factory for creating DifyAPI repository instances based on configuration.

    This factory handles the creation of repositories that are specifically designed
    for service-layer operations and use dependency injection with sessionmaker
    for better testability and separation of concerns.
    """

    @classmethod
    def create_api_workflow_node_execution_repository(
        cls, session_maker: sessionmaker
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
        logger.debug(f"Creating DifyAPIWorkflowNodeExecutionRepository from: {class_path}")

        try:
            repository_class = cls._import_class(class_path)
            cls._validate_repository_interface(repository_class, DifyAPIWorkflowNodeExecutionRepository)
            # Service repository requires session_maker parameter
            cls._validate_constructor_signature(repository_class, ["session_maker"])

            return repository_class(session_maker=session_maker)  # type: ignore[no-any-return]
        except RepositoryImportError:
            # Re-raise our custom errors as-is
            raise
        except Exception as e:
            logger.exception("Failed to create DifyAPIWorkflowNodeExecutionRepository")
            raise RepositoryImportError(
                f"Failed to create DifyAPIWorkflowNodeExecutionRepository from '{class_path}': {e}"
            ) from e

    @classmethod
    def create_api_workflow_run_repository(cls, session_maker: sessionmaker) -> APIWorkflowRunRepository:
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
        logger.debug(f"Creating APIWorkflowRunRepository from: {class_path}")

        try:
            repository_class = cls._import_class(class_path)
            cls._validate_repository_interface(repository_class, APIWorkflowRunRepository)
            # Service repository requires session_maker parameter
            cls._validate_constructor_signature(repository_class, ["session_maker"])

            return repository_class(session_maker=session_maker)  # type: ignore[no-any-return]
        except RepositoryImportError:
            # Re-raise our custom errors as-is
            raise
        except Exception as e:
            logger.exception("Failed to create APIWorkflowRunRepository")
            raise RepositoryImportError(f"Failed to create APIWorkflowRunRepository from '{class_path}': {e}") from e
