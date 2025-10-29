import logging
from collections.abc import Callable
from dataclasses import asdict
from functools import cached_property

from core.entities.document_task import DocumentTask
from core.rag.pipeline.queue import TenantSelfTaskQueue
from services.feature_service import FeatureService
from tasks.document_indexing_task import normal_document_indexing_task, priority_document_indexing_task

logger = logging.getLogger(__name__)


class DocumentIndexingTaskProxy:
    def __init__(self, tenant_id: str, dataset_id: str, document_ids: list[str]):
        self.tenant_id = tenant_id
        self.dataset_id = dataset_id
        self.document_ids = document_ids
        self.tenant_self_task_queue = TenantSelfTaskQueue(tenant_id, "document_indexing")

    @cached_property
    def features(self):
        return FeatureService.get_features(self.tenant_id)

    def _send_to_direct_queue(self, task_func: Callable):
        logger.info("send dataset %s to direct queue", self.dataset_id)
        task_func.delay(  # type: ignore
            tenant_id=self.tenant_id, dataset_id=self.dataset_id, document_ids=self.document_ids
        )

    def _send_to_tenant_queue(self, task_func: Callable):
        logger.info("send dataset %s to tenant queue", self.dataset_id)
        if self.tenant_self_task_queue.get_task_key():
            # Add to waiting queue using List operations (lpush)
            self.tenant_self_task_queue.push_tasks(
                [
                    asdict(
                        DocumentTask(
                            tenant_id=self.tenant_id, dataset_id=self.dataset_id, document_ids=self.document_ids
                        )
                    )
                ]
            )
            logger.info("push tasks: %s - %s", self.dataset_id, self.document_ids)
        else:
            # Set flag and execute task
            self.tenant_self_task_queue.set_task_waiting_time()
            task_func.delay(  # type: ignore
                tenant_id=self.tenant_id, dataset_id=self.dataset_id, document_ids=self.document_ids
            )
            logger.info("init tasks: %s - %s", self.dataset_id, self.document_ids)

    def _send_to_default_tenant_queue(self):
        self._send_to_tenant_queue(normal_document_indexing_task)

    def _send_to_priority_tenant_queue(self):
        self._send_to_tenant_queue(priority_document_indexing_task)

    def _send_to_priority_direct_queue(self):
        self._send_to_direct_queue(priority_document_indexing_task)

    def _dispatch(self):
        logger.info(
            "dispatch args: %s - %s - %s",
            self.tenant_id,
            self.features.billing.enabled,
            self.features.billing.subscription.plan,
        )
        # dispatch to different indexing queue with tenant isolation when billing enabled
        if self.features.billing.enabled:
            if self.features.billing.subscription.plan == "sandbox":
                # dispatch to normal pipeline queue with tenant self sub queue for sandbox plan
                self._send_to_default_tenant_queue()
            else:
                # dispatch to priority pipeline queue with tenant self sub queue for other plans
                self._send_to_priority_tenant_queue()
        else:
            # dispatch to priority queue without tenant isolation for others, e.g.: self-hosted or enterprise
            self._send_to_priority_direct_queue()

    def delay(self):
        self._dispatch()
