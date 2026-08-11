import datetime
import logging
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import Protocol, override, runtime_checkable

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


@runtime_checkable
class EligibleAppMessagesCleanPolicy(MessagesCleanPolicy, Protocol):
    """
    Policy extension for cleanup strategies that discover eligible apps before scanning messages.

    Discovery may use a job-level plan cache to reduce billing traffic, but delete-time revalidation
    must fetch fresh plan data so tenants upgraded during a long cleanup run are not removed by stale state.
    """

    def filter_app_to_tenant(
        self,
        app_to_tenant: dict[str, str],
    ) -> dict[str, str]:
        """
        Return only apps whose current cached tenant plan is eligible for cleanup.
        """
        ...

    def revalidate_message_ids(
        self,
        messages: Sequence[SimpleMessage],
        app_to_tenant: dict[str, str],
    ) -> Sequence[str]:
        """
        Re-check message tenant plans without the job-level cache immediately before deletion.
        """
        ...


class BillingDisabledPolicy(MessagesCleanPolicy):
    """
    Policy for community or enterpriseedition (billing disabled).

    No special filter logic, just return all message ids.
    """

    @override
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

    _graceful_period_days: int
    _tenant_whitelist: Sequence[str]
    _tenant_whitelist_set: set[str]
    _plan_provider: Callable[[Sequence[str]], dict[str, SubscriptionPlan]]
    _fresh_plan_provider: Callable[[Sequence[str]], dict[str, SubscriptionPlan]]
    _current_timestamp: int | None
    _plan_cache: dict[str, SubscriptionPlan | None]

    def __init__(
        self,
        plan_provider: Callable[[Sequence[str]], dict[str, SubscriptionPlan]],
        fresh_plan_provider: Callable[[Sequence[str]], dict[str, SubscriptionPlan]] | None = None,
        graceful_period_days: int = 21,
        tenant_whitelist: Sequence[str] | None = None,
        current_timestamp: int | None = None,
    ) -> None:
        self._graceful_period_days = graceful_period_days
        self._tenant_whitelist: Sequence[str] = tenant_whitelist or []
        self._tenant_whitelist_set = set(self._tenant_whitelist)
        self._plan_provider = plan_provider
        self._fresh_plan_provider = fresh_plan_provider or plan_provider
        self._current_timestamp = current_timestamp
        self._plan_cache = {}

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

        # Get unique tenant_ids and fetch subscription plans. Plans are cached for the whole
        # policy lifetime because message cleanup evaluates many adjacent batches from the same apps.
        tenant_ids = sorted(
            {tenant_id for tenant_id in app_to_tenant.values() if tenant_id not in self._tenant_whitelist_set}
        )
        tenant_plans = self._get_tenant_plans(tenant_ids)

        if not tenant_plans:
            return []

        # Apply sandbox deletion rules
        return self._filter_expired_sandbox_messages(
            messages=messages,
            app_to_tenant=app_to_tenant,
            tenant_plans=tenant_plans,
        )

    def filter_app_to_tenant(
        self,
        app_to_tenant: dict[str, str],
    ) -> dict[str, str]:
        """
        Return apps that belong to tenants currently eligible for sandbox cleanup.

        This method is used during app discovery and can use the job-level plan cache. Deletion still calls
        revalidate_message_ids(), which bypasses this cache.
        """
        if not app_to_tenant:
            return {}

        eligible_tenant_ids = self._eligible_tenant_ids(
            list(app_to_tenant.values()),
            use_fresh_provider=False,
        )
        return {app_id: tenant_id for app_id, tenant_id in app_to_tenant.items() if tenant_id in eligible_tenant_ids}

    def revalidate_message_ids(
        self,
        messages: Sequence[SimpleMessage],
        app_to_tenant: dict[str, str],
    ) -> Sequence[str]:
        """
        Re-check sandbox eligibility with fresh billing data immediately before deletion.
        """
        if not messages or not app_to_tenant:
            return []

        tenant_ids = sorted(
            {tenant_id for tenant_id in app_to_tenant.values() if tenant_id not in self._tenant_whitelist_set}
        )
        tenant_plans = self._get_fresh_tenant_plans(tenant_ids)
        if not tenant_plans:
            return []

        return self._filter_expired_sandbox_messages(
            messages=messages,
            app_to_tenant=app_to_tenant,
            tenant_plans=tenant_plans,
        )

    def _eligible_tenant_ids(self, tenant_ids: Sequence[str], *, use_fresh_provider: bool) -> set[str]:
        unique_tenant_ids = sorted(set(tenant_ids) - self._tenant_whitelist_set)
        if not unique_tenant_ids:
            return set()

        tenant_plans = (
            self._get_fresh_tenant_plans(unique_tenant_ids)
            if use_fresh_provider
            else self._get_tenant_plans(unique_tenant_ids)
        )
        return set(
            self._tenant_ids_for_expired_sandbox_plans(
                tenant_plans,
            )
        )

    def _get_tenant_plans(self, tenant_ids: Sequence[str]) -> dict[str, SubscriptionPlan]:
        """
        Return cached subscription plans for tenant ids.

        Missing billing responses are cached as None and remain a safe non-delete decision.
        Provider exceptions still propagate so transient billing failures do not silently change cleanup behavior.
        """
        unique_tenant_ids = sorted(set(tenant_ids))
        missing_tenant_ids = [tenant_id for tenant_id in unique_tenant_ids if tenant_id not in self._plan_cache]

        if missing_tenant_ids:
            fetched_plans = self._plan_provider(missing_tenant_ids)
            for tenant_id in missing_tenant_ids:
                self._plan_cache[tenant_id] = fetched_plans.get(tenant_id)

        plans: dict[str, SubscriptionPlan] = {}
        for tenant_id in unique_tenant_ids:
            plan = self._plan_cache.get(tenant_id)
            if plan is not None:
                plans[tenant_id] = plan
        return plans

    def _get_fresh_tenant_plans(self, tenant_ids: Sequence[str]) -> dict[str, SubscriptionPlan]:
        """
        Fetch subscription plans without the job-level cache.

        This is intentionally used on the delete path to avoid deleting messages for tenants that upgraded
        while a long-running cleanup job was scanning.
        """
        unique_tenant_ids = sorted(set(tenant_ids))
        if not unique_tenant_ids:
            return {}
        return self._fresh_plan_provider(unique_tenant_ids)

    def _tenant_ids_for_expired_sandbox_plans(self, tenant_plans: dict[str, SubscriptionPlan]) -> list[str]:
        current_timestamp = self._current_timestamp
        if current_timestamp is None:
            current_timestamp = int(datetime.datetime.now(datetime.UTC).timestamp())

        eligible_tenant_ids: list[str] = []
        graceful_period_seconds = self._graceful_period_days * 24 * 60 * 60

        for tenant_id, tenant_plan in tenant_plans.items():
            plan = str(tenant_plan["plan"])
            expiration_date = int(tenant_plan["expiration_date"])

            if plan != CloudPlan.SANDBOX:
                continue

            if expiration_date == -1 or current_timestamp - expiration_date > graceful_period_seconds:
                eligible_tenant_ids.append(tenant_id)

        return eligible_tenant_ids

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
            if tenant_id in self._tenant_whitelist_set:
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
    fresh_plan_provider = BillingService.get_plan_bulk

    logger.info(
        "create_message_clean_policy: billing enabled, using BillingSandboxPolicy "
        "(graceful_period_days=%s, whitelist=%s)",
        graceful_period_days,
        tenant_whitelist,
    )

    return BillingSandboxPolicy(
        plan_provider=plan_provider,
        fresh_plan_provider=fresh_plan_provider,
        graceful_period_days=graceful_period_days,
        tenant_whitelist=tenant_whitelist,
        current_timestamp=current_timestamp,
    )
