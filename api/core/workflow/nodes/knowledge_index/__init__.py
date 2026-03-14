from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from .knowledge_index_node import KnowledgeIndexNode

__all__ = ["KnowledgeIndexNode"]


def __getattr__(name: str) -> Any:
    if name == "KnowledgeIndexNode":
        from .knowledge_index_node import KnowledgeIndexNode

        return KnowledgeIndexNode
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
