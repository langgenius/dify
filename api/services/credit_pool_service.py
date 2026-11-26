"""Tenant credit pool accounting backed by the billing quota ledger.

Hosted models exist only on Cloud, and their credit balances are owned by the
billing service. Every read and write here therefore goes through the billing
quota API; this module only owns the reservation lifecycle and the metadata
contract that the ledger records for each event.
"""

import logging
from collections.abc import Mapping
from dataclasses import dataclass, field
from enum import StrEnum, auto
from typing import Any
from uuid import uuid4

from core.credit_usage import normalize_credit_usage_app_type, normalize_credit_usage_created_by
from core.errors.error import InsufficientHostedCreditsError
from models.enums import ProviderQuotaType
from services.errors.billing import BillingUpstreamUnavailableError

logger = logging.getLogger(__name__)

FEATURE_KEY_CREDIT_POOL = "credit_pool"
CREDIT_USAGE_CREATED_BY_META_KEY = "created_by"
CREDIT_USAGE_APP_TYPE_META_KEY = "app_type"


@dataclass(frozen=True)
class CreditPoolBalance:
    tenant_id: str
    pool_type: str
    quota_limit: int
    quota_used: int
    exhausted_at: int | None = None

    @property
    def remaining_credits(self) -> int:
        if self.quota_limit == -1:
            return -1
        return max(0, self.quota_limit - self.quota_used)

    def has_sufficient_credits(self, required_credits: int) -> bool:
        return self.quota_limit == -1 or self.remaining_credits >= required_credits


class CreditPoolReservationState(StrEnum):
    RESERVED = auto()
    COMMITTED = auto()
    RELEASED = auto()


@dataclass
class CreditPoolReservation:
    """A strict credit-pool reservation spanning one billable operation."""

    tenant_id: str
    pool_type: str
    amount: int
    request_id: str
    reservation_id: str
    meta: dict[str, Any] = field(default_factory=dict)
    _state: CreditPoolReservationState = field(default=CreditPoolReservationState.RESERVED, init=False, repr=False)

    @property
    def state(self) -> CreditPoolReservationState:
        return self._state

    def commit(self) -> None:
        if self._state == CreditPoolReservationState.COMMITTED:
            return
        if self._state == CreditPoolReservationState.RELEASED:
            raise RuntimeError("Cannot commit a released credit reservation.")

        from services.billing_service import BillingService

        BillingService.quota_commit(
            tenant_id=self.tenant_id,
            feature_key=FEATURE_KEY_CREDIT_POOL,
            bucket=self.pool_type,
            reservation_id=self.reservation_id,
            actual_amount=self.amount,
            meta={**self.meta, "request_id": self.request_id},
        )
        self._state = CreditPoolReservationState.COMMITTED

    def release(self) -> None:
        if self._state in {CreditPoolReservationState.COMMITTED, CreditPoolReservationState.RELEASED}:
            return

        from services.billing_service import BillingService

        BillingService.quota_release(
            tenant_id=self.tenant_id,
            feature_key=FEATURE_KEY_CREDIT_POOL,
            bucket=self.pool_type,
            reservation_id=self.reservation_id,
        )
        self._state = CreditPoolReservationState.RELEASED


class CreditPoolService:
    @staticmethod
    def _normalize_pool_type(pool_type: str | ProviderQuotaType) -> str:
        return pool_type.value if isinstance(pool_type, ProviderQuotaType) else str(pool_type)

    @staticmethod
    def _build_billing_metadata(
        source: str,
        metadata: Mapping[str, object] | None,
    ) -> dict[str, object]:
        billing_metadata: dict[str, object] = {
            "source": source,
            **dict(metadata or {}),
        }
        billing_metadata[CREDIT_USAGE_CREATED_BY_META_KEY] = normalize_credit_usage_created_by(
            billing_metadata.get(CREDIT_USAGE_CREATED_BY_META_KEY)
        ).value
        billing_metadata[CREDIT_USAGE_APP_TYPE_META_KEY] = normalize_credit_usage_app_type(
            billing_metadata.get(CREDIT_USAGE_APP_TYPE_META_KEY)
        ).value
        return billing_metadata

    @classmethod
    def get_pool(
        cls,
        tenant_id: str,
        pool_type: str | ProviderQuotaType = "trial",
    ) -> CreditPoolBalance:
        """Return the workspace's balance for one hosted credit bucket."""
        from services.billing_service import BillingService

        normalized_pool_type = cls._normalize_pool_type(pool_type)
        balance = BillingService.quota_get_balance(
            tenant_id=tenant_id,
            feature_key=FEATURE_KEY_CREDIT_POOL,
            bucket=normalized_pool_type,
        )
        return CreditPoolBalance(
            tenant_id=tenant_id,
            pool_type=normalized_pool_type,
            quota_limit=balance.quota,
            quota_used=balance.usage,
            exhausted_at=balance.exhausted_at,
        )

    @classmethod
    def get_pool_if_available(cls, *, tenant_id: str, pool_type: str) -> CreditPoolBalance | None:
        """Read a balance for provider discovery or display; an outage is neither zero nor unlimited."""
        try:
            return cls.get_pool(tenant_id=tenant_id, pool_type=pool_type)
        except BillingUpstreamUnavailableError as exc:
            logger.warning("Billing balance unavailable for workspace %s, pool %s: %s", tenant_id, pool_type, exc)
            return None

    @classmethod
    def reserve_credits(
        cls,
        tenant_id: str,
        credits_required: int,
        pool_type: str | ProviderQuotaType = "trial",
        *,
        request_id: str,
        meta: dict[str, Any] | None = None,
    ) -> CreditPoolReservation:
        """Reserve the full positive amount for a request before starting a billable operation.

        A Billing denial raises InsufficientHostedCreditsError without a reservation.
        Upstream failures propagate; they do not establish that no credits were reserved.
        """
        if credits_required <= 0:
            raise ValueError("credits_required must be greater than 0")
        if not request_id:
            raise ValueError("request_id is required")

        from services.billing_service import BillingService

        normalized_pool_type = cls._normalize_pool_type(pool_type)
        reservation_meta = cls._build_billing_metadata("credit_pool.reservation", meta)
        result = BillingService.quota_reserve(
            tenant_id=tenant_id,
            feature_key=FEATURE_KEY_CREDIT_POOL,
            bucket=normalized_pool_type,
            request_id=request_id,
            amount=credits_required,
            meta=reservation_meta,
        )
        if not result.reservation_id:
            raise InsufficientHostedCreditsError("Insufficient credits remaining")

        return CreditPoolReservation(
            tenant_id=tenant_id,
            pool_type=normalized_pool_type,
            amount=credits_required,
            request_id=request_id,
            reservation_id=result.reservation_id,
            meta=reservation_meta,
        )

    @classmethod
    def deduct_credits_capped(
        cls,
        tenant_id: str,
        credits_required: int,
        pool_type: str | ProviderQuotaType = "trial",
        *,
        request_id: str | None = None,
        metadata: Mapping[str, object] | None = None,
    ) -> int:
        """Deduct up to the available balance and return the actual deducted credits."""
        if credits_required <= 0:
            return 0

        from services.billing_service import BillingService

        normalized_pool_type = cls._normalize_pool_type(pool_type)
        billing_metadata = cls._build_billing_metadata("credit_pool.deduct_capped", metadata)
        result = BillingService.quota_consume_capped(
            tenant_id=tenant_id,
            feature_key=FEATURE_KEY_CREDIT_POOL,
            bucket=normalized_pool_type,
            request_id=request_id or str(uuid4()),
            amount=credits_required,
            meta=billing_metadata,
        )
        return result.deducted
