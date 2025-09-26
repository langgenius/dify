import logging
from typing import Optional

from sqlalchemy import update

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
    def get_pool(cls, tenant_id: str) -> Optional[TenantCreditPool]:
        """get tenant credit pool"""
        return (
            db.session.query(TenantCreditPool)
            .filter_by(
                tenant_id=tenant_id,
            )
            .first()
        )

    @classmethod
    def get_or_create_pool(cls, tenant_id: str) -> TenantCreditPool:
        """get or create credit pool"""
        # First try to get existing pool
        pool = cls.get_pool(tenant_id)
        if pool:
            return pool

        # Create new pool if not exists, handle race condition
        try:
            # Double-check in case another thread created it
            pool = (
                db.session.query(TenantCreditPool)
                .filter_by(
                    tenant_id=tenant_id,
                )
                .first()
            )
            if pool:
                return pool

            # Create new pool
            pool = TenantCreditPool(
                tenant_id=tenant_id, quota_limit=dify_config.HOSTED_POOL_CREDITS, quota_used=0, pool_type="trial"
            )
            db.session.add(pool)
            db.session.commit()

        except Exception:
            # If creation fails (e.g., due to race condition), rollback and try to get existing one
            db.session.rollback()
            pool = cls.get_pool(tenant_id)
            if not pool:
                raise

        return pool

    @classmethod
    def check_and_deduct_credits(
        cls,
        tenant_id: str,
        credits_required: int,
    ):
        """check and deduct credits"""
        logger.info("check and deduct credits")
        pool = cls.get_pool(tenant_id)
        if not pool:
            raise QuotaExceededError("Credit pool not found")

        if pool.remaining_credits < credits_required:
            raise QuotaExceededError(
                f"Insufficient credits. Required: {credits_required}, Available: {pool.remaining_credits}"
            )

        with db.session.begin():
            update_values = {"quota_used": pool.quota_used + credits_required}

            where_conditions = [
                TenantCreditPool.tenant_id == tenant_id,
                TenantCreditPool.quota_used + credits_required <= TenantCreditPool.quota_limit,
            ]
            stmt = update(TenantCreditPool).where(*where_conditions).values(**update_values)
            db.session.execute(stmt)

    @classmethod
    def check_deduct_credits(cls, tenant_id: str, credits_required: int) -> bool:
        """check and deduct credits"""
        pool = cls.get_pool(tenant_id)
        if not pool:
            return False

        if pool.remaining_credits < credits_required:
            return False
        return True
