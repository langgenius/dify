from .base import DocumentTaskProxyBase
from .batch_indexing_base import BatchDocumentIndexingProxy
from .document_indexing_task_proxy import DocumentIndexingTaskProxy
from .duplicate_document_indexing_task_proxy import DuplicateDocumentIndexingTaskProxy

__all__ = [
    "BatchDocumentIndexingProxy",
    "DocumentIndexingTaskProxy",
    "DocumentTaskProxyBase",
    "DuplicateDocumentIndexingTaskProxy",
]
