from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from .knowledge_retrieval_node import KnowledgeRetrievalNode

__all__ = ["KnowledgeRetrievalNode"]


def __getattr__(name: str) -> Any:
    if name == "KnowledgeRetrievalNode":
        from .knowledge_retrieval_node import KnowledgeRetrievalNode

        return KnowledgeRetrievalNode
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
