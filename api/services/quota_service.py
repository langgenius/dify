from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from enums.quota_type import QuotaType

logger = logging.getLogger(__name__)


@dataclass
class QuotaCharge:
    """
    Result of a quota reservation (Reserve phase).

    Lifecycle:
        charge = QuotaType.TRIGGER.consume(tenant_id)  # Reserve
        try:
            do_work()
            charge.commit()   # Confirm consumption
        except:
            charge.refund()   # Release frozen quota

    If neither commit() nor refund() is called, the billing system's
    cleanup CronJob will auto-release the reservation within ~75 seconds.
    """

    success: bool
    charge_id: str | None  # reservation_id
    _quota_type: QuotaType
    _tenant_id: str | None = None
    _feature_key: str | None = None
    _amount: int = 0
    _committed: bool = field(default=False, repr=False)

    def commit(self, actual_amount: int | None = None) -> None:
        """
        Confirm the consumption with actual amount.

        Args:
            actual_amount: Actual amount consumed. Defaults to the reserved amount.
                           If less than reserved, the difference is refunded automatically.
        """
        if self._committed or not self.charge_id or not self._tenant_id or not self._feature_key:
            return

        try:
            from services.billing_service import BillingService

            amount = actual_amount if actual_amount is not None else self._amount
            BillingService.quota_commit(
                tenant_id=self._tenant_id,
                feature_key=self._feature_key,
                reservation_id=self.charge_id,
                actual_amount=amount,
            )
            self._committed = True
            logger.debug(
                "Committed %s quota for tenant %s, reservation_id: %s, amount: %d",
                self._quota_type,
                self._tenant_id,
                self.charge_id,
                amount,
            )
        except Exception:
            logger.exception("Failed to commit quota, reservation_id: %s", self.charge_id)

    def refund(self) -> None:
        """
        Release the reserved quota (cancel the charge).

        Safe to call even if:
        - charge failed or was disabled (charge_id is None)
        - already committed (Release after Commit is a no-op)
        - already refunded (idempotent)

        This method guarantees no exceptions will be raised.
        """
        if not self.charge_id or not self._tenant_id or not self._feature_key:
            return

        self._quota_type.release(self.charge_id, self._tenant_id, self._feature_key)


def unlimited() -> QuotaCharge:
    from enums.quota_type import QuotaType

    return QuotaCharge(success=True, charge_id=None, _quota_type=QuotaType.UNLIMITED)
