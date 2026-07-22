from collections.abc import Iterator
from types import SimpleNamespace
from unittest.mock import ANY, patch
from uuid import uuid4

import pytest
from sqlalchemy import select
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from core.app.entities.app_invoke_entities import ChatAppGenerateEntity
from core.entities.provider_entities import ProviderQuotaType, QuotaUnit
from events.event_handlers import update_provider_when_message_created
from models import TenantCreditPool
from models.provider import ProviderType


@pytest.fixture
def credit_pool_session_factory(sqlite_engine: Engine) -> Iterator[sessionmaker[Session]]:
    """Bind message-created accounting to fixture-owned SQLite sessions."""
    TenantCreditPool.__table__.create(sqlite_engine)
    session_factory = sessionmaker(bind=sqlite_engine, expire_on_commit=False)
    with patch("events.event_handlers.update_provider_when_message_created.db.session", session_factory):
        yield session_factory


def test_message_created_trial_credit_accounting_does_not_raise_when_balance_is_insufficient(
    credit_pool_session_factory: sessionmaker[Session],
) -> None:
    tenant_id = str(uuid4())
    pool_id = str(uuid4())
    pool = TenantCreditPool(
        tenant_id=tenant_id,
        pool_type=ProviderQuotaType.TRIAL,
        quota_limit=10,
        quota_used=9,
    )
    pool.id = pool_id
    with credit_pool_session_factory.begin() as session:
        session.add(pool)

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
        patch.object(update_provider_when_message_created, "_execute_provider_updates"),
    ):
        update_provider_when_message_created.handle(
            sender=message,
            application_generate_entity=application_generate_entity,
        )

    with credit_pool_session_factory() as session:
        quota_used = session.scalar(select(TenantCreditPool.quota_used).where(TenantCreditPool.id == pool_id))

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


def test_capped_credit_pool_accounting_skips_exhaustion_warning_when_full_amount_is_deducted(
    caplog: pytest.LogCaptureFixture,
) -> None:
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
        session=ANY,
    )
    assert "Credit pool exhausted during message-created accounting" not in caplog.text
