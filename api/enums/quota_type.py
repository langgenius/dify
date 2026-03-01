import logging
from dataclasses import dataclass
from enum import StrEnum, auto

logger = logging.getLogger(__name__)


@dataclass
class QuotaCharge:
    """
    Result of a quota consumption operation.

    Attributes:
        success: Whether the quota charge succeeded
        charge_id: UUID for refund, or None if failed/disabled
    """

    success: bool
    charge_id: str | None
    _quota_type: "QuotaType"

    def refund(self) -> None:
        """
        Refund this quota charge.

        Safe to call even if charge failed or was disabled.
        This method guarantees no exceptions will be raised.
        """
        if self.charge_id:
            self._quota_type.refund(self.charge_id)
            logger.info("Refunded quota for %s with charge_id: %s", self._quota_type.value, self.charge_id)


class QuotaType(StrEnum):
    """
    Supported quota types for tenant feature usage.

    Add additional types here whenever new billable features become available.
    """

    # Trigger execution quota
    TRIGGER = auto()

    # Workflow execution quota
    WORKFLOW = auto()

    UNLIMITED = auto()

    @property
    def billing_key(self) -> str:
        """
        Get the billing key for the feature.
        """
        match self:
            case QuotaType.TRIGGER:
                return "trigger_event"
            case QuotaType.WORKFLOW:
                return "api_rate_limit"
            case _:
                raise ValueError(f"Invalid quota type: {self}")

    def consume(self, tenant_id: str, amount: int = 1) -> QuotaCharge:
        """
        Consume quota for the feature.

        Args:
            tenant_id: The tenant identifier
            amount: Amount to consume (default: 1)

        Returns:
            QuotaCharge with success status and charge_id for refund

        Raises:
            QuotaExceededError: When quota is insufficient
        """
        from configs import dify_config
        from services.billing_service import BillingService
        from services.errors.app import QuotaExceededError

        if not dify_config.BILLING_ENABLED:
            logger.debug("Billing disabled, allowing request for %s", tenant_id)
            return QuotaCharge(success=True, charge_id=None, _quota_type=self)

        logger.info("Consuming %d %s quota for tenant %s", amount, self.value, tenant_id)

        if amount <= 0:
            raise ValueError("Amount to consume must be greater than 0")

        try:
            response = BillingService.update_tenant_feature_plan_usage(tenant_id, self.billing_key, delta=amount)

            if response.get("result") != "success":
                logger.warning(
                    "Failed to consume quota for %s, feature %s details: %s",
                    tenant_id,
                    self.value,
                    response.get("detail"),
                )
                raise QuotaExceededError(feature=self.value, tenant_id=tenant_id, required=amount)

            charge_id = response.get("history_id")
            logger.debug(
                "Successfully consumed %d %s quota for tenant %s, charge_id: %s",
                amount,
                self.value,
                tenant_id,
                charge_id,
            )
            return QuotaCharge(success=True, charge_id=charge_id, _quota_type=self)

        except QuotaExceededError:
            raise
        except Exception:
            # fail-safe: allow request on billing errors
            logger.exception("Failed to consume quota for %s, feature %s", tenant_id, self.value)
            return unlimited()

    def check(self, tenant_id: str, amount: int = 1) -> bool:
        """
        Check if tenant has sufficient quota without consuming.

        Args:
            tenant_id: The tenant identifier
            amount: Amount to check (default: 1)

        Returns:
            True if quota is sufficient, False otherwise
        """
        from configs import dify_config

        if not dify_config.BILLING_ENABLED:
            return True

        if amount <= 0:
            raise ValueError("Amount to check must be greater than 0")

        try:
            remaining = self.get_remaining(tenant_id)
            return remaining >= amount if remaining != -1 else True
        except Exception:
            logger.exception("Failed to check quota for %s, feature %s", tenant_id, self.value)
            # fail-safe: allow request on billing errors
            return True

    def refund(self, charge_id: str) -> None:
        """
        Refund quota using charge_id from consume().

        This method guarantees no exceptions will be raised.
        All errors are logged but silently handled.

        Args:
            charge_id: The UUID returned from consume()
        """
        try:
            from configs import dify_config
            from services.billing_service import BillingService

            if not dify_config.BILLING_ENABLED:
                return

            if not charge_id:
                logger.warning("Cannot refund: charge_id is empty")
                return

            logger.info("Refunding %s quota with charge_id: %s", self.value, charge_id)

            response = BillingService.refund_tenant_feature_plan_usage(charge_id)
            if response.get("result") == "success":
                logger.debug("Successfully refunded %s quota, charge_id: %s", self.value, charge_id)
            else:
                logger.warning("Refund failed for charge_id: %s", charge_id)

        except Exception:
            # Catch ALL exceptions - refund must never fail
            logger.exception("Failed to refund quota for charge_id: %s", charge_id)
            # Don't raise - refund is best-effort and must be silent

    def get_remaining(self, tenant_id: str) -> int:
        """
        Get remaining quota for the tenant.

        Args:
            tenant_id: The tenant identifier

        Returns:
            Remaining quota amount
        """
        from services.billing_service import BillingService

        try:
            usage_info = BillingService.get_tenant_feature_plan_usage(tenant_id, self.billing_key)
            # Assuming the API returns a dict with 'remaining' or 'limit' and 'used'
            if isinstance(usage_info, dict):
                return usage_info.get("remaining", 0)
            # If it returns a simple number, treat it as remaining
            return int(usage_info) if usage_info else 0
        except Exception:
            logger.exception("Failed to get remaining quota for %s, feature %s", tenant_id, self.value)
            return -1


def unlimited() -> QuotaCharge:
    """
    Return a quota charge for unlimited quota.

    This is useful for features that are not subject to quota limits, such as the UNLIMITED quota type.
    """
    return QuotaCharge(success=True, charge_id=None, _quota_type=QuotaType.UNLIMITED)
