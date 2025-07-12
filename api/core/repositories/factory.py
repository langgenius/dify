"""
Repository factory for dynamically creating repository instances based on configuration.

This module provides a Django-like settings system for repository implementations,
allowing users to configure different repository backends through string paths.
"""

import importlib
import inspect
import logging
from typing import Protocol, Union

from sqlalchemy.engine import Engine
from sqlalchemy.orm import sessionmaker

from configs import dify_config
from core.workflow.repositories.workflow_execution_repository import WorkflowExecutionRepository
from core.workflow.repositories.workflow_node_execution_repository import WorkflowNodeExecutionRepository
from models import Account, EndUser
from models.enums import WorkflowRunTriggeredFrom
from models.workflow import WorkflowNodeExecutionTriggeredFrom

logger = logging.getLogger(__name__)


class RepositoryImportError(Exception):
    """Raised when a repository implementation cannot be imported or instantiated."""

    pass


class DifyCoreRepositoryFactory:
    """
    Factory for creating repository instances based on configuration.

    This factory supports Django-like settings where repository implementations
    are specified as module paths (e.g., 'module.submodule.ClassName').
    """

    @staticmethod
    def _import_class(class_path: str) -> type:
        """
        Import a class from a module path string.

        Args:
            class_path: Full module path to the class (e.g., 'module.submodule.ClassName')

        Returns:
            The imported class

        Raises:
            RepositoryImportError: If the class cannot be imported
        """
        try:
            module_path, class_name = class_path.rsplit(".", 1)
            module = importlib.import_module(module_path)
            repo_class = getattr(module, class_name)
            assert isinstance(repo_class, type)
            return repo_class
        except (ValueError, ImportError, AttributeError) as e:
            raise RepositoryImportError(f"Cannot import repository class '{class_path}': {e}") from e

    @staticmethod
    def _validate_repository_interface(repository_class: type, expected_interface: type[Protocol]) -> None:  # type: ignore
        """
        Validate that a class implements the expected repository interface.

        Args:
            repository_class: The class to validate
            expected_interface: The expected interface/protocol

        Raises:
            RepositoryImportError: If the class doesn't implement the interface
        """
        # Check if the class has all required methods from the protocol
        required_methods = [
            method
            for method in dir(expected_interface)
            if not method.startswith("_") and callable(getattr(expected_interface, method, None))
        ]

        missing_methods = []
        for method_name in required_methods:
            if not hasattr(repository_class, method_name):
                missing_methods.append(method_name)

        if missing_methods:
            raise RepositoryImportError(
                f"Repository class '{repository_class.__name__}' does not implement required methods "
                f"{missing_methods} from interface '{expected_interface.__name__}'"
            )

    @staticmethod
    def _validate_constructor_signature(repository_class: type, required_params: list[str]) -> None:
        """
        Validate that a repository class constructor accepts required parameters.

        Args:
            repository_class: The class to validate
            required_params: List of required parameter names

        Raises:
            RepositoryImportError: If the constructor doesn't accept required parameters
        """

        try:
            # MyPy may flag the line below with the following error:
            #
            # > Accessing "__init__" on an instance is unsound, since
            # > instance.__init__ could be from an incompatible subclass.
            #
            # Despite this, we need to ensure that the constructor of `repository_class`
            # has a compatible signature.
            signature = inspect.signature(repository_class.__init__)  # type: ignore[misc]
            param_names = list(signature.parameters.keys())

            # Remove 'self' parameter
            if "self" in param_names:
                param_names.remove("self")

            missing_params = [param for param in required_params if param not in param_names]
            if missing_params:
                raise RepositoryImportError(
                    f"Repository class '{repository_class.__name__}' constructor does not accept required parameters: "
                    f"{missing_params}. Expected parameters: {required_params}"
                )
        except Exception as e:
            raise RepositoryImportError(
                f"Failed to validate constructor signature for '{repository_class.__name__}': {e}"
            ) from e

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
        logger.debug(f"Creating WorkflowExecutionRepository from: {class_path}")

        try:
            repository_class = cls._import_class(class_path)
            cls._validate_repository_interface(repository_class, WorkflowExecutionRepository)
            cls._validate_constructor_signature(
                repository_class, ["session_factory", "user", "app_id", "triggered_from"]
            )

            return repository_class(  # type: ignore[no-any-return]
                session_factory=session_factory,
                user=user,
                app_id=app_id,
                triggered_from=triggered_from,
            )
        except RepositoryImportError:
            # Re-raise our custom errors as-is
            raise
        except Exception as e:
            logger.exception("Failed to create WorkflowExecutionRepository")
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
        logger.debug(f"Creating WorkflowNodeExecutionRepository from: {class_path}")

        try:
            repository_class = cls._import_class(class_path)
            cls._validate_repository_interface(repository_class, WorkflowNodeExecutionRepository)
            cls._validate_constructor_signature(
                repository_class, ["session_factory", "user", "app_id", "triggered_from"]
            )

            return repository_class(  # type: ignore[no-any-return]
                session_factory=session_factory,
                user=user,
                app_id=app_id,
                triggered_from=triggered_from,
            )
        except RepositoryImportError:
            # Re-raise our custom errors as-is
            raise
        except Exception as e:
            logger.exception("Failed to create WorkflowNodeExecutionRepository")
            raise RepositoryImportError(
                f"Failed to create WorkflowNodeExecutionRepository from '{class_path}': {e}"
            ) from e
