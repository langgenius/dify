import logging

from sqlalchemy import select
from sqlalchemy.orm import Session

from configs import dify_config
from core.db.session_factory import session_factory
from core.errors.error import QuotaExceededError
from extensions.ext_database import db
from models import TenantCreditPool
from models.enums import ProviderQuotaType

logger = logging.getLogger(__name__)


class CreditPoolService:
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
    def create_default_pool(cls, tenant_id: str) -> TenantCreditPool:
        """create default credit pool for new tenant"""
        credit_pool = TenantCreditPool(
            tenant_id=tenant_id,
            quota_limit=dify_config.HOSTED_POOL_CREDITS,
            quota_used=0,
            pool_type=ProviderQuotaType.TRIAL,
        )
        db.session.add(credit_pool)
        db.session.commit()
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

        try:
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
        except QuotaExceededError:
            raise
        except Exception:
            logger.exception("Failed to deduct credits for tenant %s", tenant_id)
            raise QuotaExceededError("Failed to deduct credits")

        return credits_required

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

        try:
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
        except QuotaExceededError:
            raise
        except Exception:
            logger.exception("Failed to deduct capped credits for tenant %s", tenant_id)
            raise QuotaExceededError("Failed to deduct credits")
