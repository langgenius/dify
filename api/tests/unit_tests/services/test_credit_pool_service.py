from collections.abc import Iterator
from contextlib import contextmanager
from unittest.mock import patch
from uuid import uuid4

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.engine import Engine
from sqlalchemy.orm import sessionmaker

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


@contextmanager
def _patched_session_factory(engine: Engine) -> Iterator[None]:
    session_maker = sessionmaker(bind=engine, expire_on_commit=False)
    with patch("services.credit_pool_service.session_factory.get_session_maker", return_value=session_maker):
        yield


def _get_quota_used(*, engine: Engine, pool_id: str) -> int | None:
    with engine.connect() as connection:
        return connection.scalar(select(TenantCreditPool.quota_used).where(TenantCreditPool.id == pool_id))


def test_get_pool_uses_configured_session_factory_without_flask_app_context() -> None:
    engine, tenant_id, _ = _create_engine_with_pool(quota_limit=10, quota_used=2)

    with _patched_session_factory(engine):
        pool = CreditPoolService.get_pool(tenant_id=tenant_id, pool_type=ProviderQuotaType.TRIAL)

    assert pool is not None
    assert pool.tenant_id == tenant_id
    assert pool.quota_used == 2


def test_check_and_deduct_credits_deducts_exact_amount_when_sufficient() -> None:
    engine, tenant_id, pool_id = _create_engine_with_pool(quota_limit=10, quota_used=2)

    with _patched_session_factory(engine):
        deducted_credits = CreditPoolService.check_and_deduct_credits(tenant_id=tenant_id, credits_required=3)

    assert deducted_credits == 3
    assert _get_quota_used(engine=engine, pool_id=pool_id) == 5


def test_check_and_deduct_credits_returns_zero_for_non_positive_request() -> None:
    assert CreditPoolService.check_and_deduct_credits(tenant_id=str(uuid4()), credits_required=0) == 0


def test_check_and_deduct_credits_raises_when_pool_is_missing() -> None:
    engine = create_engine("sqlite:///:memory:")
    TenantCreditPool.__table__.create(engine)

    with (
        _patched_session_factory(engine),
        pytest.raises(QuotaExceededError, match="Credit pool not found"),
    ):
        CreditPoolService.check_and_deduct_credits(tenant_id=str(uuid4()), credits_required=1)


def test_check_and_deduct_credits_raises_when_pool_is_empty() -> None:
    engine, tenant_id, pool_id = _create_engine_with_pool(quota_limit=10, quota_used=10)

    with (
        _patched_session_factory(engine),
        pytest.raises(QuotaExceededError, match="No credits remaining"),
    ):
        CreditPoolService.check_and_deduct_credits(tenant_id=tenant_id, credits_required=1)

    assert _get_quota_used(engine=engine, pool_id=pool_id) == 10


def test_check_and_deduct_credits_raises_without_partial_deduction_when_insufficient() -> None:
    engine, tenant_id, pool_id = _create_engine_with_pool(quota_limit=10, quota_used=9)

    with (
        _patched_session_factory(engine),
        pytest.raises(QuotaExceededError, match="Insufficient credits remaining"),
    ):
        CreditPoolService.check_and_deduct_credits(tenant_id=tenant_id, credits_required=3)

    assert _get_quota_used(engine=engine, pool_id=pool_id) == 9


def test_check_and_deduct_credits_wraps_unexpected_deduction_errors() -> None:
    engine, tenant_id, pool_id = _create_engine_with_pool(quota_limit=10, quota_used=2)

    with (
        _patched_session_factory(engine),
        patch.object(CreditPoolService, "_get_locked_pool", side_effect=RuntimeError("database unavailable")),
        pytest.raises(QuotaExceededError, match="Failed to deduct credits"),
    ):
        CreditPoolService.check_and_deduct_credits(tenant_id=tenant_id, credits_required=1)

    assert _get_quota_used(engine=engine, pool_id=pool_id) == 2


def test_deduct_credits_capped_returns_zero_for_non_positive_request() -> None:
    assert CreditPoolService.deduct_credits_capped(tenant_id=str(uuid4()), credits_required=0) == 0


def test_deduct_credits_capped_returns_zero_when_pool_is_missing() -> None:
    engine = create_engine("sqlite:///:memory:")
    TenantCreditPool.__table__.create(engine)

    with _patched_session_factory(engine):
        deducted_credits = CreditPoolService.deduct_credits_capped(tenant_id=str(uuid4()), credits_required=1)

    assert deducted_credits == 0


def test_deduct_credits_capped_returns_zero_when_pool_is_empty() -> None:
    engine, tenant_id, pool_id = _create_engine_with_pool(quota_limit=10, quota_used=10)

    with _patched_session_factory(engine):
        deducted_credits = CreditPoolService.deduct_credits_capped(tenant_id=tenant_id, credits_required=1)

    assert deducted_credits == 0
    assert _get_quota_used(engine=engine, pool_id=pool_id) == 10


def test_deduct_credits_capped_deducts_only_remaining_balance_when_insufficient() -> None:
    engine, tenant_id, pool_id = _create_engine_with_pool(quota_limit=10, quota_used=9)

    with _patched_session_factory(engine):
        deducted_credits = CreditPoolService.deduct_credits_capped(tenant_id=tenant_id, credits_required=3)

    assert deducted_credits == 1
    assert _get_quota_used(engine=engine, pool_id=pool_id) == 10


def test_deduct_credits_capped_wraps_unexpected_deduction_errors() -> None:
    engine, tenant_id, pool_id = _create_engine_with_pool(quota_limit=10, quota_used=2)

    with (
        _patched_session_factory(engine),
        patch.object(CreditPoolService, "_get_locked_pool", side_effect=RuntimeError("database unavailable")),
        pytest.raises(QuotaExceededError, match="Failed to deduct credits"),
    ):
        CreditPoolService.deduct_credits_capped(tenant_id=tenant_id, credits_required=1)

    assert _get_quota_used(engine=engine, pool_id=pool_id) == 2


def test_deduct_credits_capped_reraises_quota_exceeded_errors() -> None:
    engine, tenant_id, pool_id = _create_engine_with_pool(quota_limit=10, quota_used=2)

    with (
        _patched_session_factory(engine),
        patch.object(CreditPoolService, "_get_locked_pool", side_effect=QuotaExceededError("quota unavailable")),
        pytest.raises(QuotaExceededError, match="quota unavailable"),
    ):
        CreditPoolService.deduct_credits_capped(tenant_id=tenant_id, credits_required=1)

    assert _get_quota_used(engine=engine, pool_id=pool_id) == 2
