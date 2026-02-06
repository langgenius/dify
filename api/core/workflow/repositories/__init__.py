"""
Repository interfaces for data access.

This package contains repository interfaces that define the contract
for accessing and manipulating data, regardless of the underlying
storage mechanism.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from core.workflow.repositories.workflow_node_execution_repository import (
        OrderConfig,
        WorkflowNodeExecutionRepository,
    )

__all__ = [
    "OrderConfig",
    "WorkflowNodeExecutionRepository",
]


def __getattr__(name: str) -> Any:
    if name in {"OrderConfig", "WorkflowNodeExecutionRepository"}:
        from core.workflow.repositories.workflow_node_execution_repository import (
            OrderConfig,
            WorkflowNodeExecutionRepository,
        )

        return {
            "OrderConfig": OrderConfig,
            "WorkflowNodeExecutionRepository": WorkflowNodeExecutionRepository,
        }[name]
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
