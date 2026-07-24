import logging
from abc import ABC, abstractmethod
from collections.abc import Callable
from functools import cached_property
from typing import Any, ClassVar

from enums.cloud_plan import CloudPlan
from services.feature_service import FeatureService

logger = logging.getLogger(__name__)


class DocumentTaskProxyBase(ABC):
    """
    Base proxy for all document processing tasks.

    Handles common logic:
    - Feature/billing checks
    - Dispatch routing based on plan

    Subclasses must define:
    - QUEUE_NAME: Redis queue identifier
    - NORMAL_TASK_FUNC: Task function for normal priority
    - PRIORITY_TASK_FUNC: Task function for high priority
    """

    QUEUE_NAME: ClassVar[str]
    NORMAL_TASK_FUNC: ClassVar[Callable[..., Any]]
    PRIORITY_TASK_FUNC: ClassVar[Callable[..., Any]]

    def __init__(self, tenant_id: str, dataset_id: str):
        """
        Initialize with minimal required parameters.

        Args:
            tenant_id: Tenant identifier for billing/features
            dataset_id: Dataset identifier for logging
        """
        self._tenant_id = tenant_id
        self._dataset_id = dataset_id

    @cached_property
    def features(self):
        return FeatureService.get_features(self._tenant_id)

    @abstractmethod
    def _send_to_direct_queue(self, task_func: Callable[..., Any]):
        """
        Send task directly to Celery queue without tenant isolation.

        Subclasses implement this to pass task-specific parameters.

        Args:
            task_func: The Celery task function to call
        """
        pass

    @abstractmethod
    def _send_to_tenant_queue(self, task_func: Callable[..., Any]):
        """
        Send task to tenant-isolated queue.

        Subclasses implement this to handle queue management.

        Args:
            task_func: The Celery task function to call
        """
        pass

    def _send_to_default_tenant_queue(self):
        """Route to normal priority with tenant isolation."""
        self._send_to_tenant_queue(self.NORMAL_TASK_FUNC)

    def _send_to_priority_tenant_queue(self):
        """Route to priority queue with tenant isolation."""
        self._send_to_tenant_queue(self.PRIORITY_TASK_FUNC)

    def _send_to_priority_direct_queue(self):
        """Route to priority queue without tenant isolation."""
        self._send_to_direct_queue(self.PRIORITY_TASK_FUNC)

    def _dispatch(self):
        """
        Dispatch task based on billing plan.

        Routing logic:
        - Sandbox plan → normal queue + tenant isolation
        - Paid plans → priority queue + tenant isolation
        - Self-hosted → priority queue, no isolation
        """
        logger.info(
            "dispatch args: %s - %s - %s",
            self._tenant_id,
            self.features.billing.enabled,
            self.features.billing.subscription.plan,
        )
        # dispatch to different indexing queue with tenant isolation when billing enabled
        if self.features.billing.enabled:
            if self.features.billing.subscription.plan == CloudPlan.SANDBOX:
                # dispatch to normal pipeline queue with tenant self sub queue for sandbox plan
                self._send_to_default_tenant_queue()
            else:
                # dispatch to priority pipeline queue with tenant self sub queue for other plans
                self._send_to_priority_tenant_queue()
        else:
            # dispatch to priority queue without tenant isolation for others, e.g.: self-hosted or enterprise
            self._send_to_priority_direct_queue()

    def delay(self):
        """Public API: Queue the task asynchronously."""
        self._dispatch()
