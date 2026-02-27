import logging
from collections.abc import Callable, Sequence
from dataclasses import asdict
from typing import Any

from core.entities.document_task import DocumentTask
from core.rag.pipeline.queue import TenantIsolatedTaskQueue

from .base import DocumentTaskProxyBase

logger = logging.getLogger(__name__)


class BatchDocumentIndexingProxy(DocumentTaskProxyBase):
    """
    Base proxy for batch document indexing tasks (document_ids in plural).

    Adds:
    - Tenant isolated queue management
    - Batch document handling
    """

    def __init__(self, tenant_id: str, dataset_id: str, document_ids: Sequence[str]):
        """
        Initialize with batch documents.

        Args:
            tenant_id: Tenant identifier
            dataset_id: Dataset identifier
            document_ids: List of document IDs to process
        """
        super().__init__(tenant_id, dataset_id)
        self._document_ids = document_ids
        self._tenant_isolated_task_queue = TenantIsolatedTaskQueue(tenant_id, self.QUEUE_NAME)

    def _send_to_direct_queue(self, task_func: Callable[[str, str, Sequence[str]], Any]):
        """
        Send batch task to direct queue.

        Args:
            task_func: The Celery task function to call with (tenant_id, dataset_id, document_ids)
        """
        logger.info("tenant %s send documents %s to direct queue", self._tenant_id, self._document_ids)
        task_func.delay(  # type: ignore
            tenant_id=self._tenant_id, dataset_id=self._dataset_id, document_ids=self._document_ids
        )

    def _send_to_tenant_queue(self, task_func: Callable[[str, str, Sequence[str]], Any]):
        """
        Send batch task to tenant-isolated queue.

        Args:
            task_func: The Celery task function to call with (tenant_id, dataset_id, document_ids)
        """
        logger.info(
            "tenant %s send documents %s to tenant queue %s", self._tenant_id, self._document_ids, self.QUEUE_NAME
        )
        if self._tenant_isolated_task_queue.get_task_key():
            # Add to waiting queue using List operations (lpush)
            self._tenant_isolated_task_queue.push_tasks(
                [
                    asdict(
                        DocumentTask(
                            tenant_id=self._tenant_id, dataset_id=self._dataset_id, document_ids=self._document_ids
                        )
                    )
                ]
            )
            logger.info("tenant %s push tasks: %s - %s", self._tenant_id, self._dataset_id, self._document_ids)
        else:
            # Set flag and execute task
            self._tenant_isolated_task_queue.set_task_waiting_time()
            task_func.delay(  # type: ignore
                tenant_id=self._tenant_id, dataset_id=self._dataset_id, document_ids=self._document_ids
            )
            logger.info("tenant %s init tasks: %s - %s", self._tenant_id, self._dataset_id, self._document_ids)
