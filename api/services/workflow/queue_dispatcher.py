"""
Queue dispatcher system for async workflow execution.

Implements an ABC-based pattern for handling different subscription tiers
with appropriate queue routing and priority assignment.
"""

from abc import ABC, abstractmethod
from enum import StrEnum

from configs import dify_config
from services.billing_service import BillingService


class QueuePriority(StrEnum):
    """Queue priorities for different subscription tiers"""

    PROFESSIONAL = "workflow_professional"  # Highest priority
    TEAM = "workflow_team"
    SANDBOX = "workflow_sandbox"  # Free tier


class BaseQueueDispatcher(ABC):
    """Abstract base class for queue dispatchers"""

    @abstractmethod
    def get_queue_name(self) -> str:
        """Get the queue name for this dispatcher"""
        pass

    @abstractmethod
    def get_priority(self) -> int:
        """Get task priority level"""
        pass


class ProfessionalQueueDispatcher(BaseQueueDispatcher):
    """Dispatcher for professional tier"""

    def get_queue_name(self) -> str:
        return QueuePriority.PROFESSIONAL

    def get_priority(self) -> int:
        return 100


class TeamQueueDispatcher(BaseQueueDispatcher):
    """Dispatcher for team tier"""

    def get_queue_name(self) -> str:
        return QueuePriority.TEAM

    def get_priority(self) -> int:
        return 50


class SandboxQueueDispatcher(BaseQueueDispatcher):
    """Dispatcher for free/sandbox tier"""

    def get_queue_name(self) -> str:
        return QueuePriority.SANDBOX

    def get_priority(self) -> int:
        return 10


class QueueDispatcherManager:
    """Factory for creating appropriate dispatcher based on tenant subscription"""

    # Mapping of billing plans to dispatchers
    PLAN_DISPATCHER_MAP = {
        "professional": ProfessionalQueueDispatcher,
        "team": TeamQueueDispatcher,
        "sandbox": SandboxQueueDispatcher,
        # Add new tiers here as they're created
        # For any unknown plan, default to sandbox
    }

    @classmethod
    def get_dispatcher(cls, tenant_id: str) -> BaseQueueDispatcher:
        """
        Get dispatcher based on tenant's subscription plan

        Args:
            tenant_id: The tenant identifier

        Returns:
            Appropriate queue dispatcher instance
        """
        if dify_config.BILLING_ENABLED:
            try:
                billing_info = BillingService.get_info(tenant_id)
                plan = billing_info.get("subscription", {}).get("plan", "sandbox")
            except Exception:
                # If billing service fails, default to sandbox
                plan = "sandbox"
        else:
            # If billing is disabled, use team tier as default
            plan = "team"

        dispatcher_class = cls.PLAN_DISPATCHER_MAP.get(
            plan,
            SandboxQueueDispatcher,  # Default to sandbox for unknown plans
        )

        return dispatcher_class()  # type: ignore
