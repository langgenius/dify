from collections.abc import Generator
from types import SimpleNamespace
from unittest.mock import ANY, MagicMock, patch
from uuid import uuid4

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from core.errors.error import QuotaExceededError
from models import TenantCreditPool
from models.enums import ProviderQuotaType
from services.credit_pool_service import (
    CREDIT_POOL_TENANT_LOCK_BLOCKING_TIMEOUT_SECONDS,
    CREDIT_POOL_TENANT_LOCK_TIMEOUT_SECONDS,
    FEATURE_KEY_CREDIT_POOL,
    CreditPoolBalance,
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


def _make_session(engine: Engine) -> Session:
    return sessionmaker(bind=engine, expire_on_commit=False)()


def _get_quota_used(*, engine: Engine, pool_id: str) -> int | None:
    with engine.connect() as connection:
        return connection.scalar(select(TenantCreditPool.quota_used).where(TenantCreditPool.id == pool_id))


def _make_redis_lock() -> MagicMock:
    lock = MagicMock()
    lock.acquire.return_value = True
    return lock


@pytest.fixture(autouse=True)
def _disable_billing_quota_by_default() -> Generator[None, None, None]:
    with patch("services.credit_pool_service.dify_config.BILLING_ENABLED", False):
        yield


def test_get_pool_uses_provided_session() -> None:
    engine, tenant_id, _ = _create_engine_with_pool(quota_limit=10, quota_used=2)

    with _make_session(engine) as session:
        pool = CreditPoolService.get_pool(tenant_id=tenant_id, pool_type=ProviderQuotaType.TRIAL, session=session)

    assert pool is not None
    assert pool.tenant_id == tenant_id
    assert pool.quota_used == 2


def test_credit_pool_balance_unlimited_remaining_and_sufficiency() -> None:
    pool = CreditPoolBalance(tenant_id="tenant-1", pool_type="paid", quota_limit=-1, quota_used=999)

    assert pool.remaining_credits == -1
    assert pool.has_sufficient_credits(10_000)


def test_check_and_deduct_credits_deducts_exact_amount_when_sufficient() -> None:
    engine, tenant_id, pool_id = _create_engine_with_pool(quota_limit=10, quota_used=2)

    with _make_session(engine) as session:
        deducted_credits = CreditPoolService.check_and_deduct_credits(
            tenant_id=tenant_id, credits_required=3, session=session
        )

    assert deducted_credits == 3
    assert _get_quota_used(engine=engine, pool_id=pool_id) == 5


def test_check_and_deduct_credits_returns_zero_for_non_positive_request() -> None:
    assert (
        CreditPoolService.check_and_deduct_credits(tenant_id=str(uuid4()), credits_required=0, session=MagicMock()) == 0
    )


def test_check_and_deduct_credits_raises_when_pool_is_missing() -> None:
    engine = create_engine("sqlite:///:memory:")
    TenantCreditPool.__table__.create(engine)

    with _make_session(engine) as session, pytest.raises(QuotaExceededError, match="Credit pool not found"):
        CreditPoolService.check_and_deduct_credits(tenant_id=str(uuid4()), credits_required=1, session=session)


def test_check_and_deduct_credits_raises_when_pool_is_empty() -> None:
    engine, tenant_id, pool_id = _create_engine_with_pool(quota_limit=10, quota_used=10)

    with _make_session(engine) as session, pytest.raises(QuotaExceededError, match="No credits remaining"):
        CreditPoolService.check_and_deduct_credits(tenant_id=tenant_id, credits_required=1, session=session)

    assert _get_quota_used(engine=engine, pool_id=pool_id) == 10


def test_check_and_deduct_credits_raises_without_partial_deduction_when_insufficient() -> None:
    engine, tenant_id, pool_id = _create_engine_with_pool(quota_limit=10, quota_used=9)

    with _make_session(engine) as session, pytest.raises(QuotaExceededError, match="Insufficient credits remaining"):
        CreditPoolService.check_and_deduct_credits(tenant_id=tenant_id, credits_required=3, session=session)

    assert _get_quota_used(engine=engine, pool_id=pool_id) == 9


def test_check_and_deduct_credits_wraps_unexpected_deduction_errors() -> None:
    engine, tenant_id, pool_id = _create_engine_with_pool(quota_limit=10, quota_used=2)

    with (
        _make_session(engine) as session,
        patch.object(CreditPoolService, "_get_locked_pool", side_effect=RuntimeError("database unavailable")),
        pytest.raises(QuotaExceededError, match="Failed to deduct credits"),
    ):
        CreditPoolService.check_and_deduct_credits(tenant_id=tenant_id, credits_required=1, session=session)

    assert _get_quota_used(engine=engine, pool_id=pool_id) == 2


def test_deduct_credits_capped_returns_zero_for_non_positive_request() -> None:
    assert CreditPoolService.deduct_credits_capped(tenant_id=str(uuid4()), credits_required=0, session=MagicMock()) == 0


def test_deduct_credits_capped_returns_zero_when_pool_is_missing() -> None:
    engine = create_engine("sqlite:///:memory:")
    TenantCreditPool.__table__.create(engine)

    with _make_session(engine) as session:
        deducted_credits = CreditPoolService.deduct_credits_capped(
            tenant_id=str(uuid4()), credits_required=1, session=session
        )

    assert deducted_credits == 0


def test_deduct_credits_capped_returns_zero_when_pool_is_empty() -> None:
    engine, tenant_id, pool_id = _create_engine_with_pool(quota_limit=10, quota_used=10)

    with _make_session(engine) as session:
        deducted_credits = CreditPoolService.deduct_credits_capped(
            tenant_id=tenant_id, credits_required=1, session=session
        )

    assert deducted_credits == 0
    assert _get_quota_used(engine=engine, pool_id=pool_id) == 10


def test_deduct_credits_capped_deducts_only_remaining_balance_when_insufficient() -> None:
    engine, tenant_id, pool_id = _create_engine_with_pool(quota_limit=10, quota_used=9)

    with _make_session(engine) as session:
        deducted_credits = CreditPoolService.deduct_credits_capped(
            tenant_id=tenant_id, credits_required=3, session=session
        )

    assert deducted_credits == 1
    assert _get_quota_used(engine=engine, pool_id=pool_id) == 10


def test_deduct_credits_capped_wraps_unexpected_deduction_errors() -> None:
    engine, tenant_id, pool_id = _create_engine_with_pool(quota_limit=10, quota_used=2)

    with (
        _make_session(engine) as session,
        patch.object(CreditPoolService, "_get_locked_pool", side_effect=RuntimeError("database unavailable")),
        pytest.raises(QuotaExceededError, match="Failed to deduct credits"),
    ):
        CreditPoolService.deduct_credits_capped(tenant_id=tenant_id, credits_required=1, session=session)

    assert _get_quota_used(engine=engine, pool_id=pool_id) == 2


def test_deduct_credits_capped_reraises_quota_exceeded_errors() -> None:
    engine, tenant_id, pool_id = _create_engine_with_pool(quota_limit=10, quota_used=2)

    with (
        _make_session(engine) as session,
        patch.object(CreditPoolService, "_get_locked_pool", side_effect=QuotaExceededError("quota unavailable")),
        pytest.raises(QuotaExceededError, match="quota unavailable"),
    ):
        CreditPoolService.deduct_credits_capped(tenant_id=tenant_id, credits_required=1, session=session)

    assert _get_quota_used(engine=engine, pool_id=pool_id) == 2


def test_check_and_deduct_credits_uses_tenant_redis_lock_before_db_deduction() -> None:
    tenant_id = "tenant-1"
    session = MagicMock()
    pool = SimpleNamespace(remaining_credits=10, quota_used=2)
    redis_lock = _make_redis_lock()

    with (
        patch("services.credit_pool_service.redis_client.lock", return_value=redis_lock) as lock,
        patch.object(CreditPoolService, "_get_locked_pool", return_value=pool) as get_locked_pool,
    ):
        result = CreditPoolService.check_and_deduct_credits(
            tenant_id=tenant_id,
            credits_required=3,
            pool_type=ProviderQuotaType.TRIAL,
            session=session,
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
    get_locked_pool.assert_called_once_with(session=session, tenant_id=tenant_id, pool_type="trial")


def test_deduct_credits_capped_uses_tenant_redis_lock_before_db_deduction() -> None:
    tenant_id = "tenant-1"
    session = MagicMock()
    pool = SimpleNamespace(remaining_credits=2, quota_used=8)
    redis_lock = _make_redis_lock()

    with (
        patch("services.credit_pool_service.redis_client.lock", return_value=redis_lock) as lock,
        patch.object(CreditPoolService, "_get_locked_pool", return_value=pool) as get_locked_pool,
    ):
        result = CreditPoolService.deduct_credits_capped(
            tenant_id=tenant_id,
            credits_required=5,
            pool_type=ProviderQuotaType.PAID,
            session=session,
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
    get_locked_pool.assert_called_once_with(session=session, tenant_id=tenant_id, pool_type="paid")


def test_get_pool_uses_billing_quota_balance_when_enabled() -> None:
    tenant_id = "tenant-1"
    with (
        patch("services.credit_pool_service.dify_config.BILLING_ENABLED", True),
        patch("services.billing_service.BillingService.quota_get_balance") as quota_get_balance,
    ):
        quota_get_balance.return_value = {
            "quota": 1000,
            "usage": 250,
            "available": 750,
            "reserved": 0,
            "exhausted_at": 1748908800,
        }

        pool = CreditPoolService.get_pool(tenant_id=tenant_id, pool_type=ProviderQuotaType.PAID)

    assert isinstance(pool, CreditPoolBalance)
    assert pool.quota_limit == 1000
    assert pool.quota_used == 250
    assert pool.exhausted_at == 1748908800
    assert pool.remaining_credits == 750
    quota_get_balance.assert_called_once_with(
        tenant_id=tenant_id,
        feature_key=FEATURE_KEY_CREDIT_POOL,
        bucket="paid",
    )


def test_check_and_deduct_credits_uses_billing_reserve_and_commit_when_enabled() -> None:
    tenant_id = "tenant-1"
    with (
        patch("services.credit_pool_service.dify_config.BILLING_ENABLED", True),
        patch("services.billing_service.BillingService.quota_reserve") as quota_reserve,
        patch("services.billing_service.BillingService.quota_commit") as quota_commit,
        patch("services.billing_service.BillingService.quota_release") as quota_release,
    ):
        quota_reserve.return_value = {"reservation_id": "reservation-1", "available": 7, "reserved": 3}

        result = CreditPoolService.check_and_deduct_credits(
            tenant_id=tenant_id,
            credits_required=3,
            pool_type=ProviderQuotaType.TRIAL,
        )

    assert result == 3
    quota_reserve.assert_called_once_with(
        tenant_id=tenant_id,
        feature_key=FEATURE_KEY_CREDIT_POOL,
        bucket="trial",
        request_id=ANY,
        amount=3,
        meta={"source": "credit_pool.check_and_deduct"},
    )
    quota_commit.assert_called_once_with(
        tenant_id=tenant_id,
        feature_key=FEATURE_KEY_CREDIT_POOL,
        bucket="trial",
        reservation_id="reservation-1",
        actual_amount=3,
        meta={"source": "credit_pool.check_and_deduct"},
    )
    quota_release.assert_not_called()


def test_check_and_deduct_credits_raises_when_billing_reserve_is_insufficient() -> None:
    with (
        patch("services.credit_pool_service.dify_config.BILLING_ENABLED", True),
        patch("services.billing_service.BillingService.quota_reserve") as quota_reserve,
    ):
        quota_reserve.return_value = {"reservation_id": "", "available": 1, "reserved": 0}

        with pytest.raises(QuotaExceededError, match="Insufficient credits remaining"):
            CreditPoolService.check_and_deduct_credits(tenant_id="tenant-1", credits_required=3)


def test_check_and_deduct_credits_releases_billing_reservation_when_commit_fails() -> None:
    with (
        patch("services.credit_pool_service.dify_config.BILLING_ENABLED", True),
        patch("services.billing_service.BillingService.quota_reserve") as quota_reserve,
        patch("services.billing_service.BillingService.quota_commit", side_effect=RuntimeError("commit failed")),
        patch("services.billing_service.BillingService.quota_release") as quota_release,
    ):
        quota_reserve.return_value = {"reservation_id": "reservation-1", "available": 7, "reserved": 3}

        with pytest.raises(RuntimeError, match="commit failed"):
            CreditPoolService.check_and_deduct_credits(tenant_id="tenant-1", credits_required=3)

    quota_release.assert_called_once_with(
        tenant_id="tenant-1",
        feature_key=FEATURE_KEY_CREDIT_POOL,
        bucket="trial",
        reservation_id="reservation-1",
    )


def test_check_and_deduct_credits_logs_when_billing_release_fails() -> None:
    with (
        patch("services.credit_pool_service.dify_config.BILLING_ENABLED", True),
        patch("services.billing_service.BillingService.quota_reserve") as quota_reserve,
        patch("services.billing_service.BillingService.quota_commit", side_effect=RuntimeError("commit failed")),
        patch(
            "services.billing_service.BillingService.quota_release", side_effect=RuntimeError("release failed")
        ) as quota_release,
        patch("services.credit_pool_service.logger.warning") as logger_warning,
    ):
        quota_reserve.return_value = {"reservation_id": "reservation-1", "available": 7, "reserved": 3}

        with pytest.raises(RuntimeError, match="commit failed"):
            CreditPoolService.check_and_deduct_credits(tenant_id="tenant-1", credits_required=3)

    quota_release.assert_called_once_with(
        tenant_id="tenant-1",
        feature_key=FEATURE_KEY_CREDIT_POOL,
        bucket="trial",
        reservation_id="reservation-1",
    )
    logger_warning.assert_called_once()
    assert logger_warning.call_args.args[3] == "reservation-1"
    assert logger_warning.call_args.kwargs["exc_info"] is True


def test_deduct_credits_capped_uses_billing_consume_capped_when_enabled() -> None:
    tenant_id = "tenant-1"
    with (
        patch("services.credit_pool_service.dify_config.BILLING_ENABLED", True),
        patch("services.billing_service.BillingService.quota_consume_capped") as quota_consume_capped,
    ):
        quota_consume_capped.return_value = {
            "deducted": 2,
            "available": 0,
            "reserved": 0,
            "quota": 10,
            "usage": 10,
        }

        result = CreditPoolService.deduct_credits_capped(
            tenant_id=tenant_id,
            credits_required=5,
            pool_type=ProviderQuotaType.PAID,
        )

    assert result == 2
    quota_consume_capped.assert_called_once_with(
        tenant_id=tenant_id,
        feature_key=FEATURE_KEY_CREDIT_POOL,
        bucket="paid",
        request_id=ANY,
        amount=5,
        meta={"source": "credit_pool.deduct_capped"},
    )


@pytest.mark.parametrize(
    "deduct_method",
    [
        CreditPoolService.check_and_deduct_credits,
        CreditPoolService.deduct_credits_capped,
    ],
)
def test_non_positive_credit_request_skips_tenant_redis_lock(deduct_method) -> None:
    with patch("services.credit_pool_service.redis_client.lock") as lock:
        result = deduct_method(tenant_id="tenant-1", credits_required=0, session=MagicMock())

    assert result == 0
    lock.assert_not_called()


def test_check_and_deduct_credits_wraps_redis_lock_errors_without_querying_db() -> None:
    session = MagicMock()

    with (
        patch("services.credit_pool_service.redis_client.lock", side_effect=RuntimeError("redis unavailable")),
        pytest.raises(QuotaExceededError, match="Failed to deduct credits"),
    ):
        CreditPoolService.check_and_deduct_credits(tenant_id="tenant-1", credits_required=1, session=session)

    session.scalar.assert_not_called()


def test_deduct_credits_capped_ignores_release_errors_after_successful_deduction() -> None:
    session = MagicMock()
    pool = SimpleNamespace(remaining_credits=3, quota_used=7)
    redis_lock = _make_redis_lock()
    redis_lock.release.side_effect = RuntimeError("release failed")

    with (
        patch("services.credit_pool_service.redis_client.lock", return_value=redis_lock),
        patch.object(CreditPoolService, "_get_locked_pool", return_value=pool),
    ):
        result = CreditPoolService.deduct_credits_capped(tenant_id="tenant-1", credits_required=2, session=session)

    assert result == 2
    assert pool.quota_used == 9
    redis_lock.release.assert_called_once_with()
