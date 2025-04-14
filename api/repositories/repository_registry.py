"""
Registry for repository implementations.

This module is responsible for registering factory functions with the repository factory.
"""

import logging

from configs import dify_config

logger = logging.getLogger(__name__)


def register_repositories() -> None:
    """
    Register repository factory functions with the RepositoryFactory.

    This function reads configuration settings to determine which repository
    implementations to register.
    """
    # Configure WorkflowNodeExecutionRepository factory
    workflow_node_execution_storage = dify_config.WORKFLOW_NODE_EXECUTION_STORAGE
