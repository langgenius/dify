"""Tenant credit pool accounting.

Credit deductions are guarded by a tenant-level Redis lock before the database
row lock is acquired. This keeps concurrent usage accounting for one tenant
from piling up database transactions while preserving cross-tenant concurrency.
"""

import logging
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from enum import StrEnum, auto
from typing import Any
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.orm import Session

from configs import dify_config
from core.errors.error import QuotaExceededError
from enums import DeploymentEdition
from extensions.ext_redis import redis_client
from models import TenantCreditPool
from models.enums import ProviderQuotaType

logger = logging.getLogger(__name__)

FEATURE_KEY_CREDIT_POOL = "credit_pool"
CREDIT_POOL_TENANT_LOCK_TIMEOUT_SECONDS = 10
CREDIT_POOL_TENANT_LOCK_BLOCKING_TIMEOUT_SECONDS = 5


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
    reservation_id: str | None
    meta: dict[str, Any] = field(default_factory=dict)
    _session_factory: Callable[[], Session] | None = field(default=None, repr=False)
    _state: CreditPoolReservationState = field(default=CreditPoolReservationState.RESERVED, init=False, repr=False)

    @property
    def state(self) -> CreditPoolReservationState:
        return self._state

    def commit(self) -> None:
        if self._state == CreditPoolReservationState.COMMITTED:
            return
        if self._state == CreditPoolReservationState.RELEASED:
            raise RuntimeError("Cannot commit a released credit reservation.")

        if self.reservation_id is not None:
            from services.billing_service import BillingService

            BillingService.quota_commit(
                tenant_id=self.tenant_id,
                feature_key=FEATURE_KEY_CREDIT_POOL,
                bucket=self.pool_type,
                reservation_id=self.reservation_id,
                actual_amount=self.amount,
                meta={**self.meta, "request_id": self.request_id},
            )

        # The database fallback reserves by deducting under the tenant lock, so
        # commit only makes that already durable reservation final.
        self._state = CreditPoolReservationState.COMMITTED

    def release(self) -> None:
        if self._state in {CreditPoolReservationState.COMMITTED, CreditPoolReservationState.RELEASED}:
            return

        if self.reservation_id is not None:
            from services.billing_service import BillingService

            BillingService.quota_release(
                tenant_id=self.tenant_id,
                feature_key=FEATURE_KEY_CREDIT_POOL,
                bucket=self.pool_type,
                reservation_id=self.reservation_id,
            )
        else:
            if self._session_factory is None:
                raise RuntimeError("Database credit reservation requires a session factory.")
            CreditPoolService._release_database_reservation(
                tenant_id=self.tenant_id,
                pool_type=self.pool_type,
                credits=self.amount,
                session=self._session_factory(),
            )

        self._state = CreditPoolReservationState.RELEASED


class CreditPoolService:
    @staticmethod
    def _normalize_pool_type(pool_type: str | ProviderQuotaType) -> str:
        return pool_type.value if isinstance(pool_type, ProviderQuotaType) else str(pool_type)

    @staticmethod
    def _use_billing_quota() -> bool:
        return bool(dify_config.DEPLOYMENT_EDITION == DeploymentEdition.CLOUD)

    @staticmethod
    def _require_session(session: Session | None) -> Session:
        if session is None:
            raise ValueError("session is required when billing quota is disabled")
        return session

    @staticmethod
    def _get_tenant_lock_key(tenant_id: str) -> str:
        return f"credit_pool:tenant:{tenant_id}:deduct_lock"

    @classmethod
    def _deduct_with_tenant_lock(cls, tenant_id: str, deduct: Callable[[], int]) -> int:
        lock_key = cls._get_tenant_lock_key(tenant_id)
        lock = redis_client.lock(
            lock_key,
            timeout=CREDIT_POOL_TENANT_LOCK_TIMEOUT_SECONDS,
            blocking_timeout=CREDIT_POOL_TENANT_LOCK_BLOCKING_TIMEOUT_SECONDS,
        )
        lock_acquired = False

        try:
            lock_acquired = lock.acquire(blocking=True)
            if not lock_acquired:
                raise QuotaExceededError("Failed to acquire credit pool lock")

            return deduct()
        finally:
            if lock_acquired:
                try:
                    lock.release()
                except Exception:
                    logger.warning("Failed to release credit pool lock, tenant_id=%s", tenant_id, exc_info=True)

    @staticmethod
    def _get_locked_pool(session: Session, tenant_id: str, pool_type: str) -> TenantCreditPool | None:
        return session.scalar(
            select(TenantCreditPool)
            .where(
                TenantCreditPool.tenant_id == tenant_id,
                TenantCreditPool.pool_type == pool_type,
            )
            .limit(1)
            .with_for_update()
        )

    @classmethod
    def create_default_pool(cls, tenant_id: str, session: Session) -> TenantCreditPool:
        """create default credit pool for new tenant"""
        credit_pool = TenantCreditPool(
            tenant_id=tenant_id,
            quota_limit=dify_config.HOSTED_POOL_CREDITS,
            quota_used=0,
            pool_type=ProviderQuotaType.TRIAL,
        )
        session.add(credit_pool)
        session.commit()
        return credit_pool

    @classmethod
    def get_pool(
        cls,
        tenant_id: str,
        pool_type: str | ProviderQuotaType = "trial",
        *,
        session: Session | None = None,
    ) -> TenantCreditPool | CreditPoolBalance | None:
        """get tenant credit pool"""
        normalized_pool_type = cls._normalize_pool_type(pool_type)
        if cls._use_billing_quota():
            from services.billing_service import BillingService

            balance = BillingService.quota_get_balance(
                tenant_id=tenant_id,
                feature_key=FEATURE_KEY_CREDIT_POOL,
                bucket=normalized_pool_type,
            )
            return CreditPoolBalance(
                tenant_id=tenant_id,
                pool_type=normalized_pool_type,
                quota_limit=balance["quota"],
                quota_used=balance["usage"],
                exhausted_at=balance.get("exhausted_at"),
            )

        session = cls._require_session(session)
        return session.scalar(
            select(TenantCreditPool)
            .where(
                TenantCreditPool.tenant_id == tenant_id,
                TenantCreditPool.pool_type == normalized_pool_type,
            )
            .limit(1)
        )

    @classmethod
    def check_credits_available(
        cls,
        tenant_id: str,
        credits_required: int,
        pool_type: str | ProviderQuotaType = "trial",
        *,
        session: Session | None = None,
    ) -> bool:
        """check if credits are available without deducting"""
        pool = cls.get_pool(tenant_id, pool_type, session=session)
        if not pool:
            return False
        return pool.has_sufficient_credits(credits_required)

    @classmethod
    def reserve_credits(
        cls,
        tenant_id: str,
        credits_required: int,
        pool_type: str | ProviderQuotaType = "trial",
        *,
        request_id: str,
        session_factory: Callable[[], Session] | None = None,
        meta: dict[str, Any] | None = None,
    ) -> CreditPoolReservation:
        """Reserve the full amount or raise before the billable operation starts."""
        if credits_required <= 0:
            raise ValueError("credits_required must be greater than 0")
        if not request_id:
            raise ValueError("request_id is required")

        normalized_pool_type = cls._normalize_pool_type(pool_type)
        reservation_meta = {"source": "credit_pool.reservation", **(meta or {})}
        if cls._use_billing_quota():
            from services.billing_service import BillingService

            result = BillingService.quota_reserve(
                tenant_id=tenant_id,
                feature_key=FEATURE_KEY_CREDIT_POOL,
                bucket=normalized_pool_type,
                request_id=request_id,
                amount=credits_required,
                meta=reservation_meta,
            )
            reservation_id = result.get("reservation_id", "")
            if not reservation_id:
                raise QuotaExceededError("Insufficient credits remaining")
            return CreditPoolReservation(
                tenant_id=tenant_id,
                pool_type=normalized_pool_type,
                amount=credits_required,
                request_id=request_id,
                reservation_id=reservation_id,
                meta=reservation_meta,
            )

        if session_factory is None:
            raise ValueError("session_factory is required when billing quota is disabled")

        session = session_factory()

        def reserve() -> int:
            pool = cls._get_locked_pool(session=session, tenant_id=tenant_id, pool_type=normalized_pool_type)
            if not pool:
                raise QuotaExceededError("Credit pool not found")
            if not pool.has_sufficient_credits(credits_required):
                raise QuotaExceededError("Insufficient credits remaining")

            pool.quota_used += credits_required
            session.commit()
            return credits_required

        try:
            cls._deduct_with_tenant_lock(tenant_id, reserve)
        except QuotaExceededError:
            session.rollback()
            raise
        except Exception:
            session.rollback()
            logger.exception("Failed to reserve credits for tenant %s", tenant_id)
            raise QuotaExceededError("Failed to reserve credits")

        return CreditPoolReservation(
            tenant_id=tenant_id,
            pool_type=normalized_pool_type,
            amount=credits_required,
            request_id=request_id,
            reservation_id=None,
            meta=reservation_meta,
            _session_factory=session_factory,
        )

    @classmethod
    def _release_database_reservation(
        cls,
        *,
        tenant_id: str,
        pool_type: str,
        credits: int,
        session: Session,
    ) -> None:
        def release() -> int:
            pool = cls._get_locked_pool(session=session, tenant_id=tenant_id, pool_type=pool_type)
            if not pool:
                raise QuotaExceededError("Credit pool not found")
            if pool.quota_used < credits:
                raise RuntimeError("Reserved credits exceed recorded usage.")

            pool.quota_used -= credits
            session.commit()
            return credits

        try:
            cls._deduct_with_tenant_lock(tenant_id, release)
        except Exception:
            session.rollback()
            raise

    @classmethod
    def check_and_deduct_credits(
        cls,
        tenant_id: str,
        credits_required: int,
        pool_type: str | ProviderQuotaType = "trial",
        *,
        request_id: str | None = None,
        metadata: Mapping[str, str] | None = None,
        session: Session | None = None,
    ) -> int:
        """Deduct exactly the requested credits or raise without mutating the pool."""
        if credits_required <= 0:
            return 0
        normalized_pool_type = cls._normalize_pool_type(pool_type)

        if cls._use_billing_quota():
            from services.billing_service import BillingService

            resolved_request_id = request_id or str(uuid4())
            billing_metadata = {"source": "credit_pool.check_and_deduct", **dict(metadata or {})}
            result = BillingService.quota_reserve(
                tenant_id=tenant_id,
                feature_key=FEATURE_KEY_CREDIT_POOL,
                bucket=normalized_pool_type,
                request_id=resolved_request_id,
                amount=credits_required,
                meta=billing_metadata,
            )
            reservation_id = result.get("reservation_id", "")
            if not reservation_id:
                raise QuotaExceededError("Insufficient credits remaining")
            try:
                BillingService.quota_commit(
                    tenant_id=tenant_id,
                    feature_key=FEATURE_KEY_CREDIT_POOL,
                    bucket=normalized_pool_type,
                    reservation_id=reservation_id,
                    actual_amount=credits_required,
                    meta=billing_metadata,
                )
            except Exception:
                try:
                    BillingService.quota_release(
                        tenant_id=tenant_id,
                        feature_key=FEATURE_KEY_CREDIT_POOL,
                        bucket=normalized_pool_type,
                        reservation_id=reservation_id,
                    )
                except Exception:
                    logger.warning(
                        "Failed to release reserved credit pool quota, tenant_id=%s, pool_type=%s, reservation_id=%s",
                        tenant_id,
                        normalized_pool_type,
                        reservation_id,
                        exc_info=True,
                    )
                raise
            return credits_required

        session = cls._require_session(session)

        def deduct() -> int:
            pool = cls._get_locked_pool(session=session, tenant_id=tenant_id, pool_type=normalized_pool_type)
            if not pool:
                raise QuotaExceededError("Credit pool not found")

            remaining_credits = pool.remaining_credits
            if remaining_credits <= 0:
                raise QuotaExceededError("No credits remaining")
            if remaining_credits < credits_required:
                raise QuotaExceededError("Insufficient credits remaining")

            pool.quota_used += credits_required
            session.commit()
            return credits_required

        try:
            return cls._deduct_with_tenant_lock(tenant_id, deduct)
        except QuotaExceededError:
            raise
        except Exception:
            logger.exception("Failed to deduct credits for tenant %s", tenant_id)
            raise QuotaExceededError("Failed to deduct credits")

    @classmethod
    def deduct_credits_capped(
        cls,
        tenant_id: str,
        credits_required: int,
        pool_type: str | ProviderQuotaType = "trial",
        *,
        session: Session | None = None,
    ) -> int:
        """Deduct up to the available balance and return the actual deducted credits."""
        if credits_required <= 0:
            return 0
        normalized_pool_type = cls._normalize_pool_type(pool_type)

        if cls._use_billing_quota():
            from services.billing_service import BillingService

            result = BillingService.quota_consume_capped(
                tenant_id=tenant_id,
                feature_key=FEATURE_KEY_CREDIT_POOL,
                bucket=normalized_pool_type,
                request_id=str(uuid4()),
                amount=credits_required,
                meta={"source": "credit_pool.deduct_capped"},
            )
            return result["deducted"]

        session = cls._require_session(session)

        def deduct() -> int:
            pool = cls._get_locked_pool(session=session, tenant_id=tenant_id, pool_type=normalized_pool_type)
            if not pool:
                logger.warning("Credit pool not found, tenant_id=%s, pool_type=%s", tenant_id, normalized_pool_type)
                return 0

            deducted_credits = min(credits_required, pool.remaining_credits)
            if deducted_credits <= 0:
                return 0

            pool.quota_used += deducted_credits
            session.commit()
            return deducted_credits

        try:
            return cls._deduct_with_tenant_lock(tenant_id, deduct)
        except QuotaExceededError:
            raise
        except Exception:
            logger.exception("Failed to deduct capped credits for tenant %s", tenant_id)
            raise QuotaExceededError("Failed to deduct credits")
