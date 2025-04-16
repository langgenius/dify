"""
Repository interfaces for data access.

This package contains repository interfaces that define the contract
for accessing and manipulating data, regardless of the underlying
storage mechanism.
"""

from core.repository.repository_factory import RepositoryFactory
from core.repository.workflow_node_execution_repository import WorkflowNodeExecutionRepository

__all__ = [
    "RepositoryFactory",
    "WorkflowNodeExecutionRepository",
]
