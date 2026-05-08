from types import SimpleNamespace
from unittest.mock import patch
from uuid import uuid4

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.engine import Engine

from core.errors.error import QuotaExceededError
from models import TenantCreditPool
from models.enums import ProviderQuotaType
from services.credit_pool_service import CreditPoolService


def _create_engine_with_pool(*, quota_limit: int, quota_used: int) -> tuple[Engine, str, str]:
    engine = create_engine("sqlite:///:memory:")
    TenantCreditPool.__table__.create(engine)
    tenant_id = str(uuid4())
    pool_id = str(uuid4())
    with engine.begin() as connection:
        connection.execute(
            TenantCreditPool.__table__.insert(),
            {
                "id": pool_id,
                "tenant_id": tenant_id,
                "pool_type": ProviderQuotaType.TRIAL,
                "quota_limit": quota_limit,
                "quota_used": quota_used,
            },
        )
    return engine, tenant_id, pool_id


def _get_quota_used(*, engine: Engine, pool_id: str) -> int | None:
    with engine.connect() as connection:
        return connection.scalar(select(TenantCreditPool.quota_used).where(TenantCreditPool.id == pool_id))


def test_check_and_deduct_credits_deducts_exact_amount_when_sufficient() -> None:
    engine, tenant_id, pool_id = _create_engine_with_pool(quota_limit=10, quota_used=2)

    with patch("services.credit_pool_service.db", SimpleNamespace(engine=engine)):
        deducted_credits = CreditPoolService.check_and_deduct_credits(tenant_id=tenant_id, credits_required=3)

    assert deducted_credits == 3
    assert _get_quota_used(engine=engine, pool_id=pool_id) == 5


def test_check_and_deduct_credits_raises_without_partial_deduction_when_insufficient() -> None:
    engine, tenant_id, pool_id = _create_engine_with_pool(quota_limit=10, quota_used=9)

    with (
        patch("services.credit_pool_service.db", SimpleNamespace(engine=engine)),
        pytest.raises(QuotaExceededError, match="Insufficient credits remaining"),
    ):
        CreditPoolService.check_and_deduct_credits(tenant_id=tenant_id, credits_required=3)

    assert _get_quota_used(engine=engine, pool_id=pool_id) == 9


def test_deduct_credits_capped_deducts_only_remaining_balance_when_insufficient() -> None:
    engine, tenant_id, pool_id = _create_engine_with_pool(quota_limit=10, quota_used=9)

    with patch("services.credit_pool_service.db", SimpleNamespace(engine=engine)):
        deducted_credits = CreditPoolService.deduct_credits_capped(tenant_id=tenant_id, credits_required=3)

    assert deducted_credits == 1
    assert _get_quota_used(engine=engine, pool_id=pool_id) == 10
