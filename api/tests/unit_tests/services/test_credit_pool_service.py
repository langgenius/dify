from collections.abc import Generator
from contextlib import contextmanager
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.engine import Engine
from sqlalchemy.orm import sessionmaker

from core.errors.error import QuotaExceededError
from models import TenantCreditPool
from models.enums import ProviderQuotaType
from services.credit_pool_service import (
    CREDIT_POOL_TENANT_LOCK_BLOCKING_TIMEOUT_SECONDS,
    CREDIT_POOL_TENANT_LOCK_TIMEOUT_SECONDS,
    CreditPoolService,
)


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
def _patched_session_factory(engine: Engine) -> Generator[None, None, None]:
    session_maker = sessionmaker(bind=engine, expire_on_commit=False)
    with patch("services.credit_pool_service.session_factory.get_session_maker", return_value=session_maker):
        yield


def _get_quota_used(*, engine: Engine, pool_id: str) -> int | None:
    with engine.connect() as connection:
        return connection.scalar(select(TenantCreditPool.quota_used).where(TenantCreditPool.id == pool_id))


def _make_session_maker(session: MagicMock) -> MagicMock:
    session_maker = MagicMock()
    transaction = session_maker.begin.return_value
    transaction.__enter__.return_value = session
    transaction.__exit__.return_value = None
    return session_maker


def _make_redis_lock() -> MagicMock:
    lock = MagicMock()
    lock.acquire.return_value = True
    return lock


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


def test_check_and_deduct_credits_uses_tenant_redis_lock_before_db_deduction() -> None:
    tenant_id = "tenant-1"
    session = MagicMock()
    session_maker = _make_session_maker(session)
    pool = SimpleNamespace(remaining_credits=10, quota_used=2)
    redis_lock = _make_redis_lock()

    with (
        patch("services.credit_pool_service.redis_client.lock", return_value=redis_lock) as lock,
        patch("services.credit_pool_service.session_factory.get_session_maker", return_value=session_maker),
        patch.object(CreditPoolService, "_get_locked_pool", return_value=pool) as get_locked_pool,
    ):
        result = CreditPoolService.check_and_deduct_credits(
            tenant_id=tenant_id,
            credits_required=3,
            pool_type=ProviderQuotaType.TRIAL,
        )

    assert result == 3
    assert pool.quota_used == 5
    lock.assert_called_once_with(
        "credit_pool:tenant:tenant-1:deduct_lock",
        timeout=CREDIT_POOL_TENANT_LOCK_TIMEOUT_SECONDS,
        blocking_timeout=CREDIT_POOL_TENANT_LOCK_BLOCKING_TIMEOUT_SECONDS,
    )
    redis_lock.acquire.assert_called_once_with(blocking=True)
    redis_lock.release.assert_called_once_with()
    get_locked_pool.assert_called_once_with(session=session, tenant_id=tenant_id, pool_type=ProviderQuotaType.TRIAL)


def test_deduct_credits_capped_uses_tenant_redis_lock_before_db_deduction() -> None:
    tenant_id = "tenant-1"
    session = MagicMock()
    session_maker = _make_session_maker(session)
    pool = SimpleNamespace(remaining_credits=2, quota_used=8)
    redis_lock = _make_redis_lock()

    with (
        patch("services.credit_pool_service.redis_client.lock", return_value=redis_lock) as lock,
        patch("services.credit_pool_service.session_factory.get_session_maker", return_value=session_maker),
        patch.object(CreditPoolService, "_get_locked_pool", return_value=pool) as get_locked_pool,
    ):
        result = CreditPoolService.deduct_credits_capped(
            tenant_id=tenant_id,
            credits_required=5,
            pool_type=ProviderQuotaType.PAID,
        )

    assert result == 2
    assert pool.quota_used == 10
    lock.assert_called_once_with(
        "credit_pool:tenant:tenant-1:deduct_lock",
        timeout=CREDIT_POOL_TENANT_LOCK_TIMEOUT_SECONDS,
        blocking_timeout=CREDIT_POOL_TENANT_LOCK_BLOCKING_TIMEOUT_SECONDS,
    )
    redis_lock.acquire.assert_called_once_with(blocking=True)
    redis_lock.release.assert_called_once_with()
    get_locked_pool.assert_called_once_with(session=session, tenant_id=tenant_id, pool_type=ProviderQuotaType.PAID)


@pytest.mark.parametrize(
    "deduct_method",
    [
        CreditPoolService.check_and_deduct_credits,
        CreditPoolService.deduct_credits_capped,
    ],
)
def test_non_positive_credit_request_skips_tenant_redis_lock(deduct_method) -> None:
    with patch("services.credit_pool_service.redis_client.lock") as lock:
        result = deduct_method(tenant_id="tenant-1", credits_required=0)

    assert result == 0
    lock.assert_not_called()


def test_check_and_deduct_credits_wraps_redis_lock_errors_without_querying_db() -> None:
    session_maker = MagicMock()

    with (
        patch("services.credit_pool_service.redis_client.lock", side_effect=RuntimeError("redis unavailable")),
        patch("services.credit_pool_service.session_factory.get_session_maker", return_value=session_maker),
        pytest.raises(QuotaExceededError, match="Failed to deduct credits"),
    ):
        CreditPoolService.check_and_deduct_credits(tenant_id="tenant-1", credits_required=1)

    session_maker.begin.assert_not_called()


def test_deduct_credits_capped_ignores_release_errors_after_successful_deduction() -> None:
    session = MagicMock()
    session_maker = _make_session_maker(session)
    pool = SimpleNamespace(remaining_credits=3, quota_used=7)
    redis_lock = _make_redis_lock()
    redis_lock.release.side_effect = RuntimeError("release failed")

    with (
        patch("services.credit_pool_service.redis_client.lock", return_value=redis_lock),
        patch("services.credit_pool_service.session_factory.get_session_maker", return_value=session_maker),
        patch.object(CreditPoolService, "_get_locked_pool", return_value=pool),
    ):
        result = CreditPoolService.deduct_credits_capped(tenant_id="tenant-1", credits_required=2)

    assert result == 2
    assert pool.quota_used == 9
    redis_lock.release.assert_called_once_with()
