import datetime
import logging
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import Protocol, override

from configs import dify_config
from enums.cloud_plan import CloudPlan
from services.billing_service import BillingService, SubscriptionPlan

logger = logging.getLogger(__name__)


@dataclass
class SimpleMessage:
    id: str
    app_id: str
    created_at: datetime.datetime


class MessagesCleanPolicy(Protocol):
    """
    Protocol for message cleanup policies.

    A policy determines which messages from a batch should be deleted.
    """

    def supports_tenant_prefilter(self) -> bool:
        """
        Return whether the cleanup service can prefilter apps by eligible tenants before scanning messages.
        """
        ...

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

    def filter_eligible_tenant_ids(self, tenant_ids: Sequence[str]) -> set[str] | None:
        """
        Return tenant IDs eligible for cleanup before scanning messages.

        Returns None when a policy intentionally does not support SQL prefiltering.
        """
        ...


class BillingDisabledPolicy(MessagesCleanPolicy):
    """
    Policy for community or enterpriseedition (billing disabled).

    No special filter logic, just return all message ids.
    """

    @override
    def supports_tenant_prefilter(self) -> bool:
        return False

    @override
    def filter_message_ids(
        self,
        messages: Sequence[SimpleMessage],
        app_to_tenant: dict[str, str],
    ) -> Sequence[str]:
        return [msg.id for msg in messages]

    @override
    def filter_eligible_tenant_ids(self, tenant_ids: Sequence[str]) -> set[str] | None:
        return None


class BillingSandboxPolicy(MessagesCleanPolicy):
    """
    Policy for sandbox plan tenants in cloud edition (billing enabled).

    Filters messages based on sandbox plan expiration rules:
    - Skip tenants in the whitelist
    - Only delete messages from sandbox plan tenants
    - Respect grace period after subscription expiration
    - Safe default: if tenant mapping or plan is missing, do NOT delete

    Tenant plans are cached for the policy instance lifetime. Cleanup jobs may revisit the
    same tenant across many message batches, and Redis' cross-job TTL should not be the only
    cache protecting billing lookups during one run.
    """

    _graceful_period_days: int
    _tenant_whitelist: set[str]
    _plan_provider: Callable[[Sequence[str]], dict[str, SubscriptionPlan]]
    _current_timestamp: int | None
    _tenant_plan_cache: dict[str, SubscriptionPlan]
    _missing_plan_tenant_cache: set[str]

    @override
    def supports_tenant_prefilter(self) -> bool:
        return True

    def __init__(
        self,
        plan_provider: Callable[[Sequence[str]], dict[str, SubscriptionPlan]],
        graceful_period_days: int = 21,
        tenant_whitelist: Sequence[str] | None = None,
        current_timestamp: int | None = None,
    ) -> None:
        self._graceful_period_days = graceful_period_days
        self._tenant_whitelist = set(tenant_whitelist or [])
        self._plan_provider = plan_provider
        self._current_timestamp = current_timestamp
        self._tenant_plan_cache = {}
        self._missing_plan_tenant_cache = set()

    @override
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

        tenant_ids = list(set(app_to_tenant.values()))
        tenant_plans = self._get_tenant_plans(tenant_ids)

        if not tenant_plans:
            return []

        # Apply sandbox deletion rules
        return self._filter_expired_sandbox_messages(
            messages=messages,
            app_to_tenant=app_to_tenant,
            tenant_plans=tenant_plans,
        )

    @override
    def filter_eligible_tenant_ids(self, tenant_ids: Sequence[str]) -> set[str] | None:
        """
        Filter tenants eligible for message cleanup before scanning message rows.

        Missing billing plans remain non-eligible for the current cleanup job, matching
        the per-message safe default while avoiding repeated billing lookups.
        """
        tenant_id_set = set(tenant_ids)
        if not tenant_id_set:
            return set()

        tenant_plans = self._get_tenant_plans(list(tenant_id_set))
        if not tenant_plans:
            return set()

        return {
            tenant_id
            for tenant_id in tenant_id_set
            if self._is_expired_sandbox_tenant(tenant_id, tenant_plans.get(tenant_id))
        }

    def _get_tenant_plans(self, tenant_ids: Sequence[str]) -> dict[str, SubscriptionPlan]:
        tenant_id_set = set(tenant_ids)
        tenant_plans = {
            tenant_id: self._tenant_plan_cache[tenant_id]
            for tenant_id in tenant_id_set
            if tenant_id in self._tenant_plan_cache
        }
        cache_misses = [
            tenant_id
            for tenant_id in tenant_id_set
            if tenant_id not in self._tenant_plan_cache and tenant_id not in self._missing_plan_tenant_cache
        ]
        if not cache_misses:
            return tenant_plans

        fetched_plans = self._plan_provider(cache_misses)
        self._tenant_plan_cache.update(fetched_plans)
        self._missing_plan_tenant_cache.update(set(cache_misses) - set(fetched_plans))
        tenant_plans.update(fetched_plans)
        return tenant_plans

    def _current_time_seconds(self) -> int:
        if self._current_timestamp is not None:
            return self._current_timestamp

        return int(datetime.datetime.now(datetime.UTC).timestamp())

    def _is_expired_sandbox_tenant(self, tenant_id: str, tenant_plan: SubscriptionPlan | None) -> bool:
        if tenant_id in self._tenant_whitelist or not tenant_plan:
            return False

        plan = str(tenant_plan["plan"])
        if plan != CloudPlan.SANDBOX:
            return False

        expiration_date = int(tenant_plan["expiration_date"])
        if expiration_date == -1:
            return True

        graceful_period_seconds = self._graceful_period_days * 24 * 60 * 60
        return self._current_time_seconds() - expiration_date > graceful_period_seconds

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
        sandbox_message_ids: list[str] = []

        for msg in messages:
            # Get tenant_id for this message's app
            tenant_id = app_to_tenant.get(msg.app_id)
            if not tenant_id:
                continue

            if self._is_expired_sandbox_tenant(tenant_id, tenant_plans.get(tenant_id)):
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
