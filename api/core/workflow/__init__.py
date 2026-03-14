from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from .node_factory import DifyNodeFactory
    from .workflow_entry import WorkflowEntry

__all__ = ["DifyNodeFactory", "WorkflowEntry"]


def __getattr__(name: str) -> Any:
    if name == "DifyNodeFactory":
        from .node_factory import DifyNodeFactory

        return DifyNodeFactory
    if name == "WorkflowEntry":
        from .workflow_entry import WorkflowEntry

        return WorkflowEntry
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
