"""Compatibility import for existing workflow node repository configuration paths."""

from extensions.logstore.repositories.logstore_workflow_node_execution_write_repository import (
    LogstoreWorkflowNodeExecutionWriteRepository as LogstoreWorkflowNodeExecutionRepository,
)

__all__ = ["LogstoreWorkflowNodeExecutionRepository"]
