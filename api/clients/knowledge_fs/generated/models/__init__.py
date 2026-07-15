"""Contains all the data models used in inputs/outputs"""

from .create_knowledge_space import CreateKnowledgeSpace
from .error_response import ErrorResponse
from .knowledge_space import KnowledgeSpace
from .knowledge_space_list import KnowledgeSpaceList

__all__ = (
    "CreateKnowledgeSpace",
    "ErrorResponse",
    "KnowledgeSpace",
    "KnowledgeSpaceList",
)
