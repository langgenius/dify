from __future__ import annotations

import json
import logging
from collections.abc import Iterator
from contextlib import contextmanager
from types import SimpleNamespace
from unittest.mock import Mock, PropertyMock, patch

import pytest
from sqlalchemy import Engine, event, select
from sqlalchemy.orm import Session

from constants import HIDDEN_VALUE
from core.entities.model_entities import ModelStatus
from core.entities.provider_configuration import ProviderConfiguration, ProviderConfigurations
from core.entities.provider_entities import (
    CredentialConfiguration,
    CustomConfiguration,
    CustomModelConfiguration,
    CustomProviderConfiguration,
    ModelLoadBalancingConfiguration,
    ModelSettings,
    ProviderQuotaType,
    QuotaConfiguration,
    QuotaUnit,
    RestrictModel,
    SystemConfiguration,
    SystemConfigurationStatus,
)
from extensions.ext_database import db
from graphon.model_runtime.entities.common_entities import I18nObject
from graphon.model_runtime.entities.model_entities import AIModelEntity, FetchFrom, ModelType
from graphon.model_runtime.entities.provider_entities import (
    ConfigurateMethod,
    CredentialFormSchema,
    FieldModelSchema,
    FormType,
    ModelCredentialSchema,
    ProviderCredentialSchema,
    ProviderEntity,
)
from models.base import TypeBase
from models.enums import CredentialSourceType
from models.provider import (
    LoadBalancingModelConfig,
    Provider,
    ProviderCredential,
    ProviderModel,
    ProviderModelCredential,
    ProviderModelSetting,
    ProviderType,
    TenantPreferredModelProvider,
)
from models.provider_ids import ModelProviderID


def _build_provider_configuration(*, provider_name: str = "openai") -> ProviderConfiguration:
    provider_entity = ProviderEntity(
        provider=provider_name,
        label=I18nObject(en_US="OpenAI"),
        supported_model_types=[ModelType.LLM],
        configurate_methods=[ConfigurateMethod.PREDEFINED_MODEL],
    )
    system_configuration = SystemConfiguration(
        enabled=True,
        credentials={"api_key": "test-key"},
        current_quota_type=ProviderQuotaType.TRIAL,
        quota_configurations=[
            QuotaConfiguration(
                quota_type=ProviderQuotaType.TRIAL,
                quota_unit=QuotaUnit.TOKENS,
                quota_limit=1_000,
                quota_used=0,
                is_valid=True,
                restrict_models=[],
            )
        ],
    )
    with patch("core.entities.provider_configuration.original_provider_configurate_methods", {}):
        return ProviderConfiguration(
            tenant_id="tenant-1",
            provider=provider_entity,
            preferred_provider_type=ProviderType.SYSTEM,
            using_provider_type=ProviderType.SYSTEM,
            system_configuration=system_configuration,
            custom_configuration=CustomConfiguration(provider=None, models=[]),
            model_settings=[],
        )


def _secret_provider_schema() -> ProviderCredentialSchema:
    return ProviderCredentialSchema(
        credential_form_schemas=[
            CredentialFormSchema(
                variable="openai_api_key",
                label=I18nObject(en_US="API Key"),
                type=FormType.SECRET_INPUT,
            )
        ]
    )


def _build_ai_model(name: str, *, model_type: ModelType = ModelType.LLM) -> AIModelEntity:
    return AIModelEntity(
        model=name,
        label=I18nObject(en_US=name),
        model_type=model_type,
        fetch_from=FetchFrom.PREDEFINED_MODEL,
        model_properties={},
    )


def test_provider_configurations_get_models_forwards_filters() -> None:
    configuration = _build_provider_configuration()
    provider_key = str(ModelProviderID("openai"))
    configurations = ProviderConfigurations(tenant_id="tenant-1")
    configurations[provider_key] = configuration
    expected_model = Mock()

    with patch.object(ProviderConfiguration, "get_provider_models", return_value=[expected_model]) as mock_get:
        models = configurations.get_models(provider="openai", model_type=ModelType.LLM, only_active=True)

    mock_get.assert_called_once_with(ModelType.LLM, True)
    assert models == [expected_model]


def test_provider_configurations_get_models_skips_non_matching_provider_filter() -> None:
    configuration = _build_provider_configuration()
    provider_key = str(ModelProviderID("openai"))
    configurations = ProviderConfigurations(tenant_id="tenant-1")
    configurations[provider_key] = configuration

    with patch.object(ProviderConfiguration, "get_provider_models", return_value=[Mock()]) as mock_get:
        models = configurations.get_models(provider="anthropic", model_type=ModelType.LLM, only_active=True)

    assert models == []
    mock_get.assert_not_called()


def test_get_current_credentials_custom_provider_checks_all_available_credentials() -> None:
    configuration = _build_provider_configuration()
    configuration.using_provider_type = ProviderType.CUSTOM
    configuration.custom_configuration.provider = CustomProviderConfiguration(
        credentials={"api_key": "provider-key"},
        available_credentials=[
            CredentialConfiguration(credential_id="cred-1", credential_name="First"),
            CredentialConfiguration(credential_id="cred-2", credential_name="Second"),
        ],
    )

    with patch("core.helper.credential_utils.check_credential_policy_compliance") as mock_check:
        credentials = configuration.get_current_credentials(ModelType.LLM, "gpt-4o")

    assert credentials == {"api_key": "provider-key"}
    assert [c.kwargs["credential_id"] for c in mock_check.call_args_list] == ["cred-1", "cred-2"]
    assert all(c.kwargs["provider"] == "openai" for c in mock_check.call_args_list)


def test_get_system_configuration_status_returns_none_when_current_quota_missing() -> None:
    configuration = _build_provider_configuration()
    configuration.system_configuration.current_quota_type = ProviderQuotaType.FREE

    status = configuration.get_system_configuration_status()
    assert status is None


def test_get_provider_credential_uses_specific_lookup_when_id_provided() -> None:
    configuration = _build_provider_configuration()

    with patch.object(configuration, "_get_specific_provider_credential", return_value={"api_key": "***"}) as mock_get:
        credential = configuration.get_provider_credential("credential-1")

    assert credential == {"api_key": "***"}
    mock_get.assert_called_once_with("credential-1")


def test_validate_provider_credentials_without_credential_id() -> None:
    configuration = _build_provider_configuration()
    mock_factory = Mock()
    mock_factory.provider_credentials_validate.return_value = {"region": "us"}

    with patch(
        "core.entities.provider_configuration.create_plugin_model_assembly",
        return_value=SimpleNamespace(model_runtime=Mock(), model_provider_factory=mock_factory),
    ):
        validated = configuration.validate_provider_credentials(credentials={"region": "us"})

    assert validated == {"region": "us"}


def test_get_model_type_instance_and_schema_delegate_to_factory() -> None:
    configuration = _build_provider_configuration()
    mock_model_type_instance = Mock()
    mock_schema = _build_ai_model("gpt-4o")
    mock_factory = Mock()
    mock_assembly = Mock()
    mock_assembly.model_runtime = Mock()
    mock_assembly.model_runtime.get_model_schema.return_value = mock_schema
    mock_assembly.model_provider_factory = mock_factory

    with (
        patch(
            "core.entities.provider_configuration.create_plugin_model_assembly",
            return_value=mock_assembly,
        ) as mock_assembly_builder,
        patch(
            "core.entities.provider_configuration.create_model_type_instance",
            return_value=mock_model_type_instance,
        ) as mock_model_builder,
    ):
        model_type_instance = configuration.get_model_type_instance(ModelType.LLM)
        model_schema = configuration.get_model_schema(ModelType.LLM, "gpt-4o", {"api_key": "x"})

    assert model_type_instance is mock_model_type_instance
    assert model_schema is mock_schema
    assert mock_assembly_builder.call_count == 2
    mock_model_builder.assert_called_once_with(
        runtime=mock_assembly.model_runtime,
        provider_schema=configuration.provider,
        model_type=ModelType.LLM,
    )
    mock_assembly.model_runtime.get_model_schema.assert_called_once_with(
        provider="openai",
        model_type=ModelType.LLM,
        model="gpt-4o",
        credentials={"api_key": "x"},
    )


def test_get_model_type_instance_and_schema_reuse_bound_runtime_factory() -> None:
    configuration = _build_provider_configuration()
    bound_runtime = Mock()
    bound_runtime.get_model_schema.return_value = _build_ai_model("gpt-4o")
    configuration.bind_model_runtime(bound_runtime)

    mock_model_type_instance = Mock()

    with (
        patch("core.entities.provider_configuration.ModelProviderFactory") as mock_factory_cls,
        patch("core.entities.provider_configuration.create_plugin_model_assembly") as mock_assembly_builder,
        patch(
            "core.entities.provider_configuration.create_model_type_instance",
            return_value=mock_model_type_instance,
        ) as mock_model_builder,
    ):
        model_type_instance = configuration.get_model_type_instance(ModelType.LLM)
        model_schema = configuration.get_model_schema(ModelType.LLM, "gpt-4o", {"api_key": "x"})

    assert model_type_instance is mock_model_type_instance
    assert model_schema == bound_runtime.get_model_schema.return_value
    mock_factory_cls.assert_not_called()
    mock_assembly_builder.assert_not_called()
    mock_model_builder.assert_called_once_with(
        runtime=bound_runtime,
        provider_schema=configuration.provider,
        model_type=ModelType.LLM,
    )
    bound_runtime.get_model_schema.assert_called_once_with(
        provider="openai",
        model_type=ModelType.LLM,
        model="gpt-4o",
        credentials={"api_key": "x"},
    )


def test_get_provider_model_returns_none_when_model_not_found() -> None:
    configuration = _build_provider_configuration()
    fake_model = SimpleNamespace(model="other-model")

    with patch.object(ProviderConfiguration, "get_provider_models", return_value=[fake_model]):
        selected = configuration.get_provider_model(ModelType.LLM, "gpt-4o")

    assert selected is None


def test_get_provider_models_system_deduplicates_sorts_and_filters_active() -> None:
    configuration = _build_provider_configuration()
    configuration.provider.position = {"llm": ["b-model", "a-model"]}
    configuration.model_settings = [
        ModelSettings(model="a-model", model_type=ModelType.LLM, enabled=False, load_balancing_configs=[])
    ]
    provider_schema = ProviderEntity(
        provider="openai",
        label=I18nObject(en_US="OpenAI"),
        supported_model_types=[ModelType.LLM],
        configurate_methods=[ConfigurateMethod.PREDEFINED_MODEL],
        models=[_build_ai_model("a-model"), _build_ai_model("b-model"), _build_ai_model("a-model")],
    )
    mock_factory = Mock()
    mock_factory.get_provider_schema.return_value = provider_schema

    with patch(
        "core.entities.provider_configuration.create_plugin_model_assembly",
        return_value=SimpleNamespace(model_runtime=Mock(), model_provider_factory=mock_factory),
    ):
        all_models = configuration.get_provider_models(model_type=ModelType.LLM, only_active=False)
        active_models = configuration.get_provider_models(model_type=ModelType.LLM, only_active=True)

    assert [model.model for model in all_models] == ["b-model", "a-model"]
    assert [model.status for model in all_models] == [ModelStatus.ACTIVE, ModelStatus.DISABLED]
    assert [model.model for model in active_models] == ["b-model"]


def test_get_provider_models_system_filters_requested_model() -> None:
    configuration = _build_provider_configuration()
    provider_schema = ProviderEntity(
        provider="openai",
        label=I18nObject(en_US="OpenAI"),
        supported_model_types=[ModelType.LLM],
        configurate_methods=[ConfigurateMethod.PREDEFINED_MODEL],
        models=[_build_ai_model("a-model"), _build_ai_model("target-model"), _build_ai_model("b-model")],
    )
    mock_factory = Mock()
    mock_factory.get_provider_schema.return_value = provider_schema

    with patch(
        "core.entities.provider_configuration.create_plugin_model_assembly",
        return_value=SimpleNamespace(model_runtime=Mock(), model_provider_factory=mock_factory),
    ):
        models = configuration.get_provider_models(
            model_type=ModelType.LLM,
            only_active=False,
            model="target-model",
        )

    assert [model.model for model in models] == ["target-model"]


def test_get_provider_models_system_customizable_filters_requested_restricted_model() -> None:
    provider = ProviderEntity(
        provider="openai",
        label=I18nObject(en_US="OpenAI"),
        supported_model_types=[ModelType.LLM],
        configurate_methods=[ConfigurateMethod.CUSTOMIZABLE_MODEL],
    )
    system_configuration = SystemConfiguration(
        enabled=True,
        credentials={"api_key": "test-key"},
        current_quota_type=ProviderQuotaType.TRIAL,
        quota_configurations=[
            QuotaConfiguration(
                quota_type=ProviderQuotaType.TRIAL,
                quota_unit=QuotaUnit.TOKENS,
                quota_limit=1_000,
                quota_used=0,
                is_valid=True,
                restrict_models=[
                    RestrictModel(model="target-model", base_model_name="base-model", model_type=ModelType.LLM),
                    RestrictModel(model="other-model", base_model_name="base-model", model_type=ModelType.LLM),
                ],
            )
        ],
    )
    provider_schema = ProviderEntity(
        provider="openai",
        label=I18nObject(en_US="OpenAI"),
        supported_model_types=[ModelType.LLM],
        configurate_methods=[ConfigurateMethod.PREDEFINED_MODEL],
        models=[],
    )
    mock_factory = Mock()
    mock_factory.get_provider_schema.return_value = provider_schema

    with patch("core.entities.provider_configuration.original_provider_configurate_methods", {}):
        configuration = ProviderConfiguration(
            tenant_id="tenant-1",
            provider=provider,
            preferred_provider_type=ProviderType.SYSTEM,
            using_provider_type=ProviderType.SYSTEM,
            system_configuration=system_configuration,
            custom_configuration=CustomConfiguration(provider=None, models=[]),
            model_settings=[],
        )

    with (
        patch(
            "core.entities.provider_configuration.create_plugin_model_assembly",
            return_value=SimpleNamespace(model_runtime=Mock(), model_provider_factory=mock_factory),
        ),
        patch.object(
            ProviderConfiguration,
            "get_model_schema",
            side_effect=lambda *args, **kwargs: _build_ai_model(kwargs["model"]),
        ) as mock_get_model_schema,
    ):
        models = configuration.get_provider_models(
            model_type=ModelType.LLM,
            only_active=False,
            model="target-model",
        )

    assert [model.model for model in models] == ["target-model"]
    mock_get_model_schema.assert_called_once()
    assert mock_get_model_schema.call_args.kwargs["model"] == "target-model"


def test_get_custom_provider_models_sets_status_for_removed_credentials_and_invalid_lb_configs() -> None:
    configuration = _build_provider_configuration()
    configuration.using_provider_type = ProviderType.CUSTOM
    configuration.custom_configuration.provider = CustomProviderConfiguration(credentials={"api_key": "provider-key"})
    configuration.custom_configuration.models = [
        CustomModelConfiguration(
            model="custom-model",
            model_type=ModelType.LLM,
            credentials=None,
            available_model_credentials=[CredentialConfiguration(credential_id="c-1", credential_name="first")],
        )
    ]
    provider_schema = ProviderEntity(
        provider="openai",
        label=I18nObject(en_US="OpenAI"),
        supported_model_types=[ModelType.LLM],
        configurate_methods=[ConfigurateMethod.PREDEFINED_MODEL],
        models=[_build_ai_model("base-model")],
    )
    model_setting_map = {
        ModelType.LLM: {
            "base-model": ModelSettings(
                model="base-model",
                model_type=ModelType.LLM,
                enabled=True,
                load_balancing_enabled=True,
                load_balancing_configs=[
                    ModelLoadBalancingConfiguration(
                        id="lb-base",
                        name="LB Base",
                        credentials={},
                        credential_source_type=CredentialSourceType.PROVIDER,
                    )
                ],
            ),
            "custom-model": ModelSettings(
                model="custom-model",
                model_type=ModelType.LLM,
                enabled=True,
                load_balancing_enabled=True,
                load_balancing_configs=[
                    ModelLoadBalancingConfiguration(
                        id="lb-custom",
                        name="LB Custom",
                        credentials={},
                        credential_source_type=CredentialSourceType.CUSTOM_MODEL,
                    )
                ],
            ),
        }
    }

    with patch.object(ProviderConfiguration, "get_model_schema", return_value=_build_ai_model("custom-model")):
        models = configuration._get_custom_provider_models(
            model_types=[ModelType.LLM],
            provider_schema=provider_schema,
            model_setting_map=model_setting_map,
        )

    status_map = {model.model: model.status for model in models}
    invalid_lb_map = {model.model: model.has_invalid_load_balancing_configs for model in models}
    assert status_map["base-model"] == ModelStatus.ACTIVE
    assert status_map["custom-model"] == ModelStatus.CREDENTIAL_REMOVED
    assert invalid_lb_map["base-model"] is True
    assert invalid_lb_map["custom-model"] is True


def test_get_custom_provider_models_filters_requested_base_model() -> None:
    configuration = _build_provider_configuration()
    configuration.using_provider_type = ProviderType.CUSTOM
    configuration.custom_configuration.provider = CustomProviderConfiguration(credentials={"api_key": "provider-key"})
    provider_schema = ProviderEntity(
        provider="openai",
        label=I18nObject(en_US="OpenAI"),
        supported_model_types=[ModelType.LLM],
        configurate_methods=[ConfigurateMethod.PREDEFINED_MODEL],
        models=[_build_ai_model("base-model"), _build_ai_model("target-model")],
    )

    models = configuration._get_custom_provider_models(
        model_types=[ModelType.LLM],
        provider_schema=provider_schema,
        model_setting_map={},
        model="target-model",
    )

    assert [model.model for model in models] == ["target-model"]


def test_get_provider_models_reuses_cached_provider_schema() -> None:
    configuration = _build_provider_configuration()
    provider_schema = ProviderEntity(
        provider="openai",
        label=I18nObject(en_US="OpenAI"),
        supported_model_types=[ModelType.LLM],
        configurate_methods=[ConfigurateMethod.PREDEFINED_MODEL],
        models=[_build_ai_model("a-model"), _build_ai_model("b-model")],
    )
    configuration.provider = provider_schema

    with patch(
        "core.entities.provider_configuration.create_plugin_model_assembly",
    ) as mock_assembly_builder:
        configuration.get_provider_models(model_type=ModelType.LLM, model="a-model")
        configuration.get_provider_models(model_type=ModelType.LLM, model="b-model")

    mock_assembly_builder.assert_not_called()


def test_validator_adds_predefined_model_for_customizable_provider_with_restrictions() -> None:
    provider = ProviderEntity(
        provider="openai",
        label=I18nObject(en_US="OpenAI"),
        supported_model_types=[ModelType.LLM],
        configurate_methods=[ConfigurateMethod.CUSTOMIZABLE_MODEL],
    )
    system_configuration = SystemConfiguration(
        enabled=True,
        credentials={"api_key": "test-key"},
        current_quota_type=ProviderQuotaType.TRIAL,
        quota_configurations=[
            QuotaConfiguration(
                quota_type=ProviderQuotaType.TRIAL,
                quota_unit=QuotaUnit.TOKENS,
                quota_limit=100,
                quota_used=0,
                is_valid=True,
                restrict_models=[
                    RestrictModel(model="restricted", base_model_name="base-model", model_type=ModelType.LLM)
                ],
            )
        ],
    )
    with patch("core.entities.provider_configuration.original_provider_configurate_methods", {}):
        configuration = ProviderConfiguration(
            tenant_id="tenant-1",
            provider=provider,
            preferred_provider_type=ProviderType.SYSTEM,
            using_provider_type=ProviderType.SYSTEM,
            system_configuration=system_configuration,
            custom_configuration=CustomConfiguration(provider=None, models=[]),
            model_settings=[],
        )

    assert ConfigurateMethod.PREDEFINED_MODEL in configuration.provider.configurate_methods


def test_get_current_credentials_system_handles_disable_and_restricted_base_model() -> None:
    configuration = _build_provider_configuration()
    configuration.model_settings = [
        ModelSettings(model="gpt-4o", model_type=ModelType.LLM, enabled=False, load_balancing_configs=[])
    ]

    with pytest.raises(ValueError, match="Model gpt-4o is disabled"):
        configuration.get_current_credentials(ModelType.LLM, "gpt-4o")

    configuration.model_settings = []
    configuration.system_configuration.quota_configurations[0].restrict_models = [
        RestrictModel(model="gpt-4o", base_model_name="base-model", model_type=ModelType.LLM)
    ]
    credentials = configuration.get_current_credentials(ModelType.LLM, "gpt-4o")
    assert credentials["base_model_name"] == "base-model"


def test_get_current_credentials_prefers_model_specific_custom_credentials() -> None:
    configuration = _build_provider_configuration()
    configuration.using_provider_type = ProviderType.CUSTOM
    configuration.custom_configuration.models = [
        CustomModelConfiguration(
            model="gpt-4o",
            model_type=ModelType.LLM,
            credentials={"api_key": "model-key"},
        )
    ]
    configuration.custom_configuration.provider = CustomProviderConfiguration(credentials={"api_key": "provider-key"})

    credentials = configuration.get_current_credentials(ModelType.LLM, "gpt-4o")
    assert credentials == {"api_key": "model-key"}


def test_get_system_configuration_status_falsey_quota_returns_unsupported() -> None:
    class _FalseyQuota:
        quota_type = ProviderQuotaType.TRIAL
        is_valid = True

        def __bool__(self) -> bool:
            return False

    configuration = _build_provider_configuration()
    configuration.system_configuration.quota_configurations = [_FalseyQuota()]  # type: ignore[list-item]
    assert configuration.get_system_configuration_status() == SystemConfigurationStatus.UNSUPPORTED


def test_get_provider_credential_default_uses_custom_provider_credentials() -> None:
    configuration = _build_provider_configuration()
    configuration.custom_configuration.provider = CustomProviderConfiguration(credentials={"api_key": "provider-key"})
    obfuscated = configuration.get_provider_credential()
    assert obfuscated == {"api_key": "provider-key"}


def test_system_and_custom_provider_model_helpers_cover_remaining_skip_paths() -> None:
    configuration = _build_provider_configuration()
    provider_schema = ProviderEntity(
        provider="openai",
        label=I18nObject(en_US="OpenAI"),
        supported_model_types=[ModelType.LLM],
        configurate_methods=[ConfigurateMethod.CUSTOMIZABLE_MODEL],
        models=[_build_ai_model("llm-model")],
    )
    configuration.system_configuration.quota_configurations = [
        QuotaConfiguration(
            quota_type=ProviderQuotaType.FREE,
            quota_unit=QuotaUnit.TOKENS,
            quota_limit=100,
            quota_used=0,
            is_valid=True,
            restrict_models=[
                RestrictModel(model="target", base_model_name="base", model_type=ModelType.LLM),
            ],
        ),
        QuotaConfiguration(
            quota_type=ProviderQuotaType.TRIAL,
            quota_unit=QuotaUnit.TOKENS,
            quota_limit=100,
            quota_used=0,
            is_valid=True,
            restrict_models=[
                RestrictModel(model="target", base_model_name="base", model_type=ModelType.LLM),
                RestrictModel(model="error-model", base_model_name="base", model_type=ModelType.LLM),
                RestrictModel(model="none-model", base_model_name="base", model_type=ModelType.LLM),
                RestrictModel(
                    model="embed-model",
                    base_model_name="base",
                    model_type=ModelType.TEXT_EMBEDDING,
                ),
            ],
        ),
    ]
    configuration.system_configuration.current_quota_type = ProviderQuotaType.TRIAL

    def _system_schema(*, model_type: ModelType, model: str, credentials: dict | None):
        if model == "error-model":
            raise RuntimeError("boom")
        if model == "none-model":
            return None
        if model == "embed-model":
            return _build_ai_model("embed-model", model_type=ModelType.TEXT_EMBEDDING)
        return _build_ai_model("target")

    configuration._original_provider_configurate_methods = (ConfigurateMethod.CUSTOMIZABLE_MODEL,)
    with patch.object(ProviderConfiguration, "get_model_schema", side_effect=_system_schema):
        system_models = configuration._get_system_provider_models(
            model_types=[ModelType.LLM],
            provider_schema=provider_schema,
            model_setting_map={
                ModelType.LLM: {
                    "target": ModelSettings(
                        model="target",
                        model_type=ModelType.LLM,
                        enabled=False,
                        load_balancing_configs=[],
                    )
                }
            },
        )
    assert any(model.model == "target" and model.status == ModelStatus.DISABLED for model in system_models)

    configuration.using_provider_type = ProviderType.CUSTOM
    configuration.custom_configuration.provider = CustomProviderConfiguration(credentials={"api_key": "provider-key"})
    configuration.custom_configuration.models = [
        CustomModelConfiguration(
            model="skip-model-type",
            model_type=ModelType.TEXT_EMBEDDING,
            credentials={"k": "v"},
        ),
        CustomModelConfiguration(
            model="skip-unadded",
            model_type=ModelType.LLM,
            credentials={"k": "v"},
            unadded_to_model_list=True,
        ),
        CustomModelConfiguration(
            model="skip-filter",
            model_type=ModelType.LLM,
            credentials={"k": "v"},
        ),
        CustomModelConfiguration(
            model="error-custom",
            model_type=ModelType.LLM,
            credentials={"k": "v"},
        ),
        CustomModelConfiguration(
            model="none-custom",
            model_type=ModelType.LLM,
            credentials={"k": "v"},
        ),
        CustomModelConfiguration(
            model="disabled-custom",
            model_type=ModelType.LLM,
            credentials={"k": "v"},
        ),
    ]

    provider_schema = ProviderEntity(
        provider="openai",
        label=I18nObject(en_US="OpenAI"),
        supported_model_types=[ModelType.LLM],
        configurate_methods=[ConfigurateMethod.PREDEFINED_MODEL],
        models=[_build_ai_model("base-disabled")],
    )
    model_setting_map = {
        ModelType.LLM: {
            "base-disabled": ModelSettings(
                model="base-disabled",
                model_type=ModelType.LLM,
                enabled=False,
                load_balancing_enabled=True,
                load_balancing_configs=[ModelLoadBalancingConfiguration(id="lb-1", name="lb", credentials={})],
            ),
            "disabled-custom": ModelSettings(
                model="disabled-custom",
                model_type=ModelType.LLM,
                enabled=False,
                load_balancing_enabled=False,
                load_balancing_configs=[],
            ),
        }
    }

    def _custom_schema(*, model_type: ModelType, model: str, credentials: dict | None):
        if model == "error-custom":
            raise RuntimeError("boom")
        if model == "none-custom":
            return None
        return _build_ai_model(model)

    with patch.object(ProviderConfiguration, "get_model_schema", side_effect=_custom_schema):
        custom_models = configuration._get_custom_provider_models(
            model_types=[ModelType.LLM],
            provider_schema=provider_schema,
            model_setting_map=model_setting_map,
            model="disabled-custom",
        )
    assert any(model.model == "base-disabled" and model.status == ModelStatus.DISABLED for model in custom_models)
    assert any(model.model == "disabled-custom" and model.status == ModelStatus.DISABLED for model in custom_models)


def test_get_current_credentials_skips_non_current_quota_restrictions() -> None:
    configuration = _build_provider_configuration()
    configuration.system_configuration.current_quota_type = ProviderQuotaType.TRIAL
    configuration.system_configuration.quota_configurations = [
        QuotaConfiguration(
            quota_type=ProviderQuotaType.FREE,
            quota_unit=QuotaUnit.TOKENS,
            quota_limit=100,
            quota_used=0,
            is_valid=True,
            restrict_models=[
                RestrictModel(model="gpt-4o", base_model_name="free-base", model_type=ModelType.LLM),
            ],
        ),
        QuotaConfiguration(
            quota_type=ProviderQuotaType.TRIAL,
            quota_unit=QuotaUnit.TOKENS,
            quota_limit=100,
            quota_used=0,
            is_valid=True,
            restrict_models=[
                RestrictModel(model="gpt-4o", base_model_name="trial-base", model_type=ModelType.LLM),
            ],
        ),
    ]

    credentials = configuration.get_current_credentials(ModelType.LLM, "gpt-4o")
    assert credentials["base_model_name"] == "trial-base"


def test_get_system_configuration_status_covers_disabled_and_quota_exceeded() -> None:
    configuration = _build_provider_configuration()
    configuration.system_configuration.enabled = False
    assert configuration.get_system_configuration_status() == SystemConfigurationStatus.UNSUPPORTED

    configuration.system_configuration.enabled = True
    configuration.system_configuration.quota_configurations = [
        QuotaConfiguration(
            quota_type=ProviderQuotaType.TRIAL,
            quota_unit=QuotaUnit.TOKENS,
            quota_limit=100,
            quota_used=100,
            is_valid=False,
            restrict_models=[],
        )
    ]
    configuration.system_configuration.current_quota_type = ProviderQuotaType.TRIAL
    assert configuration.get_system_configuration_status() == SystemConfigurationStatus.QUOTA_EXCEEDED


def test_get_custom_provider_models_skips_schema_models_with_mismatched_type() -> None:
    configuration = _build_provider_configuration()
    provider_schema = ProviderEntity(
        provider="openai",
        label=I18nObject(en_US="OpenAI"),
        supported_model_types=[ModelType.LLM, ModelType.TEXT_EMBEDDING],
        configurate_methods=[ConfigurateMethod.PREDEFINED_MODEL],
        models=[
            _build_ai_model("llm-model", model_type=ModelType.LLM),
            _build_ai_model("embed-model", model_type=ModelType.TEXT_EMBEDDING),
        ],
    )

    models = configuration._get_custom_provider_models(
        model_types=[ModelType.LLM],
        provider_schema=provider_schema,
        model_setting_map={},
    )

    assert any(model.model == "llm-model" for model in models)
    assert all(model.model != "embed-model" for model in models)


def test_get_custom_provider_models_skips_custom_models_on_schema_error_or_none(
    caplog: pytest.LogCaptureFixture,
) -> None:
    configuration = _build_provider_configuration()
    configuration.custom_configuration.models = [
        CustomModelConfiguration(model="error-custom", model_type=ModelType.LLM, credentials={"k": "v"}),
        CustomModelConfiguration(model="none-custom", model_type=ModelType.LLM, credentials={"k": "v"}),
        CustomModelConfiguration(model="ok-custom", model_type=ModelType.LLM, credentials={"k": "v"}),
    ]
    provider_schema = ProviderEntity(
        provider="openai",
        label=I18nObject(en_US="OpenAI"),
        supported_model_types=[ModelType.LLM],
        configurate_methods=[ConfigurateMethod.PREDEFINED_MODEL],
        models=[],
    )

    def _schema(*, model_type: ModelType, model: str, credentials: dict | None):
        if model == "error-custom":
            raise RuntimeError("boom")
        if model == "none-custom":
            return None
        return _build_ai_model(model)

    with caplog.at_level(logging.WARNING, logger="core.entities.provider_configuration"):
        with patch.object(ProviderConfiguration, "get_model_schema", side_effect=_schema):
            models = configuration._get_custom_provider_models(
                model_types=[ModelType.LLM],
                provider_schema=provider_schema,
                model_setting_map={},
            )

    assert "get custom model schema failed, boom" in caplog.messages
    assert any(model.model == "ok-custom" for model in models)
    assert all(model.model != "none-custom" for model in models)


def _secret_model_schema() -> ModelCredentialSchema:
    return ModelCredentialSchema(
        model=FieldModelSchema(label=I18nObject(en_US="Model")),
        credential_form_schemas=[
            CredentialFormSchema(
                variable="openai_api_key",
                label=I18nObject(en_US="API Key"),
                type=FormType.SECRET_INPUT,
            )
        ],
    )


@pytest.fixture
def orm_session(sqlite_engine: Engine) -> Iterator[Session]:
    models = (
        Provider,
        ProviderCredential,
        ProviderModel,
        ProviderModelCredential,
        LoadBalancingModelConfig,
        ProviderModelSetting,
        TenantPreferredModelProvider,
    )
    tables = [model.metadata.tables[model.__tablename__] for model in models]
    TypeBase.metadata.create_all(sqlite_engine, tables=tables)
    with patch.object(type(db), "engine", new_callable=PropertyMock, return_value=sqlite_engine):
        with Session(sqlite_engine, expire_on_commit=False) as session:
            yield session


def _provider_credential(
    session: Session,
    *,
    name: str = "API KEY 1",
    tenant_id: str = "tenant-1",
    provider_name: str = "openai",
    encrypted_config: str = "{}",
) -> ProviderCredential:
    record = ProviderCredential(
        tenant_id=tenant_id,
        provider_name=provider_name,
        credential_name=name,
        encrypted_config=encrypted_config,
    )
    session.add(record)
    session.commit()
    return record


def _provider_record(
    session: Session,
    *,
    credential_id: str | None = None,
    tenant_id: str = "tenant-1",
    provider_name: str = "openai",
) -> Provider:
    record = Provider(
        tenant_id=tenant_id,
        provider_name=provider_name,
        provider_type=ProviderType.CUSTOM,
        credential_id=credential_id,
        is_valid=True,
    )
    session.add(record)
    session.commit()
    return record


def _model_credential(
    session: Session,
    *,
    name: str = "API KEY 1",
    tenant_id: str = "tenant-1",
    provider_name: str = "openai",
    model: str = "gpt-4o",
    encrypted_config: str = "{}",
) -> ProviderModelCredential:
    record = ProviderModelCredential(
        tenant_id=tenant_id,
        provider_name=provider_name,
        model_name=model,
        model_type=ModelType.LLM,
        credential_name=name,
        encrypted_config=encrypted_config,
    )
    session.add(record)
    session.commit()
    return record


def _model_record(
    session: Session,
    *,
    credential_id: str | None = None,
    tenant_id: str = "tenant-1",
    provider_name: str = "openai",
    model: str = "gpt-4o",
) -> ProviderModel:
    record = ProviderModel(
        tenant_id=tenant_id,
        provider_name=provider_name,
        model_name=model,
        model_type=ModelType.LLM,
        credential_id=credential_id,
        is_valid=True,
    )
    session.add(record)
    session.commit()
    return record


def _load_balancing_config(
    session: Session,
    *,
    credential_id: str,
    source: CredentialSourceType,
    name: str = "Old",
) -> LoadBalancingModelConfig:
    record = LoadBalancingModelConfig(
        tenant_id="tenant-1",
        provider_name="openai",
        model_name="gpt-4o",
        model_type=ModelType.LLM,
        name=name,
        encrypted_config="{}",
        credential_id=credential_id,
        credential_source_type=source,
    )
    session.add(record)
    session.commit()
    return record


@contextmanager
def _raise_on_sql(engine: Engine, table_name: str, operation: str) -> Iterator[None]:
    """Fail one table/operation while production still owns a real transaction."""

    def fail_target(_conn, _cursor, statement, _parameters, _context, _executemany):
        if statement.lstrip().upper().startswith(operation) and table_name in statement:
            raise RuntimeError(f"forced {operation} failure for {table_name}")

    event.listen(engine, "before_cursor_execute", fail_target)
    try:
        yield
    finally:
        event.remove(engine, "before_cursor_execute", fail_target)


@contextmanager
def _mock_cache_boundaries() -> Iterator[None]:
    with (
        patch("core.entities.provider_configuration.ProviderCredentialsCache"),
        patch.object(ProviderConfiguration, "_invalidate_provider_configuration_cache"),
    ):
        yield


def test_secret_extraction_and_obfuscation() -> None:
    configuration = _build_provider_configuration()
    schemas = [
        CredentialFormSchema(variable="api_key", label=I18nObject(en_US="API Key"), type=FormType.SECRET_INPUT),
        CredentialFormSchema(variable="endpoint", label=I18nObject(en_US="Endpoint"), type=FormType.TEXT_INPUT),
    ]
    assert configuration.extract_secret_variables(schemas) == ["api_key"]
    with patch("core.entities.provider_configuration.encrypter.obfuscated_token", return_value="masked"):
        result = configuration.obfuscated_credentials({"api_key": "secret", "endpoint": "https://example.com"}, schemas)
    assert result == {"api_key": "masked", "endpoint": "https://example.com"}


def test_provider_configurations_container_and_credentials() -> None:
    configuration = _build_provider_configuration()
    configurations = ProviderConfigurations(tenant_id="tenant-1")
    provider_key = str(ModelProviderID("openai"))
    configurations[provider_key] = configuration
    assert configurations["openai"] is configuration
    assert configurations.to_list() == [configuration]

    configuration.using_provider_type = ProviderType.CUSTOM
    configuration.custom_configuration.provider = CustomProviderConfiguration(
        credentials={"api_key": "provider-key"},
        current_credential_id="credential-1",
        available_credentials=[CredentialConfiguration(credential_id="credential-1", credential_name="Primary")],
    )
    with patch("core.helper.credential_utils.check_credential_policy_compliance"):
        assert configuration.get_current_credentials(ModelType.LLM, "gpt-4o") == {"api_key": "provider-key"}


def test_system_configuration_status_and_provider_aliases() -> None:
    configuration = _build_provider_configuration(provider_name="langgenius/openai/openai")
    assert configuration.get_system_configuration_status() == SystemConfigurationStatus.ACTIVE
    assert configuration._get_provider_names() == ["langgenius/openai/openai", "openai"]
    configuration.system_configuration.current_quota_type = ProviderQuotaType.FREE
    assert configuration.get_system_configuration_status() is None


def test_generate_credential_names_from_real_rows_and_tenant_isolation(orm_session: Session) -> None:
    configuration = _build_provider_configuration()
    _provider_credential(orm_session, name="API KEY 9")
    _provider_credential(orm_session, name="legacy")
    _provider_credential(orm_session, name="API KEY 50", tenant_id="other-tenant")
    _model_credential(orm_session, name="API KEY 4")
    assert configuration._generate_provider_credential_name(orm_session) == "API KEY 10"
    assert configuration._generate_custom_model_credential_name("gpt-4o", ModelType.LLM, orm_session) == "API KEY 5"


def test_validate_provider_credentials_reuses_hidden_secret(orm_session: Session) -> None:
    configuration = _build_provider_configuration()
    configuration.provider.provider_credential_schema = _secret_provider_schema()
    credential = _provider_credential(orm_session, encrypted_config='{"openai_api_key":"enc-old"}')
    factory = Mock()
    factory.provider_credentials_validate.return_value = {"openai_api_key": "raw"}
    with (
        patch(
            "core.entities.provider_configuration.create_plugin_model_assembly",
            return_value=SimpleNamespace(model_runtime=Mock(), model_provider_factory=factory),
        ),
        patch("core.entities.provider_configuration.encrypter.decrypt_token", return_value="raw"),
        patch("core.entities.provider_configuration.encrypter.encrypt_token", return_value="enc-new"),
    ):
        result = configuration.validate_provider_credentials(
            {"openai_api_key": HIDDEN_VALUE}, credential_id=credential.id
        )
    assert result == {"openai_api_key": "enc-new"}


def test_preferred_provider_state_updates_and_is_tenant_scoped(orm_session: Session) -> None:
    configuration = _build_provider_configuration()
    configuration.preferred_provider_type = ProviderType.CUSTOM
    other = TenantPreferredModelProvider(
        tenant_id="other-tenant", provider_name="openai", preferred_provider_type=ProviderType.CUSTOM
    )
    current = TenantPreferredModelProvider(
        tenant_id="tenant-1", provider_name="openai", preferred_provider_type=ProviderType.CUSTOM
    )
    orm_session.add_all([other, current])
    orm_session.commit()
    assert configuration.switch_preferred_provider_type(ProviderType.SYSTEM, session=orm_session)
    orm_session.refresh(current)
    orm_session.refresh(other)
    assert current.preferred_provider_type == ProviderType.SYSTEM
    assert other.preferred_provider_type == ProviderType.CUSTOM


def test_provider_record_duplicate_and_setting_helpers_use_real_session(orm_session: Session) -> None:
    configuration = _build_provider_configuration()
    provider = _provider_record(orm_session)
    _provider_record(orm_session, tenant_id="other-tenant")
    credential = _provider_credential(orm_session, name="Main")
    _provider_credential(orm_session, name="Main", tenant_id="other-tenant")
    setting = ProviderModelSetting(
        tenant_id="tenant-1",
        provider_name="openai",
        model_name="gpt-4o",
        model_type=ModelType.LLM,
    )
    orm_session.add(setting)
    orm_session.commit()
    assert configuration._get_provider_record(orm_session).id == provider.id
    assert configuration._check_provider_credential_name_exists("Main", orm_session)
    assert not configuration._check_provider_credential_name_exists("Main", orm_session, exclude_id=credential.id)
    assert configuration._get_provider_model_setting(ModelType.LLM, "gpt-4o", orm_session).id == setting.id


def test_create_provider_credential_persists_provider_and_rejects_duplicate(orm_session: Session) -> None:
    configuration = _build_provider_configuration()
    with (
        patch.object(ProviderConfiguration, "validate_provider_credentials", return_value={"api_key": "enc"}),
        _mock_cache_boundaries(),
    ):
        configuration.create_provider_credential({"api_key": "raw"}, "Main")
    credential = orm_session.scalar(select(ProviderCredential).where(ProviderCredential.credential_name == "Main"))
    provider = orm_session.scalar(select(Provider).where(Provider.tenant_id == "tenant-1"))
    assert credential is not None
    assert provider is not None
    assert provider.credential_id == credential.id
    with pytest.raises(ValueError, match="already exists"):
        configuration.create_provider_credential({"api_key": "raw"}, "Main")


def test_update_provider_credential_propagates_to_load_balancing(orm_session: Session) -> None:
    configuration = _build_provider_configuration()
    credential = _provider_credential(orm_session, name="Old")
    _provider_record(orm_session, credential_id=credential.id)
    lb_config = _load_balancing_config(orm_session, credential_id=credential.id, source=CredentialSourceType.PROVIDER)
    with (
        patch.object(ProviderConfiguration, "validate_provider_credentials", return_value={"api_key": "enc-new"}),
        _mock_cache_boundaries(),
    ):
        configuration.update_provider_credential({"api_key": "raw"}, credential.id, "New")
    orm_session.expire_all()
    assert orm_session.get(ProviderCredential, credential.id).credential_name == "New"
    persisted_lb = orm_session.get(LoadBalancingModelConfig, lb_config.id)
    assert persisted_lb.name == "New"
    assert json.loads(persisted_lb.encrypted_config) == {"api_key": "enc-new"}


def test_switch_and_delete_provider_credentials_updates_persisted_state(orm_session: Session) -> None:
    configuration = _build_provider_configuration()
    first = _provider_credential(orm_session, name="First")
    second = _provider_credential(orm_session, name="Second")
    provider = _provider_record(orm_session, credential_id=first.id)
    first_id = first.id
    second_id = second.id
    provider_id = provider.id
    with _mock_cache_boundaries():
        configuration.switch_active_provider_credential(second_id)
        configuration.delete_provider_credential(second_id)
    orm_session.expire_all()
    assert orm_session.get(ProviderCredential, second_id) is None
    assert orm_session.get(ProviderCredential, first_id) is not None
    assert orm_session.get(Provider, provider_id).credential_id is None


def test_specific_provider_credential_decrypts_and_obfuscates(orm_session: Session) -> None:
    configuration = _build_provider_configuration()
    configuration.provider.provider_credential_schema = _secret_provider_schema()
    credential = _provider_credential(orm_session, encrypted_config='{"openai_api_key":"enc"}')
    with (
        patch("core.entities.provider_configuration.encrypter.decrypt_token", return_value="raw"),
        patch("core.entities.provider_configuration.encrypter.obfuscated_token", return_value="masked"),
    ):
        result = configuration._get_specific_provider_credential(credential.id)
    assert result == {"openai_api_key": "masked"}
    with pytest.raises(ValueError, match="not found"):
        configuration._get_specific_provider_credential("missing")


def test_validate_custom_model_credentials_reuses_hidden_secret(orm_session: Session) -> None:
    configuration = _build_provider_configuration()
    configuration.provider.model_credential_schema = _secret_model_schema()
    credential = _model_credential(orm_session, encrypted_config='{"openai_api_key":"enc-old"}')
    factory = Mock()
    factory.model_credentials_validate.return_value = {"openai_api_key": "raw"}
    with (
        patch(
            "core.entities.provider_configuration.create_plugin_model_assembly",
            return_value=SimpleNamespace(model_runtime=Mock(), model_provider_factory=factory),
        ),
        patch("core.entities.provider_configuration.encrypter.decrypt_token", return_value="raw"),
        patch("core.entities.provider_configuration.encrypter.encrypt_token", return_value="enc-new"),
    ):
        result = configuration.validate_custom_model_credentials(
            ModelType.LLM,
            "gpt-4o",
            {"openai_api_key": HIDDEN_VALUE},
            credential_id=credential.id,
        )
    assert result == {"openai_api_key": "enc-new"}


def test_create_update_and_delete_custom_model_credential(orm_session: Session) -> None:
    configuration = _build_provider_configuration()
    with (
        patch.object(ProviderConfiguration, "validate_custom_model_credentials", return_value={"api_key": "enc"}),
        _mock_cache_boundaries(),
    ):
        configuration.create_custom_model_credential(ModelType.LLM, "gpt-4o", {"api_key": "raw"}, "Main")
    credential = orm_session.scalar(select(ProviderModelCredential))
    model = orm_session.scalar(select(ProviderModel))
    assert credential is not None
    assert model is not None
    assert model.credential_id == credential.id
    credential_id = credential.id
    model_id = model.id

    with (
        patch.object(ProviderConfiguration, "validate_custom_model_credentials", return_value={"api_key": "enc-2"}),
        _mock_cache_boundaries(),
    ):
        configuration.update_custom_model_credential(
            ModelType.LLM, "gpt-4o", {"api_key": "raw"}, "Renamed", credential_id
        )
    orm_session.expire_all()
    assert orm_session.get(ProviderModelCredential, credential_id).credential_name == "Renamed"

    with _mock_cache_boundaries():
        configuration.delete_custom_model_credential(ModelType.LLM, "gpt-4o", credential_id)
    orm_session.expire_all()
    assert orm_session.get(ProviderModelCredential, credential_id) is None
    assert orm_session.get(ProviderModel, model_id) is None


def test_add_and_switch_custom_model_credential(orm_session: Session) -> None:
    configuration = _build_provider_configuration()
    first = _model_credential(orm_session, name="First")
    second = _model_credential(orm_session, name="Second")
    with _mock_cache_boundaries():
        configuration.add_model_credential_to_model(ModelType.LLM, "gpt-4o", first.id)
        configuration.switch_custom_model_credential(ModelType.LLM, "gpt-4o", second.id)
    model = orm_session.scalar(select(ProviderModel))
    assert model is not None
    assert model.credential_id == second.id
    with pytest.raises(ValueError, match="Can't add same credential"):
        configuration.add_model_credential_to_model(ModelType.LLM, "gpt-4o", second.id)


def test_model_settings_and_load_balancing_persist(orm_session: Session) -> None:
    configuration = _build_provider_configuration()
    with patch.object(configuration, "_invalidate_provider_configuration_cache"):
        configuration.disable_model(ModelType.LLM, "gpt-4o")
    persisted_setting = orm_session.scalar(select(ProviderModelSetting))
    assert persisted_setting is not None
    setting_id = persisted_setting.id
    assert persisted_setting.enabled is False
    with patch.object(configuration, "_invalidate_provider_configuration_cache"):
        configuration.enable_model(ModelType.LLM, "gpt-4o")
    orm_session.expire_all()
    assert orm_session.get(ProviderModelSetting, setting_id).enabled is True

    first = _provider_credential(orm_session, name="First")
    second = _provider_credential(orm_session, name="Second")
    _load_balancing_config(orm_session, credential_id=first.id, source=CredentialSourceType.PROVIDER)
    _load_balancing_config(orm_session, credential_id=second.id, source=CredentialSourceType.PROVIDER)
    with patch.object(configuration, "_invalidate_provider_configuration_cache"):
        configuration.enable_model_load_balancing(ModelType.LLM, "gpt-4o")
    orm_session.expire_all()
    assert orm_session.get(ProviderModelSetting, setting_id).load_balancing_enabled is True
    with patch.object(configuration, "_invalidate_provider_configuration_cache"):
        configuration.disable_model_load_balancing(ModelType.LLM, "gpt-4o")
    orm_session.expire_all()
    assert orm_session.get(ProviderModelSetting, setting_id).load_balancing_enabled is False


def test_provider_create_rolls_back_on_insert_failure(orm_session: Session, sqlite_engine: Engine) -> None:
    configuration = _build_provider_configuration()
    with (
        patch.object(ProviderConfiguration, "validate_provider_credentials", return_value={"api_key": "enc"}),
        _mock_cache_boundaries(),
        _raise_on_sql(sqlite_engine, "provider_credentials", "INSERT"),
        pytest.raises(RuntimeError, match="forced INSERT"),
    ):
        configuration.create_provider_credential({"api_key": "raw"}, "Main")
    assert orm_session.scalar(select(ProviderCredential)) is None
    assert orm_session.scalar(select(Provider)) is None


def test_custom_model_create_rolls_back_on_insert_failure(orm_session: Session, sqlite_engine: Engine) -> None:
    configuration = _build_provider_configuration()
    with (
        patch.object(ProviderConfiguration, "validate_custom_model_credentials", return_value={"api_key": "enc"}),
        _mock_cache_boundaries(),
        _raise_on_sql(sqlite_engine, "provider_model_credentials", "INSERT"),
        pytest.raises(RuntimeError, match="forced INSERT"),
    ):
        configuration.create_custom_model_credential(ModelType.LLM, "gpt-4o", {"api_key": "raw"}, "Main")
    assert orm_session.scalar(select(ProviderModelCredential)) is None
    assert orm_session.scalar(select(ProviderModel)) is None


def test_custom_configuration_fallback_and_status() -> None:
    configuration = _build_provider_configuration()
    assert not configuration.is_custom_configuration_available()
    configuration.custom_configuration.models = [
        CustomModelConfiguration(model="gpt-4o", model_type=ModelType.LLM, credentials={"api_key": "model-key"})
    ]
    configuration.using_provider_type = ProviderType.CUSTOM
    assert configuration.is_custom_configuration_available()
    assert configuration.get_current_credentials(ModelType.LLM, "gpt-4o") == {"api_key": "model-key"}
