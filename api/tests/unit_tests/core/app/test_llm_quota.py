from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

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
from models.provider import ProviderType


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
        patch("services.credit_pool_service.CreditPoolService.check_and_deduct_credits") as mock_deduct_credits,
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


def test_deduct_llm_quota_for_model_reuses_resolved_provider_configuration_for_deduction() -> None:
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

    with (
        patch("core.app.llm.quota._get_provider_configuration", return_value=provider_configuration),
        patch("core.app.llm.quota._deduct_used_llm_quota") as mock_deduct,
    ):
        deduct_llm_quota_for_model(
            tenant_id="tenant-id",
            provider="openai",
            model="gpt-4o",
            usage=usage,
        )

    mock_deduct.assert_called_once_with(
        tenant_id="tenant-id",
        provider="openai",
        provider_configuration=provider_configuration,
        used_quota=42,
    )


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
