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
from core.helper.model_provider_cache import ProviderCredentialsCacheType
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


def _build_ai_model(name: str, *, model_type: ModelType = ModelType.LLM) -> AIModelEntity:
    return AIModelEntity(
        model=name,
        label=I18nObject(en_US=name),
        model_type=model_type,
        fetch_from=FetchFrom.PREDEFINED_MODEL,
        model_properties={},
    )


def _build_secret_provider_schema() -> ProviderCredentialSchema:
    return ProviderCredentialSchema(
        credential_form_schemas=[
            CredentialFormSchema(
                variable="openai_api_key",
                label=I18nObject(en_US="API Key"),
                type=FormType.SECRET_INPUT,
            )
        ]
    )


def _build_secret_model_schema() -> ModelCredentialSchema:
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


def test_extract_secret_variables_returns_only_secret_inputs() -> None:
    configuration = _build_provider_configuration()
    credential_form_schemas = [
        CredentialFormSchema(
            variable="api_key",
            label=I18nObject(en_US="API Key"),
            type=FormType.SECRET_INPUT,
        ),
        CredentialFormSchema(
            variable="endpoint",
            label=I18nObject(en_US="Endpoint"),
            type=FormType.TEXT_INPUT,
        ),
    ]

    secret_variables = configuration.extract_secret_variables(credential_form_schemas)
    assert secret_variables == ["api_key"]


def test_obfuscated_credentials_masks_only_secret_fields() -> None:
    configuration = _build_provider_configuration()
    credential_form_schemas = [
        CredentialFormSchema(
            variable="api_key",
            label=I18nObject(en_US="API Key"),
            type=FormType.SECRET_INPUT,
        ),
        CredentialFormSchema(
            variable="endpoint",
            label=I18nObject(en_US="Endpoint"),
            type=FormType.TEXT_INPUT,
        ),
    ]

    with patch(
        "core.entities.provider_configuration.encrypter.obfuscated_token",
        side_effect=lambda value: f"masked-{value[-2:]}",
    ):
        obfuscated = configuration.obfuscated_credentials(
            credentials={"api_key": "sk-test-1234", "endpoint": "https://api.example.com"},
            credential_form_schemas=credential_form_schemas,
        )

    assert obfuscated["api_key"] == "masked-34"
    assert obfuscated["endpoint"] == "https://api.example.com"


def test_provider_configurations_behave_like_keyed_container() -> None:
    configuration = _build_provider_configuration()
    provider_key = str(ModelProviderID("openai"))
    configurations = ProviderConfigurations(tenant_id="tenant-1")

    configurations[provider_key] = configuration

    assert "openai" in configurations
    assert configurations["openai"] is configuration
    assert configurations.get("openai") is configuration
    assert configurations.to_list() == [configuration]
    assert list(configurations) == [(provider_key, configuration)]


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


def test_get_current_credentials_custom_provider_checks_current_credential() -> None:
    configuration = _build_provider_configuration()
    configuration.using_provider_type = ProviderType.CUSTOM
    configuration.custom_configuration.provider = CustomProviderConfiguration(
        credentials={"api_key": "provider-key"},
        current_credential_id="credential-1",
        current_credential_name="Primary",
        available_credentials=[],
    )

    with patch("core.helper.credential_utils.check_credential_policy_compliance") as mock_check:
        credentials = configuration.get_current_credentials(ModelType.LLM, "gpt-4o")

    assert credentials == {"api_key": "provider-key"}
    assert mock_check.call_count == 1
    assert mock_check.call_args.kwargs["credential_id"] == "credential-1"
    assert mock_check.call_args.kwargs["provider"] == "openai"


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


def test_get_provider_names_supports_legacy_and_full_plugin_id() -> None:
    configuration = _build_provider_configuration()
    configuration.provider.provider = "langgenius/openai/openai"

    provider_names = configuration._get_provider_names()
    assert provider_names == ["langgenius/openai/openai", "openai"]


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


@pytest.fixture
def sqlite_provider_session(
    sqlite_session: Session,
    sqlite_engine: Engine,
) -> Iterator[Session]:
    """Bind provider-owned sessions to the same isolated SQLite database as the test."""
    with patch.object(type(db), "engine", new_callable=PropertyMock, return_value=sqlite_engine):
        yield sqlite_session


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


def _provider_model_record(
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
    """Fail one table operation while production still owns a real transaction."""

    def fail_target(_conn, _cursor, statement, _parameters, _context, _executemany):
        if statement.lstrip().upper().startswith(operation) and table_name in statement:
            raise RuntimeError(f"forced {operation} failure for {table_name}")

    event.listen(engine, "before_cursor_execute", fail_target)
    try:
        yield
    finally:
        event.remove(engine, "before_cursor_execute", fail_target)


@contextmanager
def _mock_cache_boundaries() -> Iterator[tuple[Mock, Mock]]:
    with (
        patch("core.entities.provider_configuration.ProviderCredentialsCache") as credentials_cache,
        patch.object(ProviderConfiguration, "_invalidate_provider_configuration_cache") as configuration_cache,
    ):
        yield credentials_cache, configuration_cache


def test_generate_credential_names_from_real_rows_and_tenant_isolation(
    sqlite_provider_session: Session,
) -> None:
    configuration = _build_provider_configuration()
    _provider_credential(sqlite_provider_session, name="API KEY 9")
    _provider_credential(sqlite_provider_session, name="legacy")
    _provider_credential(sqlite_provider_session, name="API KEY 50", tenant_id="other-tenant")
    _model_credential(sqlite_provider_session, name="API KEY 4")
    assert configuration._generate_provider_credential_name(sqlite_provider_session) == "API KEY 10"
    assert (
        configuration._generate_custom_model_credential_name("gpt-4o", ModelType.LLM, sqlite_provider_session)
        == "API KEY 5"
    )


def test_validate_provider_credentials_reuses_hidden_secret(sqlite_provider_session: Session) -> None:
    configuration = _build_provider_configuration()
    configuration.provider.provider_credential_schema = _build_secret_provider_schema()
    credential = _provider_credential(sqlite_provider_session, encrypted_config='{"openai_api_key":"enc-old"}')
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


def test_preferred_provider_state_updates_and_is_tenant_scoped(sqlite_provider_session: Session) -> None:
    configuration = _build_provider_configuration()
    configuration.preferred_provider_type = ProviderType.CUSTOM
    other = TenantPreferredModelProvider(
        tenant_id="other-tenant", provider_name="openai", preferred_provider_type=ProviderType.CUSTOM
    )
    current = TenantPreferredModelProvider(
        tenant_id="tenant-1", provider_name="openai", preferred_provider_type=ProviderType.CUSTOM
    )
    sqlite_provider_session.add_all([other, current])
    sqlite_provider_session.commit()
    assert configuration.switch_preferred_provider_type(ProviderType.SYSTEM, session=sqlite_provider_session)
    sqlite_provider_session.refresh(current)
    sqlite_provider_session.refresh(other)
    assert current.preferred_provider_type == ProviderType.SYSTEM
    assert other.preferred_provider_type == ProviderType.CUSTOM


def test_provider_record_duplicate_and_setting_helpers_use_real_session(sqlite_provider_session: Session) -> None:
    configuration = _build_provider_configuration()
    provider = _provider_record(sqlite_provider_session)
    _provider_record(sqlite_provider_session, tenant_id="other-tenant")
    credential = _provider_credential(sqlite_provider_session, name="Main")
    _provider_credential(sqlite_provider_session, name="Main", tenant_id="other-tenant")
    setting = ProviderModelSetting(
        tenant_id="tenant-1",
        provider_name="openai",
        model_name="gpt-4o",
        model_type=ModelType.LLM,
    )
    sqlite_provider_session.add(setting)
    sqlite_provider_session.commit()
    assert configuration._get_provider_record(sqlite_provider_session).id == provider.id
    assert configuration._check_provider_credential_name_exists("Main", sqlite_provider_session)
    assert not configuration._check_provider_credential_name_exists(
        "Main", sqlite_provider_session, exclude_id=credential.id
    )
    assert configuration._get_provider_model_setting(ModelType.LLM, "gpt-4o", sqlite_provider_session).id == setting.id


def test_create_provider_credential_persists_provider_and_rejects_duplicate(
    sqlite_provider_session: Session,
) -> None:
    configuration = _build_provider_configuration()
    with (
        patch.object(ProviderConfiguration, "validate_provider_credentials", return_value={"api_key": "enc"}),
        _mock_cache_boundaries() as (credentials_cache, configuration_cache),
    ):
        configuration.create_provider_credential({"api_key": "raw"}, "Main")
    credential = sqlite_provider_session.scalar(
        select(ProviderCredential).where(ProviderCredential.credential_name == "Main")
    )
    provider = sqlite_provider_session.scalar(select(Provider).where(Provider.tenant_id == "tenant-1"))
    assert credential is not None
    assert provider is not None
    assert provider.credential_id == credential.id
    credentials_cache.assert_called_once_with(
        tenant_id="tenant-1",
        identity_id=provider.id,
        cache_type=ProviderCredentialsCacheType.PROVIDER,
    )
    credentials_cache.return_value.delete.assert_called_once_with()
    configuration_cache.assert_called_once_with(
        preferred_model_providers=True,
        provider_credentials=True,
    )
    with pytest.raises(ValueError, match="already exists"):
        configuration.create_provider_credential({"api_key": "raw"}, "Main")


def test_update_provider_credential_propagates_to_load_balancing(sqlite_provider_session: Session) -> None:
    configuration = _build_provider_configuration()
    credential = _provider_credential(sqlite_provider_session, name="Old")
    provider = _provider_record(sqlite_provider_session, credential_id=credential.id)
    lb_config = _load_balancing_config(
        sqlite_provider_session, credential_id=credential.id, source=CredentialSourceType.PROVIDER
    )
    with (
        patch.object(ProviderConfiguration, "validate_provider_credentials", return_value={"api_key": "enc-new"}),
        _mock_cache_boundaries() as (credentials_cache, configuration_cache),
    ):
        configuration.update_provider_credential({"api_key": "raw"}, credential.id, "New")
    sqlite_provider_session.expire_all()
    persisted_credential = sqlite_provider_session.get(ProviderCredential, credential.id)
    persisted_lb = sqlite_provider_session.get(LoadBalancingModelConfig, lb_config.id)
    assert persisted_credential is not None
    assert persisted_credential.credential_name == "New"
    assert persisted_lb is not None
    assert persisted_lb.name == "New"
    assert json.loads(persisted_lb.encrypted_config) == {"api_key": "enc-new"}
    assert {cache_call.kwargs["identity_id"] for cache_call in credentials_cache.call_args_list} == {
        provider.id,
        lb_config.id,
    }
    assert {cache_call.kwargs["cache_type"] for cache_call in credentials_cache.call_args_list} == {
        ProviderCredentialsCacheType.PROVIDER,
        ProviderCredentialsCacheType.LOAD_BALANCING_MODEL,
    }
    assert credentials_cache.return_value.delete.call_count == 2
    configuration_cache.assert_called_once_with(
        provider_credentials=True,
        provider_load_balancing_configs=True,
    )


def test_switch_active_provider_credential_updates_persisted_state_and_cache(
    sqlite_provider_session: Session,
) -> None:
    configuration = _build_provider_configuration()
    configuration.preferred_provider_type = ProviderType.CUSTOM
    first = _provider_credential(sqlite_provider_session, name="First")
    second = _provider_credential(sqlite_provider_session, name="Second")
    provider = _provider_record(sqlite_provider_session, credential_id=first.id)
    provider_id = provider.id

    with _mock_cache_boundaries() as (credentials_cache, configuration_cache):
        configuration.switch_active_provider_credential(second.id)

    sqlite_provider_session.expire_all()
    persisted_provider = sqlite_provider_session.get(Provider, provider_id)
    assert persisted_provider is not None
    assert persisted_provider.credential_id == second.id
    credentials_cache.assert_called_once_with(
        tenant_id="tenant-1",
        identity_id=provider_id,
        cache_type=ProviderCredentialsCacheType.PROVIDER,
    )
    credentials_cache.return_value.delete.assert_called_once_with()
    configuration_cache.assert_not_called()


def test_deleting_active_provider_credential_switches_preference_to_system(
    sqlite_provider_session: Session,
) -> None:
    configuration = _build_provider_configuration()
    configuration.preferred_provider_type = ProviderType.CUSTOM
    first = _provider_credential(sqlite_provider_session, name="First")
    active = _provider_credential(sqlite_provider_session, name="Active")
    provider = _provider_record(sqlite_provider_session, credential_id=active.id)
    preferred_provider = TenantPreferredModelProvider(
        tenant_id="tenant-1",
        provider_name="openai",
        preferred_provider_type=ProviderType.CUSTOM,
    )
    sqlite_provider_session.add(preferred_provider)
    sqlite_provider_session.commit()
    first_id = first.id
    active_id = active.id
    provider_id = provider.id
    preferred_provider_id = preferred_provider.id

    with _mock_cache_boundaries() as (credentials_cache, configuration_cache):
        configuration.delete_provider_credential(active_id)

    sqlite_provider_session.expire_all()
    assert sqlite_provider_session.get(ProviderCredential, active_id) is None
    assert sqlite_provider_session.get(ProviderCredential, first_id) is not None
    persisted_provider = sqlite_provider_session.get(Provider, provider_id)
    persisted_preference = sqlite_provider_session.get(TenantPreferredModelProvider, preferred_provider_id)
    assert persisted_provider is not None
    assert persisted_provider.credential_id is None
    assert persisted_preference is not None
    assert persisted_preference.preferred_provider_type == ProviderType.SYSTEM
    credentials_cache.assert_called_once_with(
        tenant_id="tenant-1",
        identity_id=provider_id,
        cache_type=ProviderCredentialsCacheType.PROVIDER,
    )
    credentials_cache.return_value.delete.assert_called_once_with()
    configuration_cache.assert_called_once_with(
        preferred_model_providers=True,
        provider_credentials=True,
        provider_load_balancing_configs=False,
    )


def test_specific_provider_credential_decrypts_and_obfuscates(sqlite_provider_session: Session) -> None:
    configuration = _build_provider_configuration()
    configuration.provider.provider_credential_schema = _build_secret_provider_schema()
    credential = _provider_credential(sqlite_provider_session, encrypted_config='{"openai_api_key":"enc"}')
    with (
        patch("core.entities.provider_configuration.encrypter.decrypt_token", return_value="raw"),
        patch("core.entities.provider_configuration.encrypter.obfuscated_token", return_value="masked"),
    ):
        result = configuration._get_specific_provider_credential(credential.id)
    assert result == {"openai_api_key": "masked"}
    with pytest.raises(ValueError, match="not found"):
        configuration._get_specific_provider_credential("missing")


def test_validate_custom_model_credentials_reuses_hidden_secret(sqlite_provider_session: Session) -> None:
    configuration = _build_provider_configuration()
    configuration.provider.model_credential_schema = _build_secret_model_schema()
    credential = _model_credential(sqlite_provider_session, encrypted_config='{"openai_api_key":"enc-old"}')
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


def test_specific_custom_model_credential_preserves_secret_when_decryption_fails(
    sqlite_provider_session: Session,
    caplog: pytest.LogCaptureFixture,
) -> None:
    configuration = _build_provider_configuration()
    configuration.provider.model_credential_schema = _build_secret_model_schema()
    credential = _model_credential(
        sqlite_provider_session,
        name="Main",
        encrypted_config='{"openai_api_key":"enc-secret"}',
    )

    with (
        caplog.at_level(logging.ERROR, logger="core.entities.provider_configuration"),
        patch("core.entities.provider_configuration.encrypter.decrypt_token", side_effect=RuntimeError("boom")),
        patch.object(
            ProviderConfiguration,
            "obfuscated_credentials",
            side_effect=lambda credentials, credential_form_schemas: credentials,
        ),
    ):
        result = configuration._get_specific_custom_model_credential(ModelType.LLM, "gpt-4o", credential.id)

    assert result == {
        "current_credential_id": credential.id,
        "current_credential_name": "Main",
        "credentials": {"openai_api_key": "enc-secret"},
    }
    assert caplog.messages.count("Failed to decrypt model credential secret variable openai_api_key") == 1


def test_create_update_and_delete_custom_model_credential(sqlite_provider_session: Session) -> None:
    configuration = _build_provider_configuration()
    with (
        patch.object(ProviderConfiguration, "validate_custom_model_credentials", return_value={"api_key": "enc"}),
        _mock_cache_boundaries() as (credentials_cache, configuration_cache),
    ):
        configuration.create_custom_model_credential(ModelType.LLM, "gpt-4o", {"api_key": "raw"}, "Main")
    credential = sqlite_provider_session.scalar(select(ProviderModelCredential))
    model = sqlite_provider_session.scalar(select(ProviderModel))
    assert credential is not None
    assert model is not None
    assert model.credential_id == credential.id
    credential_id = credential.id
    model_id = model.id
    lb_config = _load_balancing_config(
        sqlite_provider_session,
        credential_id=credential_id,
        source=CredentialSourceType.CUSTOM_MODEL,
    )
    lb_config_id = lb_config.id
    credentials_cache.assert_called_once_with(
        tenant_id="tenant-1",
        identity_id=model_id,
        cache_type=ProviderCredentialsCacheType.MODEL,
    )
    credentials_cache.return_value.delete.assert_called_once_with()
    configuration_cache.assert_called_once_with(
        provider_models=True,
        provider_model_credentials=True,
    )

    with (
        patch.object(ProviderConfiguration, "validate_custom_model_credentials", return_value={"api_key": "enc-2"}),
        _mock_cache_boundaries() as (credentials_cache, configuration_cache),
    ):
        configuration.update_custom_model_credential(
            ModelType.LLM, "gpt-4o", {"api_key": "raw"}, "Renamed", credential_id
        )
    sqlite_provider_session.expire_all()
    persisted_credential = sqlite_provider_session.get(ProviderModelCredential, credential_id)
    persisted_lb = sqlite_provider_session.get(LoadBalancingModelConfig, lb_config_id)
    assert persisted_credential is not None
    assert persisted_credential.credential_name == "Renamed"
    assert json.loads(persisted_credential.encrypted_config) == {"api_key": "enc-2"}
    assert persisted_lb is not None
    assert persisted_lb.name == "Renamed"
    assert json.loads(persisted_lb.encrypted_config) == {"api_key": "enc-2"}
    assert {cache_call.kwargs["identity_id"] for cache_call in credentials_cache.call_args_list} == {
        model_id,
        lb_config_id,
    }
    assert {cache_call.kwargs["cache_type"] for cache_call in credentials_cache.call_args_list} == {
        ProviderCredentialsCacheType.MODEL,
        ProviderCredentialsCacheType.LOAD_BALANCING_MODEL,
    }
    assert credentials_cache.return_value.delete.call_count == 2
    configuration_cache.assert_called_once_with(
        provider_models=True,
        provider_model_credentials=True,
        provider_load_balancing_configs=True,
    )

    with _mock_cache_boundaries() as (credentials_cache, configuration_cache):
        configuration.delete_custom_model_credential(ModelType.LLM, "gpt-4o", credential_id)
    sqlite_provider_session.expire_all()
    assert sqlite_provider_session.get(ProviderModelCredential, credential_id) is None
    assert sqlite_provider_session.get(ProviderModel, model_id) is None
    assert sqlite_provider_session.get(LoadBalancingModelConfig, lb_config_id) is None
    assert {cache_call.kwargs["identity_id"] for cache_call in credentials_cache.call_args_list} == {
        model_id,
        lb_config_id,
    }
    assert {cache_call.kwargs["cache_type"] for cache_call in credentials_cache.call_args_list} == {
        ProviderCredentialsCacheType.MODEL,
        ProviderCredentialsCacheType.LOAD_BALANCING_MODEL,
    }
    assert credentials_cache.return_value.delete.call_count == 2
    configuration_cache.assert_called_once_with(
        provider_models=True,
        provider_model_credentials=True,
        provider_load_balancing_configs=True,
    )


def test_add_and_switch_custom_model_credential(sqlite_provider_session: Session) -> None:
    configuration = _build_provider_configuration()
    first = _model_credential(sqlite_provider_session, name="First")
    second = _model_credential(sqlite_provider_session, name="Second")
    with _mock_cache_boundaries() as (credentials_cache, configuration_cache):
        configuration.add_model_credential_to_model(ModelType.LLM, "gpt-4o", first.id)
        configuration.switch_custom_model_credential(ModelType.LLM, "gpt-4o", second.id)
    model = sqlite_provider_session.scalar(select(ProviderModel))
    assert model is not None
    assert model.credential_id == second.id
    credentials_cache.assert_called_once_with(
        tenant_id="tenant-1",
        identity_id=model.id,
        cache_type=ProviderCredentialsCacheType.MODEL,
    )
    credentials_cache.return_value.delete.assert_called_once_with()
    assert configuration_cache.call_count == 2
    for cache_call in configuration_cache.call_args_list:
        assert cache_call.kwargs == {"provider_models": True}
    with pytest.raises(ValueError, match="Can't add same credential"):
        configuration.add_model_credential_to_model(ModelType.LLM, "gpt-4o", second.id)


def test_model_settings_and_load_balancing_persist(sqlite_provider_session: Session) -> None:
    configuration = _build_provider_configuration()
    with patch.object(configuration, "_invalidate_provider_configuration_cache") as configuration_cache:
        configuration.disable_model(ModelType.LLM, "gpt-4o")
    configuration_cache.assert_called_once_with(provider_model_settings=True)
    persisted_setting = sqlite_provider_session.scalar(select(ProviderModelSetting))
    assert persisted_setting is not None
    assert persisted_setting.enabled is False
    with patch.object(configuration, "_invalidate_provider_configuration_cache") as configuration_cache:
        configuration.enable_model(ModelType.LLM, "gpt-4o")
    configuration_cache.assert_called_once_with(provider_model_settings=True)
    sqlite_provider_session.expire_all()
    refreshed_setting = sqlite_provider_session.get(ProviderModelSetting, persisted_setting.id)
    assert refreshed_setting is not None
    assert refreshed_setting.enabled is True

    first = _provider_credential(sqlite_provider_session, name="First")
    second = _provider_credential(sqlite_provider_session, name="Second")
    _load_balancing_config(sqlite_provider_session, credential_id=first.id, source=CredentialSourceType.PROVIDER)
    _load_balancing_config(sqlite_provider_session, credential_id=second.id, source=CredentialSourceType.PROVIDER)
    with patch.object(configuration, "_invalidate_provider_configuration_cache") as configuration_cache:
        configuration.enable_model_load_balancing(ModelType.LLM, "gpt-4o")
    configuration_cache.assert_called_once_with(provider_model_settings=True)
    sqlite_provider_session.expire_all()
    refreshed_setting = sqlite_provider_session.get(ProviderModelSetting, persisted_setting.id)
    assert refreshed_setting is not None
    assert refreshed_setting.load_balancing_enabled is True
    with patch.object(configuration, "_invalidate_provider_configuration_cache") as configuration_cache:
        configuration.disable_model_load_balancing(ModelType.LLM, "gpt-4o")
    configuration_cache.assert_called_once_with(provider_model_settings=True)
    sqlite_provider_session.expire_all()
    refreshed_setting = sqlite_provider_session.get(ProviderModelSetting, persisted_setting.id)
    assert refreshed_setting is not None
    assert refreshed_setting.load_balancing_enabled is False


def test_provider_create_rolls_back_on_insert_failure(
    sqlite_provider_session: Session,
    sqlite_engine: Engine,
) -> None:
    configuration = _build_provider_configuration()
    with (
        patch.object(ProviderConfiguration, "validate_provider_credentials", return_value={"api_key": "enc"}),
        _mock_cache_boundaries(),
        _raise_on_sql(sqlite_engine, "provider_credentials", "INSERT"),
        pytest.raises(RuntimeError, match="forced INSERT"),
    ):
        configuration.create_provider_credential({"api_key": "raw"}, "Main")
    assert sqlite_provider_session.scalar(select(ProviderCredential)) is None
    assert sqlite_provider_session.scalar(select(Provider)) is None


def test_custom_model_create_rolls_back_on_insert_failure(
    sqlite_provider_session: Session,
    sqlite_engine: Engine,
) -> None:
    configuration = _build_provider_configuration()
    with (
        patch.object(ProviderConfiguration, "validate_custom_model_credentials", return_value={"api_key": "enc"}),
        _mock_cache_boundaries(),
        _raise_on_sql(sqlite_engine, "provider_model_credentials", "INSERT"),
        pytest.raises(RuntimeError, match="forced INSERT"),
    ):
        configuration.create_custom_model_credential(ModelType.LLM, "gpt-4o", {"api_key": "raw"}, "Main")
    assert sqlite_provider_session.scalar(select(ProviderModelCredential)) is None
    assert sqlite_provider_session.scalar(select(ProviderModel)) is None


def test_provider_update_rolls_back_on_update_failure(
    sqlite_provider_session: Session,
    sqlite_engine: Engine,
) -> None:
    configuration = _build_provider_configuration()
    credential = _provider_credential(
        sqlite_provider_session,
        name="Old",
        encrypted_config='{"api_key":"enc-old"}',
    )
    _provider_record(sqlite_provider_session, credential_id=credential.id)

    with (
        patch.object(ProviderConfiguration, "validate_provider_credentials", return_value={"api_key": "enc-new"}),
        _mock_cache_boundaries() as (credentials_cache, configuration_cache),
        _raise_on_sql(sqlite_engine, "provider_credentials", "UPDATE"),
        pytest.raises(RuntimeError, match="forced UPDATE"),
    ):
        configuration.update_provider_credential({"api_key": "raw"}, credential.id, "New")

    sqlite_provider_session.expire_all()
    persisted = sqlite_provider_session.get(ProviderCredential, credential.id)
    assert persisted is not None
    assert persisted.credential_name == "Old"
    assert json.loads(persisted.encrypted_config) == {"api_key": "enc-old"}
    credentials_cache.assert_not_called()
    configuration_cache.assert_not_called()


def test_provider_delete_rolls_back_on_delete_failure(
    sqlite_provider_session: Session,
    sqlite_engine: Engine,
) -> None:
    configuration = _build_provider_configuration()
    credential = _provider_credential(sqlite_provider_session)
    provider = _provider_record(sqlite_provider_session, credential_id=credential.id)

    with (
        _mock_cache_boundaries() as (credentials_cache, configuration_cache),
        _raise_on_sql(sqlite_engine, "provider_credentials", "DELETE"),
        pytest.raises(RuntimeError, match="forced DELETE"),
    ):
        configuration.delete_provider_credential(credential.id)

    sqlite_provider_session.expire_all()
    assert sqlite_provider_session.get(ProviderCredential, credential.id) is not None
    persisted_provider = sqlite_provider_session.get(Provider, provider.id)
    assert persisted_provider is not None
    assert persisted_provider.credential_id == credential.id
    credentials_cache.assert_called_once_with(
        tenant_id="tenant-1",
        identity_id=provider.id,
        cache_type=ProviderCredentialsCacheType.PROVIDER,
    )
    credentials_cache.return_value.delete.assert_called_once_with()
    configuration_cache.assert_not_called()


def test_provider_switch_rolls_back_on_update_failure(
    sqlite_provider_session: Session,
    sqlite_engine: Engine,
) -> None:
    configuration = _build_provider_configuration()
    first = _provider_credential(sqlite_provider_session, name="First")
    second = _provider_credential(sqlite_provider_session, name="Second")
    provider = _provider_record(sqlite_provider_session, credential_id=first.id)

    with (
        _mock_cache_boundaries() as (credentials_cache, configuration_cache),
        _raise_on_sql(sqlite_engine, "providers", "UPDATE"),
        pytest.raises(RuntimeError, match="forced UPDATE"),
    ):
        configuration.switch_active_provider_credential(second.id)

    sqlite_provider_session.expire_all()
    persisted_provider = sqlite_provider_session.get(Provider, provider.id)
    assert persisted_provider is not None
    assert persisted_provider.credential_id == first.id
    credentials_cache.assert_not_called()
    configuration_cache.assert_not_called()


def test_custom_model_update_rolls_back_on_update_failure(
    sqlite_provider_session: Session,
    sqlite_engine: Engine,
) -> None:
    configuration = _build_provider_configuration()
    credential = _model_credential(
        sqlite_provider_session,
        name="Old",
        encrypted_config='{"api_key":"enc-old"}',
    )
    _provider_model_record(sqlite_provider_session, credential_id=credential.id)

    with (
        patch.object(
            ProviderConfiguration,
            "validate_custom_model_credentials",
            return_value={"api_key": "enc-new"},
        ),
        _mock_cache_boundaries() as (credentials_cache, configuration_cache),
        _raise_on_sql(sqlite_engine, "provider_model_credentials", "UPDATE"),
        pytest.raises(RuntimeError, match="forced UPDATE"),
    ):
        configuration.update_custom_model_credential(
            ModelType.LLM,
            "gpt-4o",
            {"api_key": "raw"},
            "New",
            credential.id,
        )

    sqlite_provider_session.expire_all()
    persisted = sqlite_provider_session.get(ProviderModelCredential, credential.id)
    assert persisted is not None
    assert persisted.credential_name == "Old"
    assert json.loads(persisted.encrypted_config) == {"api_key": "enc-old"}
    credentials_cache.assert_not_called()
    configuration_cache.assert_not_called()


def test_custom_model_delete_rolls_back_on_delete_failure(
    sqlite_provider_session: Session,
    sqlite_engine: Engine,
) -> None:
    configuration = _build_provider_configuration()
    credential = _model_credential(sqlite_provider_session)
    model = _provider_model_record(sqlite_provider_session, credential_id=credential.id)

    with (
        _mock_cache_boundaries() as (credentials_cache, configuration_cache),
        _raise_on_sql(sqlite_engine, "provider_model_credentials", "DELETE"),
        pytest.raises(RuntimeError, match="forced DELETE"),
    ):
        configuration.delete_custom_model_credential(ModelType.LLM, "gpt-4o", credential.id)

    sqlite_provider_session.expire_all()
    assert sqlite_provider_session.get(ProviderModelCredential, credential.id) is not None
    persisted_model = sqlite_provider_session.get(ProviderModel, model.id)
    assert persisted_model is not None
    assert persisted_model.credential_id == credential.id
    credentials_cache.assert_called_once_with(
        tenant_id="tenant-1",
        identity_id=model.id,
        cache_type=ProviderCredentialsCacheType.MODEL,
    )
    credentials_cache.return_value.delete.assert_called_once_with()
    configuration_cache.assert_not_called()


def test_custom_model_switch_rolls_back_on_update_failure(
    sqlite_provider_session: Session,
    sqlite_engine: Engine,
) -> None:
    configuration = _build_provider_configuration()
    first = _model_credential(sqlite_provider_session, name="First")
    second = _model_credential(sqlite_provider_session, name="Second")
    model = _provider_model_record(sqlite_provider_session, credential_id=first.id)

    with (
        _mock_cache_boundaries() as (credentials_cache, configuration_cache),
        _raise_on_sql(sqlite_engine, "provider_models", "UPDATE"),
        pytest.raises(RuntimeError, match="forced UPDATE"),
    ):
        configuration.switch_custom_model_credential(ModelType.LLM, "gpt-4o", second.id)

    sqlite_provider_session.expire_all()
    persisted_model = sqlite_provider_session.get(ProviderModel, model.id)
    assert persisted_model is not None
    assert persisted_model.credential_id == first.id
    credentials_cache.assert_not_called()
    configuration_cache.assert_not_called()
