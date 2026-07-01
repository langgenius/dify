"""Tenant credit pool accounting.

Credit deductions are guarded by a tenant-level Redis lock before the database
row lock is acquired. This keeps concurrent usage accounting for one tenant
from piling up database transactions while preserving cross-tenant concurrency.
"""

import logging
from collections.abc import Callable

from sqlalchemy import select
from sqlalchemy.orm import Session

from configs import dify_config
from core.db.session_factory import session_factory
from core.errors.error import QuotaExceededError
from extensions.ext_redis import redis_client
from models import TenantCreditPool
from models.enums import ProviderQuotaType

logger = logging.getLogger(__name__)

CREDIT_POOL_TENANT_LOCK_TIMEOUT_SECONDS = 10
CREDIT_POOL_TENANT_LOCK_BLOCKING_TIMEOUT_SECONDS = 5


class CreditPoolService:
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
    def create_default_pool(cls, tenant_id: str, session: Any) -> TenantCreditPool:
        """create default credit pool for new tenant"""
        credit_pool = TenantCreditPool(
            tenant_id=tenant_id,
            quota_limit=dify_config.HOSTED_POOL_CREDITS,
            quota_used=0,
            pool_type=ProviderQuotaType.TRIAL,
        )
        session.add(credit_pool)
        return credit_pool

    @classmethod
    def get_pool(cls, tenant_id: str, pool_type: str = "trial") -> TenantCreditPool | None:
        """get tenant credit pool"""
        with session_factory.get_session_maker().begin() as session:
            return session.scalar(
                select(TenantCreditPool)
                .where(
                    TenantCreditPool.tenant_id == tenant_id,
                    TenantCreditPool.pool_type == pool_type,
                )
                .limit(1)
            )

    @classmethod
    def check_credits_available(
        cls,
        tenant_id: str,
        credits_required: int,
        pool_type: str = "trial",
    ) -> bool:
        """check if credits are available without deducting"""
        pool = cls.get_pool(tenant_id, pool_type)
        if not pool:
            return False
        return pool.remaining_credits >= credits_required

    @classmethod
    def check_and_deduct_credits(
        cls,
        tenant_id: str,
        credits_required: int,
        pool_type: str = "trial",
    ) -> int:
        """Deduct exactly the requested credits or raise without mutating the pool."""
        if credits_required <= 0:
            return 0

        def deduct() -> int:
            with session_factory.get_session_maker().begin() as session:
                pool = cls._get_locked_pool(session=session, tenant_id=tenant_id, pool_type=pool_type)
                if not pool:
                    raise QuotaExceededError("Credit pool not found")

                remaining_credits = pool.remaining_credits
                if remaining_credits <= 0:
                    raise QuotaExceededError("No credits remaining")
                if remaining_credits < credits_required:
                    raise QuotaExceededError("Insufficient credits remaining")

                pool.quota_used += credits_required
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
        pool_type: str = "trial",
    ) -> int:
        """Deduct up to the available balance and return the actual deducted credits."""
        if credits_required <= 0:
            return 0

        def deduct() -> int:
            with session_factory.get_session_maker().begin() as session:
                pool = cls._get_locked_pool(session=session, tenant_id=tenant_id, pool_type=pool_type)
                if not pool:
                    logger.warning("Credit pool not found, tenant_id=%s, pool_type=%s", tenant_id, pool_type)
                    return 0

                deducted_credits = min(credits_required, pool.remaining_credits)
                if deducted_credits <= 0:
                    return 0

                pool.quota_used += deducted_credits
                return deducted_credits

        try:
            return cls._deduct_with_tenant_lock(tenant_id, deduct)
        except QuotaExceededError:
            raise
        except Exception:
            logger.exception("Failed to deduct capped credits for tenant %s", tenant_id)
            raise QuotaExceededError("Failed to deduct credits")
