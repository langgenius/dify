from collections.abc import Callable
from types import SimpleNamespace
from unittest.mock import ANY, MagicMock, patch
from uuid import UUID

import pytest
from pytest_mock import MockerFixture
from sqlalchemy import select
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from configs import dify_config
from core.app.entities.app_invoke_entities import CreditUsageCreatedBy
from core.app.llm.quota import (
    LLMQuotaReservationState,
    deduct_llm_quota,
    deduct_llm_quota_for_model,
    ensure_llm_quota_available,
    ensure_llm_quota_available_for_model,
    reserve_llm_quota_for_model,
    reserve_model_quota_for_configuration,
    reserve_model_quota_for_model,
)
from core.credit_usage import CreditUsageAppType
from core.entities.model_entities import ModelStatus
from core.entities.provider_configuration import ProviderConfiguration, ProviderConfigurations
from core.entities.provider_entities import (
    CustomModelConfiguration,
    ModelSettings,
    ProviderQuotaType,
    QuotaConfiguration,
    QuotaUnit,
    RestrictModel,
    SystemConfiguration,
)
from core.errors.error import ModelCurrentlyNotSupportError, QuotaExceededError
from core.hosting_configuration import HostingConfiguration
from core.model_manager import ModelInstance
from core.plugin.impl.model_runtime_factory import create_plugin_model_runtime
from core.provider_manager import ProviderManager
from graphon.model_runtime.entities.llm_entities import LLMUsage
from graphon.model_runtime.entities.model_entities import AIModelEntity, FetchFrom, ModelType
from graphon.model_runtime.model_providers.base.text_embedding_model import TextEmbeddingModel
from models.enums import ProviderQuotaType as ModelProviderQuotaType
from models.provider import Provider, ProviderType
from models.provider_ids import ModelProviderID
from services.credit_pool_service import FEATURE_KEY_CREDIT_POOL, CreditPoolReservation, CreditPoolReservationState
from tests.helpers.unit.core.model_fixtures import make_model_config


def _model_instance(model_type: ModelType) -> ModelInstance:
    """Construct a real model instance for the deprecated quota wrapper boundary."""
    model_name = "gpt-4o" if model_type == ModelType.LLM else "text-embedding-3-small"
    config = make_model_config(provider="openai", model=model_name, mode="chat")
    bundle = config.provider_model_bundle
    bundle.configuration.tenant_id = "tenant-id"
    if model_type == ModelType.TEXT_EMBEDDING:
        bundle.configuration.provider.supported_model_types = [ModelType.TEXT_EMBEDDING]
        bundle.model_type_instance = TextEmbeddingModel(
            provider_schema=bundle.configuration.provider,
            model_runtime=create_plugin_model_runtime(tenant_id="tenant-id"),
        )
    return ModelInstance(provider_model_bundle=bundle, model=model_name, credentials={})


def _provider_configuration(
    *,
    using_provider_type: ProviderType,
    system_configuration: SystemConfiguration,
) -> ProviderConfiguration:
    """Build a provider catalog whose availability is resolved by production code."""
    config = make_model_config(provider="openai", model="gpt-4o", mode="chat")
    configuration = config.provider_model_bundle.configuration
    configuration.tenant_id = "tenant-id"
    configuration.preferred_provider_type = using_provider_type
    configuration.using_provider_type = using_provider_type
    configuration.system_configuration = system_configuration
    configuration.provider.supported_model_types = [ModelType.LLM, ModelType.TEXT_EMBEDDING]
    configuration.provider.models = [
        config.model_schema,
        AIModelEntity(
            model="text-embedding-3-small",
            label=config.model_schema.label,
            model_type=ModelType.TEXT_EMBEDDING,
            fetch_from=FetchFrom.PREDEFINED_MODEL,
            model_properties={},
        ),
    ]
    return configuration


def _provider_manager(configuration: ProviderConfiguration | None) -> ProviderManager:
    """Seed a tenant catalog; None represents a catalog with no installed providers."""
    configurations = ProviderConfigurations(tenant_id="tenant-id")
    if configuration is not None:
        configurations[str(ModelProviderID(configuration.provider.provider))] = configuration
    # The seeded catalog serves every lookup, so an unbound maker makes any database access fail loudly.
    manager = ProviderManager(
        model_runtime=create_plugin_model_runtime(tenant_id="tenant-id"), session_maker=sessionmaker()
    )
    # Exercise the documented per-manager cache and the real normalized provider lookup.
    manager._configurations_cache["tenant-id"] = configurations
    return manager


@pytest.mark.parametrize("check_quota", [ensure_llm_quota_available_for_model, reserve_llm_quota_for_model])
def test_metered_llm_raises_when_system_model_is_exhausted(check_quota: Callable[..., object]) -> None:
    provider_configuration = _provider_configuration(
        using_provider_type=ProviderType.SYSTEM,
        system_configuration=SystemConfiguration(
            enabled=True,
            current_quota_type=ProviderQuotaType.TRIAL,
            quota_configurations=[
                QuotaConfiguration(
                    quota_type=ProviderQuotaType.TRIAL,
                    quota_unit=QuotaUnit.CREDITS,
                    quota_limit=100,
                    quota_used=100,
                    is_valid=False,
                    restrict_models=[RestrictModel(model="gpt-4o", model_type=ModelType.LLM)],
                )
            ],
        ),
    )
    provider_manager = _provider_manager(provider_configuration)

    with (
        patch("core.app.llm.quota.create_plugin_provider_manager", return_value=provider_manager),
        pytest.raises(QuotaExceededError, match="Model provider openai quota exceeded."),
    ):
        check_quota(tenant_id="tenant-id", provider="openai", model="gpt-4o")

    provider_model = provider_configuration.get_provider_model(model_type=ModelType.LLM, model="gpt-4o")
    assert provider_model is not None
    assert provider_model.status == ModelStatus.QUOTA_EXCEEDED


def test_ensure_llm_quota_available_for_model_raises_when_provider_is_missing() -> None:
    provider_manager = _provider_manager(None)

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


def test_reserve_llm_quota_uses_exact_credit_pool_reservation() -> None:
    credit_reservation = CreditPoolReservation(
        tenant_id="tenant-id",
        pool_type="trial",
        amount=9,
        request_id="11111111-1111-5111-8111-111111111111",
        reservation_id="22222222-2222-5222-8222-222222222222",
    )
    provider_configuration = _provider_configuration(
        using_provider_type=ProviderType.SYSTEM,
        system_configuration=SystemConfiguration(
            enabled=True,
            current_quota_type=ProviderQuotaType.TRIAL,
            quota_configurations=[
                QuotaConfiguration(
                    quota_used=0,
                    is_valid=True,
                    quota_type=ProviderQuotaType.TRIAL,
                    quota_unit=QuotaUnit.CREDITS,
                    quota_limit=100,
                )
            ],
        ),
    )
    provider_manager = _provider_manager(provider_configuration)

    with (
        patch("core.app.llm.quota.create_plugin_provider_manager", return_value=provider_manager),
        patch.object(type(dify_config), "get_model_credits", return_value=9),
        patch("core.app.llm.quota.CreditPoolService.reserve_credits", return_value=credit_reservation) as reserve,
        patch("services.billing_service.BillingService.quota_commit") as quota_commit,
    ):
        reservation = reserve_llm_quota_for_model(
            tenant_id="tenant-id",
            provider="openai",
            model="gpt-4o",
            request_id="11111111-1111-5111-8111-111111111111",
            app_type=CreditUsageAppType.CHATBOT,
            created_by=CreditUsageCreatedBy.APP.value,
        )
        reservation.commit(LLMUsage.empty_usage())
        reservation.release()

    assert reservation.state == LLMQuotaReservationState.COMMITTED
    assert reservation.commit_before_delivery is True
    reserve.assert_called_once_with(
        tenant_id="tenant-id",
        credits_required=9,
        pool_type="trial",
        request_id="11111111-1111-5111-8111-111111111111",
        meta={
            "source": "llm.invoke",
            "provider": "openai",
            "model": "gpt-4o",
            "app_type": CreditUsageAppType.CHATBOT,
            "created_by": CreditUsageCreatedBy.APP.value,
        },
    )
    quota_commit.assert_called_once_with(
        tenant_id="tenant-id",
        feature_key=FEATURE_KEY_CREDIT_POOL,
        bucket="trial",
        reservation_id="22222222-2222-5222-8222-222222222222",
        actual_amount=9,
        meta={"request_id": "11111111-1111-5111-8111-111111111111"},
    )
    assert credit_reservation.state == CreditPoolReservationState.COMMITTED


@pytest.mark.parametrize("quota_type", [ProviderQuotaType.TRIAL, ProviderQuotaType.PAID])
@pytest.mark.parametrize("remaining", [0, 1])
def test_reserve_model_quota_skips_zero_credit_charge(
    config_overrides: Callable[..., None], mocker: MockerFixture, quota_type: ProviderQuotaType, remaining: int
) -> None:
    """An offered zero-credit model needs neither a positive balance nor terminal usage."""
    config_overrides(HOSTED_MODEL_CREDIT_CONFIG="gpt-4o:0")
    configuration = _provider_configuration(
        using_provider_type=ProviderType.SYSTEM,
        system_configuration=SystemConfiguration(
            enabled=True,
            current_quota_type=quota_type,
            quota_configurations=[
                QuotaConfiguration(
                    quota_type=quota_type,
                    quota_unit=QuotaUnit.CREDITS,
                    quota_limit=100,
                    quota_used=100 - remaining,
                    is_valid=remaining > 0,
                    restrict_models=[RestrictModel(model="gpt-4o", model_type=ModelType.LLM)],
                )
            ],
        ),
    )

    reserve = mocker.patch("core.app.llm.quota.CreditPoolService.reserve_credits")
    deduct = mocker.patch("core.app.llm.quota.CreditPoolService.deduct_credits_capped")
    with patch("core.app.llm.quota.create_plugin_provider_manager", return_value=_provider_manager(configuration)):
        ensure_llm_quota_available_for_model(tenant_id="tenant-id", provider="openai", model="gpt-4o")
    reservation = reserve_model_quota_for_configuration(
        configuration,
        model_type=ModelType.LLM,
        model="gpt-4o",
        request_id=None,
        app_type=None,
        created_by=None,
    )

    assert reservation.credit_pool_reservation is None
    assert not reservation.requires_settlement
    assert reservation.commit_before_delivery
    reservation.commit()
    assert reservation.state == LLMQuotaReservationState.COMMITTED
    reserve.assert_not_called()
    deduct.assert_not_called()


@pytest.fixture
def exhausted_paid_fallback(config_overrides: Callable[..., None]) -> ProviderConfiguration:
    config_overrides(
        HOSTED_OPENAI_PAID_MODELS="gpt-4o,text-embedding-3-small",
        HOSTED_MODEL_CREDIT_CONFIG="gpt-4o:0,text-embedding-3-small:0",
    )
    config = _provider_configuration(
        using_provider_type=ProviderType.CUSTOM,
        system_configuration=SystemConfiguration(
            enabled=True,
            credentials={"api_key": "hosted"},
            current_quota_type=ProviderQuotaType.PAID,
            quota_configurations=[
                QuotaConfiguration(
                    quota_type=ProviderQuotaType.PAID,
                    quota_unit=QuotaUnit.CREDITS,
                    quota_limit=1,
                    quota_used=1,
                    is_valid=False,
                    restrict_models=HostingConfiguration.parse_restrict_models_from_env("HOSTED_OPENAI_PAID_MODELS"),
                )
            ],
        ),
    )
    config.preferred_provider_type = ProviderType.SYSTEM
    config.custom_configuration.models = [
        CustomModelConfiguration(
            model="gpt-4o", model_type=ModelType.TEXT_EMBEDDING, credentials={"api_key": "workspace"}
        )
    ]
    return config


@pytest.mark.parametrize(
    ("model_type", "model", "expected_route"),
    [
        (ModelType.LLM, "gpt-4o", ProviderType.SYSTEM),
        (ModelType.TEXT_EMBEDDING, "text-embedding-3-small", ProviderType.SYSTEM),
        (ModelType.TEXT_EMBEDDING, "gpt-4o", ProviderType.CUSTOM),
    ],
)
def test_quota_resolves_free_offers_by_model_id_on_provider_fallback(
    exhausted_paid_fallback: ProviderConfiguration, model_type: ModelType, model: str, expected_route: ProviderType
) -> None:
    config = exhausted_paid_fallback
    with patch("core.app.llm.quota.create_plugin_provider_manager", return_value=_provider_manager(config)):
        reservation = reserve_model_quota_for_model(
            tenant_id=config.tenant_id, provider="openai", model=model, model_type=model_type
        )

    assert reservation.provider_configuration.using_provider_type == expected_route
    assert reservation.quota_unit == (QuotaUnit.CREDITS if expected_route == ProviderType.SYSTEM else None)
    assert reservation.credit_pool_reservation is None
    assert config.using_provider_type == ProviderType.CUSTOM


def test_preflight_rejects_disabled_free_model_on_provider_fallback(
    exhausted_paid_fallback: ProviderConfiguration,
) -> None:
    config = exhausted_paid_fallback
    config.model_settings = [ModelSettings(model="gpt-4o", model_type=ModelType.LLM, enabled=False)]
    with (
        patch("core.app.llm.quota.create_plugin_provider_manager", return_value=_provider_manager(config)),
        pytest.raises(ValueError, match="disabled"),
    ):
        ensure_llm_quota_available_for_model(tenant_id=config.tenant_id, provider="openai", model="gpt-4o")


@pytest.mark.parametrize("name", ["gpt-4o", "text-embedding-3-small"])
def test_zero_price_cannot_admit_an_unoffered_system_model(config_overrides: Callable[..., None], name: str) -> None:
    """Check both the selected bucket's names and the concrete provider schema, even on direct quota calls."""
    config_overrides(HOSTED_MODEL_CREDIT_CONFIG=f"{name}:0")
    config = _provider_configuration(
        using_provider_type=ProviderType.SYSTEM,
        system_configuration=SystemConfiguration(
            enabled=True,
            current_quota_type=ProviderQuotaType.TRIAL,
            quota_configurations=[
                QuotaConfiguration(
                    quota_type=ProviderQuotaType.TRIAL,
                    quota_unit=QuotaUnit.CREDITS,
                    quota_limit=1,
                    quota_used=1,
                    is_valid=False,
                    restrict_models=[RestrictModel(model="text-embedding-3-small", model_type=ModelType.LLM)],
                )
            ],
        ),
    )
    with patch("core.app.llm.quota.create_plugin_provider_manager", return_value=_provider_manager(config)):
        with pytest.raises(ModelCurrentlyNotSupportError, match=name):
            ensure_llm_quota_available_for_model(tenant_id=config.tenant_id, provider="openai", model=name)
    with pytest.raises(ModelCurrentlyNotSupportError, match=name):
        reserve_model_quota_for_configuration(
            config, model_type=ModelType.LLM, model=name, request_id=None, app_type=None, created_by=None
        )


def test_reserve_llm_quota_generates_request_id_when_not_supplied() -> None:
    credit_reservation = CreditPoolReservation(
        tenant_id="tenant-id",
        pool_type="trial",
        amount=1,
        request_id="11111111-1111-5111-8111-111111111111",
        reservation_id="22222222-2222-5222-8222-222222222222",
    )
    provider_configuration = _provider_configuration(
        using_provider_type=ProviderType.SYSTEM,
        system_configuration=SystemConfiguration(
            enabled=True,
            current_quota_type=ProviderQuotaType.TRIAL,
            quota_configurations=[
                QuotaConfiguration(
                    quota_used=0,
                    is_valid=True,
                    quota_type=ProviderQuotaType.TRIAL,
                    quota_unit=QuotaUnit.TIMES,
                    quota_limit=100,
                )
            ],
        ),
    )
    provider_manager = _provider_manager(provider_configuration)

    with (
        patch("core.app.llm.quota.create_plugin_provider_manager", return_value=provider_manager),
        patch("core.app.llm.quota.CreditPoolService.reserve_credits", return_value=credit_reservation) as reserve,
    ):
        reserve_llm_quota_for_model(tenant_id="tenant-id", provider="openai", model="gpt-4o")

    generated_request_id = reserve.call_args.kwargs["request_id"]
    assert str(UUID(generated_request_id)) == generated_request_id
    assert credit_reservation.state == CreditPoolReservationState.RESERVED


def test_reserve_non_llm_quota_uses_model_type_and_credit_pool_reservation() -> None:
    credit_reservation = CreditPoolReservation(
        tenant_id="tenant-id",
        pool_type="trial",
        amount=3,
        request_id="11111111-1111-5111-8111-111111111111",
        reservation_id="22222222-2222-5222-8222-222222222222",
    )
    provider_configuration = _provider_configuration(
        using_provider_type=ProviderType.SYSTEM,
        system_configuration=SystemConfiguration(
            enabled=True,
            current_quota_type=ProviderQuotaType.TRIAL,
            quota_configurations=[
                QuotaConfiguration(
                    quota_used=0,
                    is_valid=True,
                    quota_type=ProviderQuotaType.TRIAL,
                    quota_unit=QuotaUnit.CREDITS,
                    quota_limit=100,
                )
            ],
        ),
    )
    provider_manager = _provider_manager(provider_configuration)

    with (
        patch("core.app.llm.quota.create_plugin_provider_manager", return_value=provider_manager),
        patch.object(type(dify_config), "get_model_credits", return_value=3),
        patch("core.app.llm.quota.CreditPoolService.reserve_credits", return_value=credit_reservation) as reserve,
        patch("services.billing_service.BillingService.quota_commit"),
    ):
        reservation = reserve_model_quota_for_model(
            tenant_id="tenant-id",
            provider="openai",
            model_type=ModelType.TEXT_EMBEDDING,
            model="text-embedding-3-small",
        )
        reservation.commit()

    assert reservation.model_type == ModelType.TEXT_EMBEDDING
    provider_model = provider_configuration.get_provider_model(
        model_type=ModelType.TEXT_EMBEDDING, model="text-embedding-3-small"
    )
    assert provider_model is not None
    assert provider_model.status == ModelStatus.ACTIVE
    reserve.assert_called_once_with(
        tenant_id="tenant-id",
        credits_required=3,
        pool_type="trial",
        request_id=ANY,
        meta={
            "source": "model.invoke",
            "provider": "openai",
            "model_type": "text-embedding",
            "model": "text-embedding-3-small",
            "app_type": CreditUsageAppType.UNKNOWN,
            "created_by": "unknown",
        },
    )
    assert credit_reservation.state == CreditPoolReservationState.COMMITTED


def test_reserve_non_llm_quota_rejects_free_token_settlement() -> None:
    provider_configuration = _provider_configuration(
        using_provider_type=ProviderType.SYSTEM,
        system_configuration=SystemConfiguration(
            enabled=True,
            current_quota_type=ProviderQuotaType.FREE,
            quota_configurations=[
                QuotaConfiguration(
                    quota_used=0,
                    is_valid=True,
                    quota_type=ProviderQuotaType.FREE,
                    quota_unit=QuotaUnit.TOKENS,
                    quota_limit=100,
                )
            ],
        ),
    )
    provider_manager = _provider_manager(provider_configuration)

    with (
        patch("core.app.llm.quota.create_plugin_provider_manager", return_value=provider_manager),
        pytest.raises(ValueError, match="only supports LLM invocations"),
    ):
        reserve_model_quota_for_model(
            tenant_id="tenant-id",
            provider="openai",
            model_type=ModelType.TEXT_EMBEDDING,
            model="text-embedding-3-small",
        )


def test_reserve_llm_quota_requires_accurate_usage_for_free_tokens() -> None:
    provider_configuration = _provider_configuration(
        using_provider_type=ProviderType.SYSTEM,
        system_configuration=SystemConfiguration(
            enabled=True,
            current_quota_type=ProviderQuotaType.FREE,
            quota_configurations=[
                QuotaConfiguration(
                    quota_used=0,
                    is_valid=True,
                    quota_type=ProviderQuotaType.FREE,
                    quota_unit=QuotaUnit.TOKENS,
                    quota_limit=100,
                )
            ],
        ),
    )
    provider_manager = _provider_manager(provider_configuration)

    with patch("core.app.llm.quota.create_plugin_provider_manager", return_value=provider_manager):
        reservation = reserve_llm_quota_for_model(
            tenant_id="tenant-id",
            provider="openai",
            model="gpt-4o",
        )

    assert reservation.commit_before_delivery is False
    with pytest.raises(ValueError, match="Accurate terminal usage"):
        reservation.commit()


def test_reserve_llm_quota_rejects_token_based_credit_pool() -> None:
    provider_configuration = _provider_configuration(
        using_provider_type=ProviderType.SYSTEM,
        system_configuration=SystemConfiguration(
            enabled=True,
            current_quota_type=ProviderQuotaType.TRIAL,
            quota_configurations=[
                QuotaConfiguration(
                    quota_used=0,
                    is_valid=True,
                    quota_type=ProviderQuotaType.TRIAL,
                    quota_unit=QuotaUnit.TOKENS,
                    quota_limit=100,
                )
            ],
        ),
    )
    provider_manager = _provider_manager(provider_configuration)

    with (
        patch("core.app.llm.quota.create_plugin_provider_manager", return_value=provider_manager),
        pytest.raises(ValueError, match="do not support pre-invocation reservation"),
    ):
        reserve_llm_quota_for_model(
            tenant_id="tenant-id",
            provider="openai",
            model="gpt-4o",
        )


@pytest.mark.parametrize(
    ("enabled", "offered_bucket"),
    [(True, ProviderQuotaType.PAID), (True, ProviderQuotaType.FREE), (False, ProviderQuotaType.TRIAL)],
)
@pytest.mark.parametrize("price", [0, 1])
@pytest.mark.parametrize("check_quota", [ensure_llm_quota_available_for_model, reserve_llm_quota_for_model])
def test_llm_quota_requires_an_enabled_selected_bucket(
    config_overrides: Callable[..., None],
    enabled: bool,
    offered_bucket: ProviderQuotaType,
    price: int,
    check_quota: Callable[..., object],
) -> None:
    """No model price grants access to a missing or disabled trial bucket."""
    config_overrides(HOSTED_MODEL_CREDIT_CONFIG=f"gpt-4o:{price}")
    provider_configuration = _provider_configuration(
        using_provider_type=ProviderType.SYSTEM,
        system_configuration=SystemConfiguration(
            enabled=enabled,
            current_quota_type=ProviderQuotaType.TRIAL,
            quota_configurations=[
                QuotaConfiguration(
                    quota_used=0,
                    is_valid=True,
                    quota_type=offered_bucket,
                    quota_unit=QuotaUnit.CREDITS,
                    quota_limit=100,
                )
            ],
        ),
    )
    provider_manager = _provider_manager(provider_configuration)

    assert not provider_configuration.get_provider_models(only_active=True)
    with (
        patch("core.app.llm.quota.create_plugin_provider_manager", return_value=provider_manager),
        patch("core.app.llm.quota.CreditPoolService.reserve_credits") as reserve,
        pytest.raises(QuotaExceededError, match="Model provider openai quota exceeded."),
    ):
        check_quota(tenant_id="tenant-id", provider="openai", model="gpt-4o")

    reserve.assert_not_called()


def test_deduct_llm_quota_for_model_uses_identity_based_trial_billing() -> None:
    usage = LLMUsage.empty_usage()
    usage.total_tokens = 42
    provider_configuration = _provider_configuration(
        using_provider_type=ProviderType.SYSTEM,
        system_configuration=SystemConfiguration(
            enabled=True,
            current_quota_type=ProviderQuotaType.TRIAL,
            quota_configurations=[
                QuotaConfiguration(
                    quota_used=0,
                    is_valid=True,
                    quota_type=ProviderQuotaType.TRIAL,
                    quota_unit=QuotaUnit.TOKENS,
                    quota_limit=100,
                )
            ],
        ),
    )
    provider_manager = _provider_manager(provider_configuration)

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
        pool_type=ProviderQuotaType.TRIAL,
        credits_required=42,
        metadata={
            "provider": "openai",
            "model": "gpt-4o",
            "model_type": "llm",
            "app_type": CreditUsageAppType.UNKNOWN,
            "created_by": "unknown",
        },
    )


def test_deduct_llm_quota_for_model_delegates_capped_trial_deduction_to_billing() -> None:
    usage = LLMUsage.empty_usage()
    usage.total_tokens = 3
    provider_configuration = _provider_configuration(
        using_provider_type=ProviderType.SYSTEM,
        system_configuration=SystemConfiguration(
            enabled=True,
            current_quota_type=ProviderQuotaType.TRIAL,
            quota_configurations=[
                QuotaConfiguration(
                    quota_used=0,
                    is_valid=True,
                    quota_type=ProviderQuotaType.TRIAL,
                    quota_unit=QuotaUnit.TOKENS,
                    quota_limit=100,
                )
            ],
        ),
    )
    provider_manager = _provider_manager(provider_configuration)

    with (
        patch("core.app.llm.quota.create_plugin_provider_manager", return_value=provider_manager),
        patch(
            "services.credit_pool_service.CreditPoolService.deduct_credits_capped",
            return_value=1,
        ) as mock_deduct_credits,
    ):
        deduct_llm_quota_for_model(
            tenant_id="tenant-id",
            provider="openai",
            model="gpt-4o",
            usage=usage,
        )

    mock_deduct_credits.assert_called_once()
    assert mock_deduct_credits.call_args.kwargs["credits_required"] == 3
    assert mock_deduct_credits.call_args.kwargs["pool_type"] == ProviderQuotaType.TRIAL


def test_unbounded_quota_neither_reserves_nor_deducts_credits() -> None:
    """An explicitly unlimited bucket, unlike a missing bucket, permits an unmetered call."""
    usage = LLMUsage.empty_usage()
    usage.total_tokens = 42
    provider_configuration = _provider_configuration(
        using_provider_type=ProviderType.SYSTEM,
        system_configuration=SystemConfiguration(
            enabled=True,
            current_quota_type=ProviderQuotaType.TRIAL,
            quota_configurations=[
                QuotaConfiguration(
                    quota_used=0,
                    is_valid=True,
                    quota_type=ProviderQuotaType.TRIAL,
                    quota_unit=QuotaUnit.TOKENS,
                    quota_limit=-1,
                )
            ],
        ),
    )
    provider_manager = _provider_manager(provider_configuration)

    with (
        patch("core.app.llm.quota.create_plugin_provider_manager", return_value=provider_manager),
        patch("services.credit_pool_service.CreditPoolService.deduct_credits_capped") as mock_deduct_credits,
    ):
        reservation = reserve_llm_quota_for_model(tenant_id="tenant-id", provider="openai", model="gpt-4o")
        assert reservation.credit_pool_reservation is None
        assert not reservation.requires_settlement
        deduct_llm_quota_for_model(
            tenant_id="tenant-id",
            provider="openai",
            model="gpt-4o",
            usage=usage,
        )

    mock_deduct_credits.assert_not_called()


def test_deduct_llm_quota_for_model_uses_credit_configuration() -> None:
    usage = LLMUsage.empty_usage()
    provider_configuration = _provider_configuration(
        using_provider_type=ProviderType.SYSTEM,
        system_configuration=SystemConfiguration(
            enabled=True,
            current_quota_type=ProviderQuotaType.TRIAL,
            quota_configurations=[
                QuotaConfiguration(
                    quota_used=0,
                    is_valid=True,
                    quota_type=ProviderQuotaType.TRIAL,
                    quota_unit=QuotaUnit.CREDITS,
                    quota_limit=100,
                )
            ],
        ),
    )
    provider_manager = _provider_manager(provider_configuration)

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
        pool_type=ProviderQuotaType.TRIAL,
        credits_required=9,
        metadata={
            "provider": "openai",
            "model": "gpt-4o",
            "model_type": "llm",
            "app_type": CreditUsageAppType.UNKNOWN,
            "created_by": "unknown",
        },
    )


def test_deduct_llm_quota_for_model_uses_single_charge_for_times_quota() -> None:
    usage = LLMUsage.empty_usage()
    provider_configuration = _provider_configuration(
        using_provider_type=ProviderType.SYSTEM,
        system_configuration=SystemConfiguration(
            enabled=True,
            current_quota_type=ProviderQuotaType.TRIAL,
            quota_configurations=[
                QuotaConfiguration(
                    quota_used=0,
                    is_valid=True,
                    quota_type=ProviderQuotaType.TRIAL,
                    quota_unit=QuotaUnit.TIMES,
                    quota_limit=100,
                )
            ],
        ),
    )
    provider_manager = _provider_manager(provider_configuration)

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
        pool_type=ProviderQuotaType.TRIAL,
        credits_required=1,
        metadata={
            "provider": "openai",
            "model": "gpt-4o",
            "model_type": "llm",
            "app_type": CreditUsageAppType.UNKNOWN,
            "created_by": "unknown",
        },
    )


def test_deduct_llm_quota_for_model_uses_paid_billing_pool() -> None:
    usage = LLMUsage.empty_usage()
    usage.total_tokens = 5
    provider_configuration = _provider_configuration(
        using_provider_type=ProviderType.SYSTEM,
        system_configuration=SystemConfiguration(
            enabled=True,
            current_quota_type=ProviderQuotaType.PAID,
            quota_configurations=[
                QuotaConfiguration(
                    quota_used=0,
                    is_valid=True,
                    quota_type=ProviderQuotaType.PAID,
                    quota_unit=QuotaUnit.TOKENS,
                    quota_limit=100,
                )
            ],
        ),
    )
    provider_manager = _provider_manager(provider_configuration)

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
        pool_type=ProviderQuotaType.PAID,
        credits_required=5,
        metadata={
            "provider": "openai",
            "model": "gpt-4o",
            "model_type": "llm",
            "app_type": CreditUsageAppType.UNKNOWN,
            "created_by": "unknown",
        },
    )


def test_deduct_llm_quota_for_model_updates_free_quota_usage(sqlite_engine: Engine, sqlite_session: Session) -> None:
    usage = LLMUsage.empty_usage()
    usage.total_tokens = 3
    provider_configuration = _provider_configuration(
        using_provider_type=ProviderType.SYSTEM,
        system_configuration=SystemConfiguration(
            enabled=True,
            current_quota_type=ProviderQuotaType.FREE,
            quota_configurations=[
                QuotaConfiguration(
                    quota_used=0,
                    is_valid=True,
                    quota_type=ProviderQuotaType.FREE,
                    quota_unit=QuotaUnit.TOKENS,
                    quota_limit=100,
                )
            ],
        ),
    )
    provider_manager = _provider_manager(provider_configuration)
    engine = sqlite_engine
    matching_provider = Provider(
        tenant_id="tenant-id",
        provider_name="openai",
        provider_type=ProviderType.SYSTEM,
        quota_type=ModelProviderQuotaType.FREE,
        quota_limit=100,
        quota_used=10,
        is_valid=True,
    )
    matching_provider.id = "matching-provider"
    other_tenant = Provider(
        tenant_id="other-tenant-id",
        provider_name="openai",
        provider_type=ProviderType.SYSTEM,
        quota_type=ModelProviderQuotaType.FREE,
        quota_limit=100,
        quota_used=20,
        is_valid=True,
    )
    other_tenant.id = "other-tenant"
    other_provider = Provider(
        tenant_id="tenant-id",
        provider_name="anthropic",
        provider_type=ProviderType.SYSTEM,
        quota_type=ModelProviderQuotaType.FREE,
        quota_limit=100,
        quota_used=30,
        is_valid=True,
    )
    other_provider.id = "other-provider"
    custom_provider = Provider(
        tenant_id="tenant-id",
        provider_name="openai",
        provider_type=ProviderType.CUSTOM,
        quota_type=ModelProviderQuotaType.FREE,
        quota_limit=100,
        quota_used=40,
        is_valid=True,
    )
    custom_provider.id = "custom-provider"
    sqlite_session.add_all([matching_provider, other_tenant, other_provider, custom_provider])
    sqlite_session.commit()

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
        quota_used_by_id = dict(connection.execute(select(Provider.id, Provider.quota_used)).tuples().all())

    assert quota_used_by_id == {
        "matching-provider": 13,
        "other-tenant": 20,
        "other-provider": 30,
        "custom-provider": 40,
    }

    matching_provider.quota_limit = 13
    matching_provider.quota_used = 13
    sqlite_session.commit()

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


def test_deduct_llm_quota_for_model_caps_free_quota_and_raises_when_usage_exceeds_remaining(
    sqlite_engine: Engine,
    sqlite_session: Session,
) -> None:
    usage = LLMUsage.empty_usage()
    usage.total_tokens = 3
    provider_configuration = _provider_configuration(
        using_provider_type=ProviderType.SYSTEM,
        system_configuration=SystemConfiguration(
            enabled=True,
            current_quota_type=ProviderQuotaType.FREE,
            quota_configurations=[
                QuotaConfiguration(
                    quota_used=0,
                    is_valid=True,
                    quota_type=ProviderQuotaType.FREE,
                    quota_unit=QuotaUnit.TOKENS,
                    quota_limit=100,
                )
            ],
        ),
    )
    provider_manager = _provider_manager(provider_configuration)
    engine = sqlite_engine
    provider = Provider(
        tenant_id="tenant-id",
        provider_name="openai",
        provider_type=ProviderType.SYSTEM,
        quota_type=ModelProviderQuotaType.FREE,
        quota_limit=15,
        quota_used=13,
        is_valid=True,
    )
    provider.id = "matching-provider"
    sqlite_session.add(provider)
    sqlite_session.commit()

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


def test_deduct_llm_quota_for_model_ignores_custom_provider_configuration() -> None:
    usage = LLMUsage.empty_usage()
    usage.total_tokens = 2
    provider_configuration = _provider_configuration(
        using_provider_type=ProviderType.CUSTOM,
        system_configuration=SystemConfiguration(
            enabled=True,
            current_quota_type=ProviderQuotaType.TRIAL,
            quota_configurations=[],
        ),
    )
    provider_manager = _provider_manager(provider_configuration)

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


def test_ensure_llm_quota_available_wrapper_warns_and_delegates() -> None:
    model_instance = _model_instance(ModelType.LLM)

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
    model_instance = _model_instance(ModelType.TEXT_EMBEDDING)

    with (
        pytest.deprecated_call(match="ensure_llm_quota_available\\(model_instance=.*deprecated"),
        pytest.raises(ValueError, match="only support LLM model instances"),
    ):
        ensure_llm_quota_available(model_instance=model_instance)


def test_deduct_llm_quota_wrapper_warns_and_delegates() -> None:
    usage = LLMUsage.empty_usage()
    usage.total_tokens = 7
    model_instance = _model_instance(ModelType.LLM)

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
    model_instance = _model_instance(ModelType.TEXT_EMBEDDING)

    with (
        pytest.deprecated_call(match="deduct_llm_quota\\(tenant_id=.*deprecated"),
        pytest.raises(ValueError, match="only support LLM model instances"),
    ):
        deduct_llm_quota(
            tenant_id="tenant-id",
            model_instance=model_instance,
            usage=usage,
        )
