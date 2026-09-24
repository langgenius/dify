"""Compatibility import for existing workflow node repository configuration paths."""

from core.repositories.celery_workflow_node_execution_write_repository import (
    CeleryWorkflowNodeExecutionWriteRepository as CeleryWorkflowNodeExecutionRepository,
)

__all__ = ["CeleryWorkflowNodeExecutionRepository"]
