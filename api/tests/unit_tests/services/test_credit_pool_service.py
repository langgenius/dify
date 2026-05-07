from types import SimpleNamespace
from unittest.mock import patch
from uuid import uuid4

import pytest
from sqlalchemy import create_engine, select

from core.errors.error import QuotaExceededError
from models import TenantCreditPool
from models.enums import ProviderQuotaType
from services.credit_pool_service import CreditPoolService


def test_check_and_deduct_credits_depletes_pool_and_raises_when_insufficient() -> None:
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
                "quota_limit": 10,
                "quota_used": 9,
            },
        )

    with (
        patch("services.credit_pool_service.db", SimpleNamespace(engine=engine)),
        pytest.raises(QuotaExceededError, match="Insufficient credits remaining"),
    ):
        CreditPoolService.check_and_deduct_credits(tenant_id=tenant_id, credits_required=3)

    with engine.connect() as connection:
        quota_used = connection.scalar(select(TenantCreditPool.quota_used).where(TenantCreditPool.id == pool_id))

    assert quota_used == 10
