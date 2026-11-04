from collections.abc import Callable
from typing import Any, ClassVar

from services.document_indexing_proxy.batch_indexing_base import BatchDocumentIndexingProxy
from tasks.document_indexing_task import normal_document_indexing_task, priority_document_indexing_task


class DocumentIndexingTaskProxy(BatchDocumentIndexingProxy):
    """Proxy for document indexing tasks."""

    QUEUE_NAME: ClassVar[str] = "document_indexing"
    NORMAL_TASK_FUNC: ClassVar[Callable[..., Any]] = normal_document_indexing_task  # pyrefly: ignore
    PRIORITY_TASK_FUNC: ClassVar[Callable[..., Any]] = priority_document_indexing_task  # pyrefly: ignore
