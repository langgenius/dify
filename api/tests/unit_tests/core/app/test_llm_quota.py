from collections.abc import Iterator
from contextlib import contextmanager
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.engine import Engine
from sqlalchemy.orm import sessionmaker

from configs import dify_config
from core.app.llm.quota import (
    deduct_llm_quota,
    deduct_llm_quota_for_model,
    ensure_llm_quota_available,
    ensure_llm_quota_available_for_model,
)
from core.entities.model_entities import ModelStatus
from core.entities.provider_entities import ProviderQuotaType, QuotaUnit
from core.errors.error import QuotaExceededError
from graphon.model_runtime.entities.llm_entities import LLMUsage
from graphon.model_runtime.entities.model_entities import ModelType
from models import TenantCreditPool
from models.enums import ProviderQuotaType as ModelProviderQuotaType
from models.provider import Provider, ProviderType


@contextmanager
def _patched_credit_pool_session_factory(engine: Engine) -> Iterator[None]:
    session_maker = sessionmaker(bind=engine, expire_on_commit=False)
    with patch("services.credit_pool_service.session_factory.get_session_maker", return_value=session_maker):
        yield


def test_ensure_llm_quota_available_for_model_raises_when_system_model_is_exhausted() -> None:
    provider_configuration = SimpleNamespace(
        using_provider_type=ProviderType.SYSTEM,
        get_provider_model=MagicMock(return_value=SimpleNamespace(status=ModelStatus.QUOTA_EXCEEDED)),
    )
    provider_manager = MagicMock()
    provider_manager.get_configurations.return_value.get.return_value = provider_configuration

    with (
        patch("core.app.llm.quota.create_plugin_provider_manager", return_value=provider_manager),
        pytest.raises(QuotaExceededError, match="Model provider openai quota exceeded."),
    ):
        ensure_llm_quota_available_for_model(
            tenant_id="tenant-id",
            provider="openai",
            model="gpt-4o",
        )

    provider_configuration.get_provider_model.assert_called_once_with(
        model_type=ModelType.LLM,
        model="gpt-4o",
    )


def test_ensure_llm_quota_available_for_model_raises_when_provider_is_missing() -> None:
    provider_manager = MagicMock()
    provider_manager.get_configurations.return_value.get.return_value = None

    with (
        patch("core.app.llm.quota.create_plugin_provider_manager", return_value=provider_manager),
        pytest.raises(ValueError, match="Provider openai does not exist."),
    ):
        ensure_llm_quota_available_for_model(
            tenant_id="tenant-id",
            provider="openai",
            model="gpt-4o",
        )


def test_ensure_llm_quota_available_for_model_ignores_custom_provider_configuration() -> None:
    provider_configuration = SimpleNamespace(
        using_provider_type=ProviderType.CUSTOM,
        get_provider_model=MagicMock(),
    )
    provider_manager = MagicMock()
    provider_manager.get_configurations.return_value.get.return_value = provider_configuration

    with patch("core.app.llm.quota.create_plugin_provider_manager", return_value=provider_manager):
        ensure_llm_quota_available_for_model(
            tenant_id="tenant-id",
            provider="openai",
            model="gpt-4o",
        )

    provider_configuration.get_provider_model.assert_not_called()


def test_deduct_llm_quota_for_model_uses_identity_based_trial_billing() -> None:
    usage = LLMUsage.empty_usage()
    usage.total_tokens = 42
    provider_configuration = SimpleNamespace(
        using_provider_type=ProviderType.SYSTEM,
        system_configuration=SimpleNamespace(
            current_quota_type=ProviderQuotaType.TRIAL,
            quota_configurations=[
                SimpleNamespace(
                    quota_type=ProviderQuotaType.TRIAL,
                    quota_unit=QuotaUnit.TOKENS,
                    quota_limit=100,
                )
            ],
        ),
    )
    provider_manager = MagicMock()
    provider_manager.get_configurations.return_value.get.return_value = provider_configuration

    with (
        patch("core.app.llm.quota.create_plugin_provider_manager", return_value=provider_manager),
        patch("services.credit_pool_service.CreditPoolService.deduct_credits_capped") as mock_deduct_credits,
    ):
        deduct_llm_quota_for_model(
            tenant_id="tenant-id",
            provider="openai",
            model="gpt-4o",
            usage=usage,
        )

    mock_deduct_credits.assert_called_once_with(
        tenant_id="tenant-id",
        credits_required=42,
    )


def test_deduct_llm_quota_for_model_caps_trial_pool_when_usage_exceeds_remaining() -> None:
    usage = LLMUsage.empty_usage()
    usage.total_tokens = 3
    provider_configuration = SimpleNamespace(
        using_provider_type=ProviderType.SYSTEM,
        system_configuration=SimpleNamespace(
            current_quota_type=ProviderQuotaType.TRIAL,
            quota_configurations=[
                SimpleNamespace(
                    quota_type=ProviderQuotaType.TRIAL,
                    quota_unit=QuotaUnit.TOKENS,
                    quota_limit=100,
                )
            ],
        ),
    )
    provider_manager = MagicMock()
    provider_manager.get_configurations.return_value.get.return_value = provider_configuration
    engine = create_engine("sqlite:///:memory:")
    TenantCreditPool.__table__.create(engine)
    with engine.begin() as connection:
        connection.execute(
            TenantCreditPool.__table__.insert(),
            {
                "id": "trial-pool",
                "tenant_id": "tenant-id",
                "pool_type": ModelProviderQuotaType.TRIAL,
                "quota_limit": 10,
                "quota_used": 9,
            },
        )

    with (
        patch("core.app.llm.quota.create_plugin_provider_manager", return_value=provider_manager),
        _patched_credit_pool_session_factory(engine),
    ):
        deduct_llm_quota_for_model(
            tenant_id="tenant-id",
            provider="openai",
            model="gpt-4o",
            usage=usage,
        )

    with engine.connect() as connection:
        quota_used = connection.scalar(select(TenantCreditPool.quota_used).where(TenantCreditPool.id == "trial-pool"))

    assert quota_used == 10


def test_deduct_llm_quota_for_model_returns_for_unbounded_quota() -> None:
    usage = LLMUsage.empty_usage()
    usage.total_tokens = 42
    provider_configuration = SimpleNamespace(
        using_provider_type=ProviderType.SYSTEM,
        system_configuration=SimpleNamespace(
            current_quota_type=ProviderQuotaType.TRIAL,
            quota_configurations=[
                SimpleNamespace(
                    quota_type=ProviderQuotaType.TRIAL,
                    quota_unit=QuotaUnit.TOKENS,
                    quota_limit=-1,
                )
            ],
        ),
    )
    provider_manager = MagicMock()
    provider_manager.get_configurations.return_value.get.return_value = provider_configuration

    with (
        patch("core.app.llm.quota.create_plugin_provider_manager", return_value=provider_manager),
        patch("services.credit_pool_service.CreditPoolService.deduct_credits_capped") as mock_deduct_credits,
    ):
        deduct_llm_quota_for_model(
            tenant_id="tenant-id",
            provider="openai",
            model="gpt-4o",
            usage=usage,
        )

    mock_deduct_credits.assert_not_called()


def test_deduct_llm_quota_for_model_uses_credit_configuration() -> None:
    usage = LLMUsage.empty_usage()
    provider_configuration = SimpleNamespace(
        using_provider_type=ProviderType.SYSTEM,
        system_configuration=SimpleNamespace(
            current_quota_type=ProviderQuotaType.TRIAL,
            quota_configurations=[
                SimpleNamespace(
                    quota_type=ProviderQuotaType.TRIAL,
                    quota_unit=QuotaUnit.CREDITS,
                    quota_limit=100,
                )
            ],
        ),
    )
    provider_manager = MagicMock()
    provider_manager.get_configurations.return_value.get.return_value = provider_configuration

    with (
        patch("core.app.llm.quota.create_plugin_provider_manager", return_value=provider_manager),
        patch.object(type(dify_config), "get_model_credits", return_value=9) as mock_get_model_credits,
        patch("services.credit_pool_service.CreditPoolService.deduct_credits_capped") as mock_deduct_credits,
    ):
        deduct_llm_quota_for_model(
            tenant_id="tenant-id",
            provider="openai",
            model="gpt-4o",
            usage=usage,
        )

    mock_get_model_credits.assert_called_once_with("gpt-4o")
    mock_deduct_credits.assert_called_once_with(
        tenant_id="tenant-id",
        credits_required=9,
    )


def test_deduct_llm_quota_for_model_uses_single_charge_for_times_quota() -> None:
    usage = LLMUsage.empty_usage()
    provider_configuration = SimpleNamespace(
        using_provider_type=ProviderType.SYSTEM,
        system_configuration=SimpleNamespace(
            current_quota_type=ProviderQuotaType.TRIAL,
            quota_configurations=[
                SimpleNamespace(
                    quota_type=ProviderQuotaType.TRIAL,
                    quota_unit=QuotaUnit.TIMES,
                    quota_limit=100,
                )
            ],
        ),
    )
    provider_manager = MagicMock()
    provider_manager.get_configurations.return_value.get.return_value = provider_configuration

    with (
        patch("core.app.llm.quota.create_plugin_provider_manager", return_value=provider_manager),
        patch("services.credit_pool_service.CreditPoolService.deduct_credits_capped") as mock_deduct_credits,
    ):
        deduct_llm_quota_for_model(
            tenant_id="tenant-id",
            provider="openai",
            model="gpt-4o",
            usage=usage,
        )

    mock_deduct_credits.assert_called_once_with(
        tenant_id="tenant-id",
        credits_required=1,
    )


def test_deduct_llm_quota_for_model_uses_paid_billing_pool() -> None:
    usage = LLMUsage.empty_usage()
    usage.total_tokens = 5
    provider_configuration = SimpleNamespace(
        using_provider_type=ProviderType.SYSTEM,
        system_configuration=SimpleNamespace(
            current_quota_type=ProviderQuotaType.PAID,
            quota_configurations=[
                SimpleNamespace(
                    quota_type=ProviderQuotaType.PAID,
                    quota_unit=QuotaUnit.TOKENS,
                    quota_limit=100,
                )
            ],
        ),
    )
    provider_manager = MagicMock()
    provider_manager.get_configurations.return_value.get.return_value = provider_configuration

    with (
        patch("core.app.llm.quota.create_plugin_provider_manager", return_value=provider_manager),
        patch("services.credit_pool_service.CreditPoolService.deduct_credits_capped") as mock_deduct_credits,
    ):
        deduct_llm_quota_for_model(
            tenant_id="tenant-id",
            provider="openai",
            model="gpt-4o",
            usage=usage,
        )

    mock_deduct_credits.assert_called_once_with(
        tenant_id="tenant-id",
        credits_required=5,
        pool_type="paid",
    )


def test_deduct_llm_quota_for_model_updates_free_quota_usage() -> None:
    usage = LLMUsage.empty_usage()
    usage.total_tokens = 3
    provider_configuration = SimpleNamespace(
        using_provider_type=ProviderType.SYSTEM,
        system_configuration=SimpleNamespace(
            current_quota_type=ProviderQuotaType.FREE,
            quota_configurations=[
                SimpleNamespace(
                    quota_type=ProviderQuotaType.FREE,
                    quota_unit=QuotaUnit.TOKENS,
                    quota_limit=100,
                )
            ],
        ),
    )
    provider_manager = MagicMock()
    provider_manager.get_configurations.return_value.get.return_value = provider_configuration
    engine = create_engine("sqlite:///:memory:")
    Provider.__table__.create(engine)
    with engine.begin() as connection:
        connection.execute(
            Provider.__table__.insert(),
            [
                {
                    "id": "matching-provider",
                    "tenant_id": "tenant-id",
                    "provider_name": "openai",
                    "provider_type": ProviderType.SYSTEM,
                    "quota_type": ProviderQuotaType.FREE,
                    "quota_limit": 100,
                    "quota_used": 10,
                    "is_valid": True,
                },
                {
                    "id": "other-tenant",
                    "tenant_id": "other-tenant-id",
                    "provider_name": "openai",
                    "provider_type": ProviderType.SYSTEM,
                    "quota_type": ProviderQuotaType.FREE,
                    "quota_limit": 100,
                    "quota_used": 20,
                    "is_valid": True,
                },
                {
                    "id": "other-provider",
                    "tenant_id": "tenant-id",
                    "provider_name": "anthropic",
                    "provider_type": ProviderType.SYSTEM,
                    "quota_type": ProviderQuotaType.FREE,
                    "quota_limit": 100,
                    "quota_used": 30,
                    "is_valid": True,
                },
                {
                    "id": "custom-provider",
                    "tenant_id": "tenant-id",
                    "provider_name": "openai",
                    "provider_type": ProviderType.CUSTOM,
                    "quota_type": ProviderQuotaType.FREE,
                    "quota_limit": 100,
                    "quota_used": 40,
                    "is_valid": True,
                },
            ],
        )

    with (
        patch("core.app.llm.quota.create_plugin_provider_manager", return_value=provider_manager),
        patch("core.app.llm.quota.db", SimpleNamespace(engine=engine)),
    ):
        deduct_llm_quota_for_model(
            tenant_id="tenant-id",
            provider="openai",
            model="gpt-4o",
            usage=usage,
        )

    with engine.connect() as connection:
        quota_used_by_id = dict(connection.execute(select(Provider.id, Provider.quota_used)).all())

    assert quota_used_by_id == {
        "matching-provider": 13,
        "other-tenant": 20,
        "other-provider": 30,
        "custom-provider": 40,
    }

    with engine.begin() as connection:
        connection.execute(
            Provider.__table__.update().where(Provider.id == "matching-provider").values(quota_limit=13, quota_used=13)
        )

    with (
        patch("core.app.llm.quota.create_plugin_provider_manager", return_value=provider_manager),
        patch("core.app.llm.quota.db", SimpleNamespace(engine=engine)),
        pytest.raises(QuotaExceededError, match="Model provider openai quota exceeded."),
    ):
        deduct_llm_quota_for_model(
            tenant_id="tenant-id",
            provider="openai",
            model="gpt-4o",
            usage=usage,
        )

    with engine.connect() as connection:
        exhausted_quota_used = connection.scalar(select(Provider.quota_used).where(Provider.id == "matching-provider"))

    assert exhausted_quota_used == 13


def test_deduct_llm_quota_for_model_caps_free_quota_and_raises_when_usage_exceeds_remaining() -> None:
    usage = LLMUsage.empty_usage()
    usage.total_tokens = 3
    provider_configuration = SimpleNamespace(
        using_provider_type=ProviderType.SYSTEM,
        system_configuration=SimpleNamespace(
            current_quota_type=ProviderQuotaType.FREE,
            quota_configurations=[
                SimpleNamespace(
                    quota_type=ProviderQuotaType.FREE,
                    quota_unit=QuotaUnit.TOKENS,
                    quota_limit=100,
                )
            ],
        ),
    )
    provider_manager = MagicMock()
    provider_manager.get_configurations.return_value.get.return_value = provider_configuration
    engine = create_engine("sqlite:///:memory:")
    Provider.__table__.create(engine)
    with engine.begin() as connection:
        connection.execute(
            Provider.__table__.insert(),
            {
                "id": "matching-provider",
                "tenant_id": "tenant-id",
                "provider_name": "openai",
                "provider_type": ProviderType.SYSTEM,
                "quota_type": ProviderQuotaType.FREE,
                "quota_limit": 15,
                "quota_used": 13,
                "is_valid": True,
            },
        )

    with (
        patch("core.app.llm.quota.create_plugin_provider_manager", return_value=provider_manager),
        patch("core.app.llm.quota.db", SimpleNamespace(engine=engine)),
        pytest.raises(QuotaExceededError, match="Model provider openai quota exceeded."),
    ):
        deduct_llm_quota_for_model(
            tenant_id="tenant-id",
            provider="openai",
            model="gpt-4o",
            usage=usage,
        )

    with engine.connect() as connection:
        quota_used = connection.scalar(select(Provider.quota_used).where(Provider.id == "matching-provider"))

    assert quota_used == 15


def test_deduct_llm_quota_for_model_ignores_unknown_quota_type() -> None:
    usage = LLMUsage.empty_usage()
    usage.total_tokens = 2
    provider_configuration = SimpleNamespace(
        using_provider_type=ProviderType.SYSTEM,
        system_configuration=SimpleNamespace(
            current_quota_type="unexpected",
            quota_configurations=[
                SimpleNamespace(
                    quota_type="unexpected",
                    quota_unit=QuotaUnit.TOKENS,
                    quota_limit=100,
                )
            ],
        ),
    )
    provider_manager = MagicMock()
    provider_manager.get_configurations.return_value.get.return_value = provider_configuration

    with (
        patch("core.app.llm.quota.create_plugin_provider_manager", return_value=provider_manager),
        patch("services.credit_pool_service.CreditPoolService.deduct_credits_capped") as mock_deduct_credits,
        patch("core.app.llm.quota.sessionmaker") as mock_sessionmaker,
    ):
        deduct_llm_quota_for_model(
            tenant_id="tenant-id",
            provider="openai",
            model="gpt-4o",
            usage=usage,
        )

    mock_deduct_credits.assert_not_called()
    mock_sessionmaker.assert_not_called()


def test_deduct_llm_quota_for_model_ignores_custom_provider_configuration() -> None:
    usage = LLMUsage.empty_usage()
    usage.total_tokens = 2
    provider_configuration = SimpleNamespace(
        using_provider_type=ProviderType.CUSTOM,
        system_configuration=SimpleNamespace(
            current_quota_type=ProviderQuotaType.TRIAL,
            quota_configurations=[],
        ),
    )
    provider_manager = MagicMock()
    provider_manager.get_configurations.return_value.get.return_value = provider_configuration

    with (
        patch("core.app.llm.quota.create_plugin_provider_manager", return_value=provider_manager),
        patch("services.credit_pool_service.CreditPoolService.deduct_credits_capped") as mock_deduct_credits,
        patch("core.app.llm.quota.sessionmaker") as mock_sessionmaker,
    ):
        deduct_llm_quota_for_model(
            tenant_id="tenant-id",
            provider="openai",
            model="gpt-4o",
            usage=usage,
        )

    mock_deduct_credits.assert_not_called()
    mock_sessionmaker.assert_not_called()


def test_ensure_llm_quota_available_wrapper_warns_and_delegates() -> None:
    model_instance = SimpleNamespace(
        provider="openai",
        model_name="gpt-4o",
        provider_model_bundle=SimpleNamespace(configuration=SimpleNamespace(tenant_id="tenant-id")),
        model_type_instance=SimpleNamespace(model_type=ModelType.LLM),
    )

    with (
        pytest.deprecated_call(match="ensure_llm_quota_available\\(model_instance=.*deprecated"),
        patch("core.app.llm.quota.ensure_llm_quota_available_for_model") as mock_ensure,
    ):
        ensure_llm_quota_available(model_instance=model_instance)

    mock_ensure.assert_called_once_with(
        tenant_id="tenant-id",
        provider="openai",
        model="gpt-4o",
    )


def test_ensure_llm_quota_available_wrapper_rejects_non_llm_model_instances() -> None:
    model_instance = SimpleNamespace(
        provider="openai",
        model_name="gpt-4o",
        provider_model_bundle=SimpleNamespace(configuration=SimpleNamespace(tenant_id="tenant-id")),
        model_type_instance=SimpleNamespace(model_type=ModelType.TEXT_EMBEDDING),
    )

    with (
        pytest.deprecated_call(match="ensure_llm_quota_available\\(model_instance=.*deprecated"),
        pytest.raises(ValueError, match="only support LLM model instances"),
    ):
        ensure_llm_quota_available(model_instance=model_instance)


def test_deduct_llm_quota_wrapper_warns_and_delegates() -> None:
    usage = LLMUsage.empty_usage()
    usage.total_tokens = 7
    model_instance = SimpleNamespace(
        provider="openai",
        model_name="gpt-4o",
        model_type_instance=SimpleNamespace(model_type=ModelType.LLM),
        provider_model_bundle=SimpleNamespace(configuration=SimpleNamespace()),
    )

    with (
        pytest.deprecated_call(match="deduct_llm_quota\\(tenant_id=.*deprecated"),
        patch("core.app.llm.quota.deduct_llm_quota_for_model") as mock_deduct,
    ):
        deduct_llm_quota(
            tenant_id="tenant-id",
            model_instance=model_instance,
            usage=usage,
        )

    mock_deduct.assert_called_once_with(
        tenant_id="tenant-id",
        provider="openai",
        model="gpt-4o",
        usage=usage,
    )


def test_deduct_llm_quota_wrapper_rejects_non_llm_model_instances() -> None:
    usage = LLMUsage.empty_usage()
    model_instance = SimpleNamespace(
        provider="openai",
        model_name="gpt-4o",
        model_type_instance=SimpleNamespace(model_type=ModelType.TEXT_EMBEDDING),
        provider_model_bundle=SimpleNamespace(configuration=SimpleNamespace()),
    )

    with (
        pytest.deprecated_call(match="deduct_llm_quota\\(tenant_id=.*deprecated"),
        pytest.raises(ValueError, match="only support LLM model instances"),
    ):
        deduct_llm_quota(
            tenant_id="tenant-id",
            model_instance=model_instance,
            usage=usage,
        )
