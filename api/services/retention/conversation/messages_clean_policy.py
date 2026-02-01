import datetime
import logging
from abc import ABC, abstractmethod
from collections.abc import Callable, Sequence
from dataclasses import dataclass

from configs import dify_config
from enums.cloud_plan import CloudPlan
from services.billing_service import BillingService, SubscriptionPlan

logger = logging.getLogger(__name__)


@dataclass
class SimpleMessage:
    id: str
    app_id: str
    created_at: datetime.datetime


class MessagesCleanPolicy(ABC):
    """
    Abstract base class for message cleanup policies.

    A policy determines which messages from a batch should be deleted.
    """

    @abstractmethod
    def filter_message_ids(
        self,
        messages: Sequence[SimpleMessage],
        app_to_tenant: dict[str, str],
    ) -> Sequence[str]:
        """
        Filter messages and return IDs of messages that should be deleted.

        Args:
            messages: Batch of messages to evaluate
            app_to_tenant: Mapping from app_id to tenant_id

        Returns:
            List of message IDs that should be deleted
        """
        ...


class BillingDisabledPolicy(MessagesCleanPolicy):
    """
    Policy for community or enterpriseedition (billing disabled).

    No special filter logic, just return all message ids.
    """

    def filter_message_ids(
        self,
        messages: Sequence[SimpleMessage],
        app_to_tenant: dict[str, str],
    ) -> Sequence[str]:
        return [msg.id for msg in messages]


class BillingSandboxPolicy(MessagesCleanPolicy):
    """
    Policy for sandbox plan tenants in cloud edition (billing enabled).

    Filters messages based on sandbox plan expiration rules:
    - Skip tenants in the whitelist
    - Only delete messages from sandbox plan tenants
    - Respect grace period after subscription expiration
    - Safe default: if tenant mapping or plan is missing, do NOT delete
    """

    def __init__(
        self,
        plan_provider: Callable[[Sequence[str]], dict[str, SubscriptionPlan]],
        graceful_period_days: int = 21,
        tenant_whitelist: Sequence[str] | None = None,
        current_timestamp: int | None = None,
    ) -> None:
        self._graceful_period_days = graceful_period_days
        self._tenant_whitelist: Sequence[str] = tenant_whitelist or []
        self._plan_provider = plan_provider
        self._current_timestamp = current_timestamp

    def filter_message_ids(
        self,
        messages: Sequence[SimpleMessage],
        app_to_tenant: dict[str, str],
    ) -> Sequence[str]:
        """
        Filter messages based on sandbox plan expiration rules.

        Args:
            messages: Batch of messages to evaluate
            app_to_tenant: Mapping from app_id to tenant_id

        Returns:
            List of message IDs that should be deleted
        """
        if not messages or not app_to_tenant:
            return []

        # Get unique tenant_ids and fetch subscription plans
        tenant_ids = list(set(app_to_tenant.values()))
        tenant_plans = self._plan_provider(tenant_ids)

        if not tenant_plans:
            return []

        # Apply sandbox deletion rules
        return self._filter_expired_sandbox_messages(
            messages=messages,
            app_to_tenant=app_to_tenant,
            tenant_plans=tenant_plans,
        )

    def _filter_expired_sandbox_messages(
        self,
        messages: Sequence[SimpleMessage],
        app_to_tenant: dict[str, str],
        tenant_plans: dict[str, SubscriptionPlan],
    ) -> list[str]:
        """
        Filter messages that should be deleted based on sandbox plan expiration.

        A message should be deleted if:
        1. It belongs to a sandbox tenant AND
        2. Either:
           a) The tenant has no previous subscription (expiration_date == -1), OR
           b) The subscription expired more than graceful_period_days ago

        Args:
            messages: List of message objects with id and app_id attributes
            app_to_tenant: Mapping from app_id to tenant_id
            tenant_plans: Mapping from tenant_id to subscription plan info

        Returns:
            List of message IDs that should be deleted
        """
        current_timestamp = self._current_timestamp
        if current_timestamp is None:
            current_timestamp = int(datetime.datetime.now(datetime.UTC).timestamp())

        sandbox_message_ids: list[str] = []
        graceful_period_seconds = self._graceful_period_days * 24 * 60 * 60

        for msg in messages:
            # Get tenant_id for this message's app
            tenant_id = app_to_tenant.get(msg.app_id)
            if not tenant_id:
                continue

            # Skip tenant messages in whitelist
            if tenant_id in self._tenant_whitelist:
                continue

            # Get subscription plan for this tenant
            tenant_plan = tenant_plans.get(tenant_id)
            if not tenant_plan:
                continue

            plan = str(tenant_plan["plan"])
            expiration_date = int(tenant_plan["expiration_date"])

            # Only process sandbox plans
            if plan != CloudPlan.SANDBOX:
                continue

            # Case 1: No previous subscription (-1 means never had a paid subscription)
            if expiration_date == -1:
                sandbox_message_ids.append(msg.id)
                continue

            # Case 2: Subscription expired beyond grace period
            if current_timestamp - expiration_date > graceful_period_seconds:
                sandbox_message_ids.append(msg.id)

        return sandbox_message_ids


def create_message_clean_policy(
    graceful_period_days: int = 21,
    current_timestamp: int | None = None,
) -> MessagesCleanPolicy:
    """
    Factory function to create the appropriate message clean policy.

    Determines which policy to use based on BILLING_ENABLED configuration:
    - If BILLING_ENABLED is True: returns BillingSandboxPolicy
    - If BILLING_ENABLED is False: returns BillingDisabledPolicy

    Args:
        graceful_period_days: Grace period in days after subscription expiration (default: 21)
        current_timestamp: Current Unix timestamp for testing (default: None, uses current time)
    """
    if not dify_config.BILLING_ENABLED:
        logger.info("create_message_clean_policy: billing disabled, using BillingDisabledPolicy")
        return BillingDisabledPolicy()

    # Billing enabled - fetch whitelist from BillingService
    tenant_whitelist = BillingService.get_expired_subscription_cleanup_whitelist()
    plan_provider = BillingService.get_plan_bulk_with_cache

    logger.info(
        "create_message_clean_policy: billing enabled, using BillingSandboxPolicy "
        "(graceful_period_days=%s, whitelist=%s)",
        graceful_period_days,
        tenant_whitelist,
    )

    return BillingSandboxPolicy(
        plan_provider=plan_provider,
        graceful_period_days=graceful_period_days,
        tenant_whitelist=tenant_whitelist,
        current_timestamp=current_timestamp,
    )
