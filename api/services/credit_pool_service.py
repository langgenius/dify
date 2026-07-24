import logging

from sqlalchemy import update
from sqlalchemy.orm import Session

from configs import dify_config
from core.errors.error import QuotaExceededError
from extensions.ext_database import db
from models import TenantCreditPool

logger = logging.getLogger(__name__)


class CreditPoolService:
    @classmethod
    def create_default_pool(cls, tenant_id: str) -> TenantCreditPool:
        """create default credit pool for new tenant"""
        credit_pool = TenantCreditPool(
            tenant_id=tenant_id, quota_limit=dify_config.HOSTED_POOL_CREDITS, quota_used=0, pool_type="trial"
        )
        db.session.add(credit_pool)
        db.session.commit()
        return credit_pool

    @classmethod
    def get_pool(cls, tenant_id: str, pool_type: str = "trial") -> TenantCreditPool | None:
        """get tenant credit pool"""
        return (
            db.session.query(TenantCreditPool)
            .filter_by(
                tenant_id=tenant_id,
                pool_type=pool_type,
            )
            .first()
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
        """check and deduct credits, returns actual credits deducted"""

        pool = cls.get_pool(tenant_id, pool_type)
        if not pool:
            raise QuotaExceededError("Credit pool not found")

        if pool.remaining_credits <= 0:
            raise QuotaExceededError("No credits remaining")

        # deduct all remaining credits if less than required
        actual_credits = min(credits_required, pool.remaining_credits)

        try:
            with Session(db.engine) as session:
                stmt = (
                    update(TenantCreditPool)
                    .where(
                        TenantCreditPool.tenant_id == tenant_id,
                        TenantCreditPool.pool_type == pool_type,
                    )
                    .values(quota_used=TenantCreditPool.quota_used + actual_credits)
                )
                session.execute(stmt)
                session.commit()
        except Exception:
            logger.exception("Failed to deduct credits for tenant %s", tenant_id)
            raise QuotaExceededError("Failed to deduct credits")

        return actual_credits
