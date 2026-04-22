from typing import ClassVar

from services.document_indexing_proxy.batch_indexing_base import BatchDocumentIndexingProxy
from tasks.document_indexing_task import normal_document_indexing_task, priority_document_indexing_task


class DocumentIndexingTaskProxy(BatchDocumentIndexingProxy):
    """Proxy for document indexing tasks."""

    QUEUE_NAME: ClassVar[str] = "document_indexing"
    # pyrefly: ignore [bad-override]
    NORMAL_TASK_FUNC = normal_document_indexing_task
    # pyrefly: ignore [bad-override]
    PRIORITY_TASK_FUNC = priority_document_indexing_task
