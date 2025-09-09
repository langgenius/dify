"""
ExecutionContext value object containing immutable execution parameters.
"""

from dataclasses import dataclass

from core.app.entities.app_invoke_entities import InvokeFrom
from models.enums import UserFrom


@dataclass(frozen=True)
class ExecutionContext:
    """
    Immutable value object containing the context for a graph execution.

    This encapsulates all the contextual information needed to execute a workflow,
    keeping it separate from the mutable execution state.
    """

    tenant_id: str
    app_id: str
    workflow_id: str
    user_id: str
    user_from: UserFrom
    invoke_from: InvokeFrom
    call_depth: int

    def __post_init__(self) -> None:
        """Validate execution context parameters."""
        if self.call_depth < 0:
            raise ValueError("Call depth must be non-negative")
