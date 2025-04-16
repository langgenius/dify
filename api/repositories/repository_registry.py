"""
Registry for repository implementations.

This module is responsible for registering factory functions with the repository factory.
"""

import logging
from collections.abc import Mapping
from typing import Any

from sqlalchemy.orm import sessionmaker

from configs import dify_config
from core.repository.repository_factory import RepositoryFactory
from extensions.ext_database import db
from repositories.workflow_node_execution import SQLAlchemyWorkflowNodeExecutionRepository

logger = logging.getLogger(__name__)

# Storage type constants
STORAGE_TYPE_RDBMS = "rdbms"
STORAGE_TYPE_HYBRID = "hybrid"


def register_repositories() -> None:
    """
    Register repository factory functions with the RepositoryFactory.

    This function reads configuration settings to determine which repository
    implementations to register.
    """
    # Configure WorkflowNodeExecutionRepository factory based on configuration
    workflow_node_execution_storage = dify_config.WORKFLOW_NODE_EXECUTION_STORAGE

    # Check storage type and register appropriate implementation
    if workflow_node_execution_storage == STORAGE_TYPE_RDBMS:
        # Register SQLAlchemy implementation for RDBMS storage
        logger.info("Registering WorkflowNodeExecution repository with RDBMS storage")
        RepositoryFactory.register_workflow_node_execution_factory(create_workflow_node_execution_repository)
    elif workflow_node_execution_storage == STORAGE_TYPE_HYBRID:
        # Hybrid storage is not yet implemented
        raise NotImplementedError("Hybrid storage for WorkflowNodeExecution repository is not yet implemented")
    else:
        # Unknown storage type
        raise ValueError(
            f"Unknown storage type '{workflow_node_execution_storage}' for WorkflowNodeExecution repository. "
            f"Supported types: {STORAGE_TYPE_RDBMS}"
        )


def create_workflow_node_execution_repository(params: Mapping[str, Any]) -> SQLAlchemyWorkflowNodeExecutionRepository:
    """
    Create a WorkflowNodeExecutionRepository instance using SQLAlchemy implementation.

    This factory function creates a repository for the RDBMS storage type.

    Args:
        params: Parameters for creating the repository, including:
            - tenant_id: Required. The tenant ID for multi-tenancy.
            - app_id: Optional. The application ID for filtering.
            - session_factory: Optional. A SQLAlchemy sessionmaker instance. If not provided,
              a new sessionmaker will be created using the global database engine.

    Returns:
        A WorkflowNodeExecutionRepository instance

    Raises:
        ValueError: If required parameters are missing
    """
    # Extract required parameters
    tenant_id = params.get("tenant_id")
    if tenant_id is None:
        raise ValueError("tenant_id is required for WorkflowNodeExecution repository with RDBMS storage")

    # Extract optional parameters
    app_id = params.get("app_id")

    # Use the session_factory from params if provided, otherwise create one using the global db engine
    session_factory = params.get("session_factory")
    if session_factory is None:
        # Create a sessionmaker using the same engine as the global db session
        session_factory = sessionmaker(bind=db.engine)

    # Create and return the repository
    return SQLAlchemyWorkflowNodeExecutionRepository(
        session_factory=session_factory, tenant_id=tenant_id, app_id=app_id
    )
