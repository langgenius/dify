"""
Registry for repository implementations.

This module is responsible for registering factory functions with the repository factory.
"""

import logging
from collections.abc import Mapping
from typing import Any

from configs import dify_config
from core.repository.repository_factory import RepositoryFactory
from repositories.workflow_node_execution import SQLAlchemyWorkflowNodeExecutionRepository

logger = logging.getLogger(__name__)

# Repository type constants
WORKFLOW_NODE_EXECUTION_REPOSITORY = "workflow_node_execution"

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
        logger.info(f"Registering {WORKFLOW_NODE_EXECUTION_REPOSITORY} with RDBMS storage")
        RepositoryFactory.register_factory(
            WORKFLOW_NODE_EXECUTION_REPOSITORY, create_workflow_node_execution_repository
        )
    elif workflow_node_execution_storage == STORAGE_TYPE_HYBRID:
        # Hybrid storage is not yet implemented
        raise NotImplementedError(f"Hybrid storage for {WORKFLOW_NODE_EXECUTION_REPOSITORY} is not yet implemented")
    else:
        # Unknown storage type
        raise ValueError(
            f"Unknown storage type '{workflow_node_execution_storage}' for {WORKFLOW_NODE_EXECUTION_REPOSITORY}. "
            f"Supported types: {STORAGE_TYPE_RDBMS}"
        )


def create_workflow_node_execution_repository(params: Mapping[str, Any]) -> SQLAlchemyWorkflowNodeExecutionRepository:
    """
    Create a WorkflowNodeExecutionRepository instance using SQLAlchemy implementation.

    This factory function creates a repository for the RDBMS storage type.

    Args:
        params: Parameters for creating the repository

    Returns:
        A WorkflowNodeExecutionRepository instance

    Raises:
        ValueError: If required parameters are missing
    """
    # Extract required parameters
    session = params.get("session")
    if session is None:
        raise ValueError(
            f"Session is required for {WORKFLOW_NODE_EXECUTION_REPOSITORY} with {STORAGE_TYPE_RDBMS} storage"
        )

    tenant_id = params.get("tenant_id")
    if tenant_id is None:
        raise ValueError(
            f"tenant_id is required for {WORKFLOW_NODE_EXECUTION_REPOSITORY} with {STORAGE_TYPE_RDBMS} storage"
        )

    # Extract optional parameters
    app_id = params.get("app_id")

    # Create and return the repository
    return SQLAlchemyWorkflowNodeExecutionRepository(session=session, tenant_id=tenant_id, app_id=app_id)
