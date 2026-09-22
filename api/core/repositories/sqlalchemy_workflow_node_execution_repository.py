"""Compatibility import for existing workflow node repository configuration paths."""

from core.repositories.sqlalchemy_workflow_node_execution_write_repository import (
    SQLAlchemyWorkflowNodeExecutionWriteRepository as SQLAlchemyWorkflowNodeExecutionRepository,
)

__all__ = ["SQLAlchemyWorkflowNodeExecutionRepository"]
