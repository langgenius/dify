import logging
import uuid
from enum import StrEnum, auto

logger = logging.getLogger(__name__)


class QuotaType(StrEnum):
    """
    Supported quota types for tenant feature usage.
    """

    TRIGGER = auto()
    WORKFLOW = auto()
    UNLIMITED = auto()

    @property
    def billing_key(self) -> str:
        match self:
            case QuotaType.TRIGGER:
                return "trigger_event"
            case QuotaType.WORKFLOW:
                return "api_rate_limit"
            case _:
                raise ValueError(f"Invalid quota type: {self}")

    def consume(self, tenant_id: str, amount: int = 1):
        """
        Consume quota using Reserve + immediate Commit.

        This is the simple one-shot mode: Reserve freezes quota, then Commit
        confirms it right away. The returned QuotaCharge supports .refund()
        which calls Release (idempotent even after Commit).

        For advanced two-phase usage (e.g. streaming), use reserve() directly
        and call charge.commit() / charge.refund() manually.

        Args:
            tenant_id: The tenant identifier
            amount: Amount to consume (default: 1)

        Returns:
            QuotaCharge with reservation_id for potential refund

        Raises:
            QuotaExceededError: When quota is insufficient
        """
        charge = self.reserve(tenant_id, amount)
        if charge.success and charge.charge_id:
            charge.commit()
        return charge

    def reserve(self, tenant_id: str, amount: int = 1):
        """
        Reserve quota before task execution (Reserve phase only).

        The caller MUST call charge.commit() after the task succeeds,
        or charge.refund() if the task fails.

        If neither is called, the reservation auto-expires in ~75 seconds.

        Args:
            tenant_id: The tenant identifier
            amount: Amount to reserve (default: 1)

        Returns:
            QuotaCharge — call .commit() on success, .refund() on failure

        Raises:
            QuotaExceededError: When quota is insufficient
        """
        from configs import dify_config
        from services.billing_service import BillingService
        from services.errors.app import QuotaExceededError
        from services.quota_service import QuotaCharge, unlimited

        if not dify_config.BILLING_ENABLED:
            logger.debug("Billing disabled, allowing request for %s", tenant_id)
            return QuotaCharge(success=True, charge_id=None, _quota_type=self)

        logger.info("Reserving %d %s quota for tenant %s", amount, self.value, tenant_id)

        if amount <= 0:
            raise ValueError("Amount to reserve must be greater than 0")

        request_id = str(uuid.uuid4())
        feature_key = self.billing_key

        try:
            reserve_resp = BillingService.quota_reserve(
                tenant_id=tenant_id,
                feature_key=feature_key,
                request_id=request_id,
                amount=amount,
            )

            reservation_id = reserve_resp.get("reservation_id")
            if not reservation_id:
                logger.warning(
                    "Reserve returned no reservation_id for %s, feature %s, response: %s",
                    tenant_id,
                    self.value,
                    reserve_resp,
                )
                raise QuotaExceededError(feature=self.value, tenant_id=tenant_id, required=amount)

            logger.debug(
                "Reserved %d %s quota for tenant %s, reservation_id: %s",
                amount,
                self.value,
                tenant_id,
                reservation_id,
            )
            return QuotaCharge(
                success=True,
                charge_id=reservation_id,
                _quota_type=self,
                _tenant_id=tenant_id,
                _feature_key=feature_key,
                _amount=amount,
            )

        except QuotaExceededError:
            raise
        except ValueError:
            raise
        except Exception:
            logger.exception("Failed to reserve quota for %s, feature %s", tenant_id, self.value)
            return unlimited()

    def check(self, tenant_id: str, amount: int = 1) -> bool:
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
            return True

    def release(self, reservation_id: str, tenant_id: str, feature_key: str) -> None:
        """
        Release a reservation. Guarantees no exceptions.
        """
        try:
            from configs import dify_config
            from services.billing_service import BillingService

            if not dify_config.BILLING_ENABLED:
                return

            if not reservation_id:
                return

            logger.info("Releasing %s quota, reservation_id: %s", self.value, reservation_id)
            BillingService.quota_release(
                tenant_id=tenant_id,
                feature_key=feature_key,
                reservation_id=reservation_id,
            )
        except Exception:
            logger.exception("Failed to release quota, reservation_id: %s", reservation_id)

    def get_remaining(self, tenant_id: str) -> int:
        from services.billing_service import BillingService

        try:
            usage_info = BillingService.get_quota_info(tenant_id)
            if isinstance(usage_info, dict):
                feature_info = usage_info.get(self.billing_key, {})
                if isinstance(feature_info, dict):
                    limit = feature_info.get("limit", 0)
                    usage = feature_info.get("usage", 0)
                    if limit == -1:
                        return -1
                    return max(0, limit - usage)
            return 0
        except Exception:
            logger.exception("Failed to get remaining quota for %s, feature %s", tenant_id, self.value)
            return -1
