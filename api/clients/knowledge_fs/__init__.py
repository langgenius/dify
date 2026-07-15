"""Public API for the Dify-to-KnowledgeFS client boundary."""

from clients.knowledge_fs.client import (
    KnowledgeFSClient,
    OpenAPIKnowledgeFSClient,
)
from clients.knowledge_fs.errors import (
    KnowledgeFSConfigurationError,
    KnowledgeFSError,
    KnowledgeFSHTTPError,
    KnowledgeFSTimeoutError,
    KnowledgeFSTransportError,
    KnowledgeFSValidationError,
)
from clients.knowledge_fs.factory import create_knowledge_fs_client
from clients.knowledge_fs.generated.models import KnowledgeSpace, KnowledgeSpaceList

__all__ = [
    "KnowledgeFSClient",
    "KnowledgeFSConfigurationError",
    "KnowledgeFSError",
    "KnowledgeFSHTTPError",
    "KnowledgeFSTimeoutError",
    "KnowledgeFSTransportError",
    "KnowledgeFSValidationError",
    "KnowledgeSpace",
    "KnowledgeSpaceList",
    "OpenAPIKnowledgeFSClient",
    "create_knowledge_fs_client",
]
