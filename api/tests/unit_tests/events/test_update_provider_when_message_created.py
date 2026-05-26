from collections.abc import Generator
from contextlib import contextmanager
from datetime import datetime
from types import SimpleNamespace
from unittest.mock import patch
from uuid import uuid4

import pytest
from redis import RedisError
from sqlalchemy import create_engine, select
from sqlalchemy.engine import Engine
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import sessionmaker

from core.app.entities.app_invoke_entities import ChatAppGenerateEntity
from core.entities.provider_entities import ProviderQuotaType, QuotaUnit
from events.event_handlers import update_provider_when_message_created
from models import TenantCreditPool
from models.provider import Provider, ProviderType


@contextmanager
def _patched_credit_pool_session_factory(engine: Engine) -> Generator[None, None, None]:
    session_maker = sessionmaker(bind=engine, expire_on_commit=False)
    with patch("services.credit_pool_service.session_factory.get_session_maker", return_value=session_maker):
        yield


def test_message_created_trial_credit_accounting_does_not_raise_when_balance_is_insufficient() -> None:
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

    system_configuration = SimpleNamespace(
        current_quota_type=ProviderQuotaType.TRIAL,
        quota_configurations=[
            SimpleNamespace(
                quota_type=ProviderQuotaType.TRIAL,
                quota_unit=QuotaUnit.TOKENS,
                quota_limit=10,
            )
        ],
    )
    application_generate_entity = ChatAppGenerateEntity.model_construct(
        app_config=SimpleNamespace(tenant_id=tenant_id),
        model_conf=SimpleNamespace(
            provider="openai",
            model="gpt-4o",
            provider_model_bundle=SimpleNamespace(
                configuration=SimpleNamespace(
                    using_provider_type=ProviderType.SYSTEM,
                    system_configuration=system_configuration,
                )
            ),
        ),
    )
    message = SimpleNamespace(message_tokens=2, answer_tokens=1)

    with (
        _patched_credit_pool_session_factory(engine),
        patch.object(update_provider_when_message_created, "_execute_provider_updates"),
    ):
        update_provider_when_message_created.handle(
            sender=message,
            application_generate_entity=application_generate_entity,
        )

    with engine.connect() as connection:
        quota_used = connection.scalar(select(TenantCreditPool.quota_used).where(TenantCreditPool.id == pool_id))

    assert quota_used == 10


def test_message_created_paid_credit_accounting_uses_paid_pool() -> None:
    tenant_id = str(uuid4())
    system_configuration = SimpleNamespace(
        current_quota_type=ProviderQuotaType.PAID,
        quota_configurations=[
            SimpleNamespace(
                quota_type=ProviderQuotaType.PAID,
                quota_unit=QuotaUnit.TOKENS,
                quota_limit=10,
            )
        ],
    )
    application_generate_entity = ChatAppGenerateEntity.model_construct(
        app_config=SimpleNamespace(tenant_id=tenant_id),
        model_conf=SimpleNamespace(
            provider="openai",
            model="gpt-4o",
            provider_model_bundle=SimpleNamespace(
                configuration=SimpleNamespace(
                    using_provider_type=ProviderType.SYSTEM,
                    system_configuration=system_configuration,
                )
            ),
        ),
    )
    message = SimpleNamespace(message_tokens=2, answer_tokens=1)

    with (
        patch.object(update_provider_when_message_created, "_deduct_credit_pool_quota_capped") as mock_deduct,
        patch.object(update_provider_when_message_created, "_execute_provider_updates"),
    ):
        update_provider_when_message_created.handle(
            sender=message,
            application_generate_entity=application_generate_entity,
        )

    mock_deduct.assert_called_once_with(
        tenant_id=tenant_id,
        credits_required=3,
        pool_type="paid",
    )


def test_capped_credit_pool_accounting_skips_exhaustion_warning_when_full_amount_is_deducted(caplog) -> None:
    with patch(
        "services.credit_pool_service.CreditPoolService.deduct_credits_capped",
        return_value=3,
    ) as mock_deduct:
        update_provider_when_message_created._deduct_credit_pool_quota_capped(
            tenant_id="tenant-id",
            credits_required=3,
            pool_type="trial",
        )

    mock_deduct.assert_called_once_with(
        tenant_id="tenant-id",
        credits_required=3,
        pool_type="trial",
    )
    assert "Credit pool exhausted during message-created accounting" not in caplog.text


def test_claim_last_used_update_window_uses_atomic_redis_set() -> None:
    timestamp = datetime(2026, 5, 26, 12, 0, 0)

    with patch.object(update_provider_when_message_created.redis_client, "set", return_value=True) as mock_set:
        claimed = update_provider_when_message_created._claim_last_used_update_window("cache-key", timestamp)

    assert claimed is True
    mock_set.assert_called_once_with(
        "cache-key",
        str(timestamp.timestamp()),
        ex=update_provider_when_message_created.LAST_USED_UPDATE_WINDOW_SECONDS,
        nx=True,
    )


def test_claim_last_used_update_window_returns_false_when_window_exists() -> None:
    timestamp = datetime(2026, 5, 26, 12, 0, 0)

    with patch.object(update_provider_when_message_created.redis_client, "set", return_value=None):
        claimed = update_provider_when_message_created._claim_last_used_update_window("cache-key", timestamp)

    assert claimed is False


def test_claim_last_used_update_window_fails_open_when_redis_is_unavailable() -> None:
    timestamp = datetime(2026, 5, 26, 12, 0, 0)

    with patch.object(update_provider_when_message_created.redis_client, "set", side_effect=RedisError("down")):
        claimed = update_provider_when_message_created._claim_last_used_update_window("cache-key", timestamp)

    assert claimed is True


def test_execute_provider_updates_skips_last_used_when_throttle_window_is_already_claimed() -> None:
    engine = create_engine("sqlite:///:memory:")
    Provider.__table__.create(engine)
    tenant_id = str(uuid4())
    provider_id = str(uuid4())

    with engine.begin() as connection:
        connection.execute(
            Provider.__table__.insert(),
            {
                "id": provider_id,
                "tenant_id": tenant_id,
                "provider_name": "openai",
                "provider_type": ProviderType.CUSTOM,
                "is_valid": True,
            },
        )

    operation = update_provider_when_message_created._ProviderUpdateOperation(
        filters=update_provider_when_message_created._ProviderUpdateFilters(
            tenant_id=tenant_id,
            provider_name="openai",
        ),
        values=update_provider_when_message_created._ProviderUpdateValues(last_used=datetime(2026, 5, 26, 12, 0, 0)),
    )

    with (
        patch.object(update_provider_when_message_created, "db", SimpleNamespace(engine=engine)),
        patch.object(update_provider_when_message_created, "_claim_last_used_update_window", return_value=False),
    ):
        update_provider_when_message_created._execute_provider_updates([operation])

    with engine.connect() as connection:
        last_used = connection.scalar(select(Provider.last_used).where(Provider.id == provider_id))

    assert last_used is None


def test_execute_provider_updates_writes_last_used_after_claiming_throttle_window() -> None:
    engine = create_engine("sqlite:///:memory:")
    Provider.__table__.create(engine)
    tenant_id = str(uuid4())
    provider_id = str(uuid4())
    last_used_at = datetime(2026, 5, 26, 12, 0, 0)

    with engine.begin() as connection:
        connection.execute(
            Provider.__table__.insert(),
            {
                "id": provider_id,
                "tenant_id": tenant_id,
                "provider_name": "openai",
                "provider_type": ProviderType.CUSTOM,
                "is_valid": True,
            },
        )

    operation = update_provider_when_message_created._ProviderUpdateOperation(
        filters=update_provider_when_message_created._ProviderUpdateFilters(
            tenant_id=tenant_id,
            provider_name="openai",
        ),
        values=update_provider_when_message_created._ProviderUpdateValues(last_used=last_used_at),
    )

    with (
        patch.object(update_provider_when_message_created, "db", SimpleNamespace(engine=engine)),
        patch.object(update_provider_when_message_created, "_claim_last_used_update_window", return_value=True),
    ):
        update_provider_when_message_created._execute_provider_updates([operation])

    with engine.connect() as connection:
        last_used = connection.scalar(select(Provider.last_used).where(Provider.id == provider_id))

    assert last_used == last_used_at


def test_execute_provider_updates_releases_claimed_window_after_transaction_failure() -> None:
    engine = create_engine("sqlite:///:memory:")
    tenant_id = str(uuid4())
    cache_key = update_provider_when_message_created._get_provider_cache_key(tenant_id, "openai")
    operation = update_provider_when_message_created._ProviderUpdateOperation(
        filters=update_provider_when_message_created._ProviderUpdateFilters(
            tenant_id=tenant_id,
            provider_name="openai",
        ),
        values=update_provider_when_message_created._ProviderUpdateValues(last_used=datetime(2026, 5, 26, 12, 0, 0)),
    )

    with (
        patch.object(update_provider_when_message_created, "db", SimpleNamespace(engine=engine)),
        patch.object(update_provider_when_message_created, "_claim_last_used_update_window", return_value=True),
        patch.object(update_provider_when_message_created, "_release_last_used_update_window") as mock_release,
        pytest.raises(SQLAlchemyError),
    ):
        update_provider_when_message_created._execute_provider_updates([operation])

    mock_release.assert_called_once_with(cache_key)
