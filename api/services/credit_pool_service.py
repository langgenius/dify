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
    def check_and_deduct_credits(
        cls,
        tenant_id: str,
        credits_required: int,
        pool_type: str = "trial",
    ):
        """check and deduct credits"""

        pool = cls.get_pool(tenant_id, pool_type)
        if not pool:
            raise QuotaExceededError("Credit pool not found")

        if pool.remaining_credits < credits_required:
            raise QuotaExceededError(
                f"Insufficient credits. Required: {credits_required}, Available: {pool.remaining_credits}"
            )
        try:
            with Session(db.engine) as session:
                update_values = {"quota_used": pool.quota_used + credits_required}

                where_conditions = [
                    TenantCreditPool.pool_type == pool_type,
                    TenantCreditPool.tenant_id == tenant_id,
                    TenantCreditPool.quota_used + credits_required <= TenantCreditPool.quota_limit,
                ]
                stmt = update(TenantCreditPool).where(*where_conditions).values(**update_values)
                session.execute(stmt)
                session.commit()
        except Exception:
            raise QuotaExceededError("Failed to deduct credits")
