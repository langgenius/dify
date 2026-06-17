from collections.abc import Callable
from typing import Any, ClassVar

from services.document_indexing_proxy.batch_indexing_base import BatchDocumentIndexingProxy
from tasks.duplicate_document_indexing_task import (
    normal_duplicate_document_indexing_task,
    priority_duplicate_document_indexing_task,
)

TaskFunc = Callable[..., Any]


class DuplicateDocumentIndexingTaskProxy(BatchDocumentIndexingProxy):
    """Proxy for duplicate document indexing tasks."""

    QUEUE_NAME: ClassVar[str] = "duplicate_document_indexing"
    NORMAL_TASK_FUNC: ClassVar[TaskFunc] = normal_duplicate_document_indexing_task  # pyrefly: ignore
    PRIORITY_TASK_FUNC: ClassVar[TaskFunc] = priority_duplicate_document_indexing_task  # pyrefly: ignore
