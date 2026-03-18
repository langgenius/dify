from __future__ import annotations

from contextlib import contextmanager
from types import SimpleNamespace
from typing import Any
from unittest.mock import Mock, patch

import pytest

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
from dify_graph.model_runtime.entities.common_entities import I18nObject
from dify_graph.model_runtime.entities.model_entities import AIModelEntity, FetchFrom, ModelType
from dify_graph.model_runtime.entities.provider_entities import (
    ConfigurateMethod,
    CredentialFormSchema,
    FieldModelSchema,
    FormType,
    ModelCredentialSchema,
    ProviderCredentialSchema,
    ProviderEntity,
)
from models.enums import CredentialSourceType
from models.provider import ProviderType
from models.provider_ids import ModelProviderID

_UNSET = object()


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


def _exec_result(
    *,
    scalar_one_or_none: Any = _UNSET,
    scalar: Any = _UNSET,
    scalars_all: Any = _UNSET,
    scalars_first: Any = _UNSET,
) -> Mock:
    result = Mock()
    if scalar_one_or_none is not _UNSET:
        result.scalar_one_or_none.return_value = scalar_one_or_none
    if scalar is not _UNSET:
        result.scalar.return_value = scalar
    if scalars_all is not _UNSET or scalars_first is not _UNSET:
        scalars = Mock()
        if scalars_all is not _UNSET:
            scalars.all.return_value = scalars_all
        if scalars_first is not _UNSET:
            scalars.first.return_value = scalars_first
        result.scalars.return_value = scalars
    return result


@contextmanager
def _patched_session(session: Mock):
    with patch("core.entities.provider_configuration.db") as mock_db:
        mock_db.engine = Mock()
        with patch("core.entities.provider_configuration.Session") as mock_session_cls:
            mock_session_cls.return_value.__enter__.return_value = session
            yield mock_session_cls


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


def test_generate_next_api_key_name_uses_highest_numeric_suffix() -> None:
    configuration = _build_provider_configuration()
    session = Mock()
    session.execute.return_value.scalars.return_value.all.return_value = [
        SimpleNamespace(credential_name="API KEY 9"),
        SimpleNamespace(credential_name="legacy"),
        SimpleNamespace(credential_name=" API KEY 2 "),
    ]

    name = configuration._generate_next_api_key_name(session=session, query_factory=lambda: Mock())
    assert name == "API KEY 10"


def test_generate_next_api_key_name_falls_back_to_default_on_error() -> None:
    configuration = _build_provider_configuration()
    session = Mock()

    def _raise_query_error():
        raise RuntimeError("boom")

    name = configuration._generate_next_api_key_name(session=session, query_factory=_raise_query_error)
    assert name == "API KEY 1"


def test_generate_provider_and_custom_model_names_delegate_to_shared_generator() -> None:
    configuration = _build_provider_configuration()

    with patch.object(configuration, "_generate_next_api_key_name", return_value="API KEY 7") as mock_generator:
        provider_name = configuration._generate_provider_credential_name(session=Mock())
        custom_model_name = configuration._generate_custom_model_credential_name(
            model="gpt-4o",
            model_type=ModelType.LLM,
            session=Mock(),
        )

    assert provider_name == "API KEY 7"
    assert custom_model_name == "API KEY 7"
    assert mock_generator.call_count == 2


def test_get_provider_credential_uses_specific_lookup_when_id_provided() -> None:
    configuration = _build_provider_configuration()

    with patch.object(configuration, "_get_specific_provider_credential", return_value={"api_key": "***"}) as mock_get:
        credential = configuration.get_provider_credential("credential-1")

    assert credential == {"api_key": "***"}
    mock_get.assert_called_once_with("credential-1")


def test_validate_provider_credentials_handles_hidden_secret_value() -> None:
    configuration = _build_provider_configuration()
    configuration.provider.provider_credential_schema = ProviderCredentialSchema(
        credential_form_schemas=[
            CredentialFormSchema(
                variable="openai_api_key",
                label=I18nObject(en_US="API Key"),
                type=FormType.SECRET_INPUT,
            )
        ]
    )
    session = Mock()
    session.execute.return_value.scalar_one_or_none.return_value = SimpleNamespace(encrypted_config="encrypted-old-key")
    mock_factory = Mock()
    mock_factory.provider_credentials_validate.return_value = {"openai_api_key": "restored-key", "region": "us"}

    with patch("core.entities.provider_configuration.ModelProviderFactory", return_value=mock_factory):
        with patch("core.entities.provider_configuration.encrypter.decrypt_token", return_value="restored-key"):
            with patch(
                "core.entities.provider_configuration.encrypter.encrypt_token",
                side_effect=lambda tenant_id, value: f"enc::{value}",
            ):
                validated = configuration.validate_provider_credentials(
                    credentials={"openai_api_key": HIDDEN_VALUE, "region": "us"},
                    credential_id="credential-1",
                    session=session,
                )

    assert validated["openai_api_key"] == "enc::restored-key"
    assert validated["region"] == "us"
    mock_factory.provider_credentials_validate.assert_called_once_with(
        provider="openai",
        credentials={"openai_api_key": "restored-key", "region": "us"},
    )


def test_validate_provider_credentials_opens_session_when_not_passed() -> None:
    configuration = _build_provider_configuration()
    mock_session = Mock()
    mock_factory = Mock()
    mock_factory.provider_credentials_validate.return_value = {"region": "us"}

    with patch("core.entities.provider_configuration.Session") as mock_session_cls:
        with patch("core.entities.provider_configuration.db") as mock_db:
            mock_db.engine = Mock()
            mock_session_cls.return_value.__enter__.return_value = mock_session
            with patch("core.entities.provider_configuration.ModelProviderFactory", return_value=mock_factory):
                validated = configuration.validate_provider_credentials(credentials={"region": "us"})

    assert validated == {"region": "us"}
    mock_session_cls.assert_called_once()


def test_switch_preferred_provider_type_returns_early_when_no_change_or_unsupported() -> None:
    configuration = _build_provider_configuration()

    with patch("core.entities.provider_configuration.Session") as mock_session_cls:
        configuration.switch_preferred_provider_type(ProviderType.SYSTEM)
    mock_session_cls.assert_not_called()

    configuration.preferred_provider_type = ProviderType.CUSTOM
    configuration.system_configuration.enabled = False
    with patch("core.entities.provider_configuration.Session") as mock_session_cls:
        configuration.switch_preferred_provider_type(ProviderType.SYSTEM)
    mock_session_cls.assert_not_called()


def test_switch_preferred_provider_type_updates_existing_record_with_session() -> None:
    configuration = _build_provider_configuration()
    configuration.preferred_provider_type = ProviderType.CUSTOM
    session = Mock()
    existing_record = SimpleNamespace(preferred_provider_type="custom")
    session.execute.return_value.scalars.return_value.first.return_value = existing_record

    configuration.switch_preferred_provider_type(ProviderType.SYSTEM, session=session)

    assert existing_record.preferred_provider_type == ProviderType.SYSTEM
    session.commit.assert_called_once()


def test_switch_preferred_provider_type_creates_record_when_missing() -> None:
    configuration = _build_provider_configuration()
    configuration.preferred_provider_type = ProviderType.SYSTEM
    session = Mock()
    session.execute.return_value.scalars.return_value.first.return_value = None

    configuration.switch_preferred_provider_type(ProviderType.CUSTOM, session=session)

    assert session.add.call_count == 1
    session.commit.assert_called_once()


def test_get_model_type_instance_and_schema_delegate_to_factory() -> None:
    configuration = _build_provider_configuration()
    mock_factory = Mock()
    mock_model_type_instance = Mock()
    mock_schema = _build_ai_model("gpt-4o")
    mock_factory.get_model_type_instance.return_value = mock_model_type_instance
    mock_factory.get_model_schema.return_value = mock_schema

    with patch("core.entities.provider_configuration.ModelProviderFactory", return_value=mock_factory):
        model_type_instance = configuration.get_model_type_instance(ModelType.LLM)
        model_schema = configuration.get_model_schema(ModelType.LLM, "gpt-4o", {"api_key": "x"})

    assert model_type_instance is mock_model_type_instance
    assert model_schema is mock_schema
    mock_factory.get_model_type_instance.assert_called_once_with(provider="openai", model_type=ModelType.LLM)
    mock_factory.get_model_schema.assert_called_once_with(
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

    with patch("core.entities.provider_configuration.ModelProviderFactory", return_value=mock_factory):
        all_models = configuration.get_provider_models(model_type=ModelType.LLM, only_active=False)
        active_models = configuration.get_provider_models(model_type=ModelType.LLM, only_active=True)

    assert [model.model for model in all_models] == ["b-model", "a-model"]
    assert [model.status for model in all_models] == [ModelStatus.ACTIVE, ModelStatus.DISABLED]
    assert [model.model for model in active_models] == ["b-model"]


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


def test_custom_configuration_availability_and_provider_record_helpers() -> None:
    configuration = _build_provider_configuration()
    assert not configuration.is_custom_configuration_available()

    configuration.custom_configuration.provider = CustomProviderConfiguration(
        credentials={"api_key": "provider-key"},
        available_credentials=[CredentialConfiguration(credential_id="cred-1", credential_name="Main")],
    )
    assert configuration.is_custom_configuration_available()

    configuration.custom_configuration.provider = None
    configuration.custom_configuration.models = [
        CustomModelConfiguration(model="gpt-4o", model_type=ModelType.LLM, credentials={"api_key": "model-key"})
    ]
    assert configuration.is_custom_configuration_available()

    session = Mock()
    provider_record = SimpleNamespace(id="provider-1")
    session.execute.return_value.scalar_one_or_none.return_value = provider_record
    assert configuration._get_provider_record(session) is provider_record

    session.execute.return_value.scalar_one_or_none.return_value = None
    assert configuration._get_provider_record(session) is None


def test_check_provider_credential_name_exists_and_model_setting_lookup() -> None:
    configuration = _build_provider_configuration()
    session = Mock()
    session.execute.return_value.scalar_one_or_none.return_value = "existing-id"
    assert configuration._check_provider_credential_name_exists("Main", session)

    session.execute.return_value.scalar_one_or_none.return_value = None
    assert not configuration._check_provider_credential_name_exists("Main", session, exclude_id="cred-2")

    setting = SimpleNamespace(id="setting-1")
    session.execute.return_value.scalars.return_value.first.return_value = setting
    assert configuration._get_provider_model_setting(ModelType.LLM, "gpt-4o", session) is setting


def test_validate_provider_credentials_handles_invalid_original_json() -> None:
    configuration = _build_provider_configuration()
    configuration.provider.provider_credential_schema = _build_secret_provider_schema()
    session = Mock()
    session.execute.return_value.scalar_one_or_none.return_value = SimpleNamespace(encrypted_config="{invalid-json")
    mock_factory = Mock()
    mock_factory.provider_credentials_validate.return_value = {"openai_api_key": "new-key"}

    with patch("core.entities.provider_configuration.ModelProviderFactory", return_value=mock_factory):
        with patch("core.entities.provider_configuration.encrypter.encrypt_token", return_value="enc-key"):
            validated = configuration.validate_provider_credentials(
                credentials={"openai_api_key": HIDDEN_VALUE},
                credential_id="cred-1",
                session=session,
            )

    assert validated == {"openai_api_key": "enc-key"}


def test_generate_next_api_key_name_returns_default_when_no_records() -> None:
    configuration = _build_provider_configuration()
    session = Mock()
    session.execute.return_value.scalars.return_value.all.return_value = []

    name = configuration._generate_next_api_key_name(session=session, query_factory=lambda: Mock())
    assert name == "API KEY 1"


def test_create_provider_credential_creates_provider_record_when_missing() -> None:
    configuration = _build_provider_configuration()
    session = Mock()
    session.flush.side_effect = lambda: None

    with _patched_session(session):
        with patch.object(ProviderConfiguration, "validate_provider_credentials", return_value={"api_key": "enc"}):
            with patch.object(ProviderConfiguration, "_get_provider_record", return_value=None):
                with patch.object(
                    ProviderConfiguration,
                    "_generate_provider_credential_name",
                    return_value="API KEY 2",
                ):
                    with patch.object(ProviderConfiguration, "switch_preferred_provider_type") as mock_switch:
                        with patch("core.entities.provider_configuration.ProviderCredentialsCache") as mock_cache:
                            configuration.create_provider_credential({"api_key": "raw"}, None)

    assert session.add.call_count == 2
    session.commit.assert_called_once()
    mock_cache.return_value.delete.assert_called_once()
    mock_switch.assert_called_once_with(provider_type=ProviderType.CUSTOM, session=session)


def test_create_provider_credential_marks_existing_provider_as_valid() -> None:
    configuration = _build_provider_configuration()
    session = Mock()
    provider_record = SimpleNamespace(id="provider-1", is_valid=False, credential_id="existing-cred")

    with _patched_session(session):
        with patch.object(ProviderConfiguration, "_check_provider_credential_name_exists", return_value=False):
            with patch.object(ProviderConfiguration, "validate_provider_credentials", return_value={"api_key": "enc"}):
                with patch.object(ProviderConfiguration, "_get_provider_record", return_value=provider_record):
                    configuration.create_provider_credential({"api_key": "raw"}, "Main")

    assert provider_record.is_valid is True
    assert provider_record.credential_id == "existing-cred"
    session.commit.assert_called_once()


def test_create_provider_credential_auto_activates_when_no_active_credential() -> None:
    configuration = _build_provider_configuration()
    session = Mock()
    provider_record = SimpleNamespace(id="provider-1", is_valid=False, credential_id=None, updated_at=None)

    with _patched_session(session):
        with patch.object(ProviderConfiguration, "_check_provider_credential_name_exists", return_value=False):
            with patch.object(ProviderConfiguration, "validate_provider_credentials", return_value={"api_key": "enc"}):
                with patch.object(ProviderConfiguration, "_get_provider_record", return_value=provider_record):
                    with patch("core.entities.provider_configuration.ProviderCredentialsCache"):
                        with patch.object(ProviderConfiguration, "switch_preferred_provider_type"):
                            configuration.create_provider_credential({"api_key": "raw"}, "Main")

    assert provider_record.is_valid is True
    assert provider_record.credential_id is not None
    session.commit.assert_called_once()


def test_create_provider_credential_raises_when_duplicate_name_exists() -> None:
    configuration = _build_provider_configuration()
    session = Mock()

    with _patched_session(session):
        with patch.object(ProviderConfiguration, "_check_provider_credential_name_exists", return_value=True):
            with pytest.raises(ValueError, match="already exists"):
                configuration.create_provider_credential({"api_key": "raw"}, "Main")


def test_update_provider_credential_success_updates_and_invalidates_cache() -> None:
    configuration = _build_provider_configuration()
    session = Mock()
    credential_record = SimpleNamespace(id="cred-1", encrypted_config="{}", credential_name="Old", updated_at=None)
    provider_record = SimpleNamespace(id="provider-1", credential_id="cred-1")
    session.execute.return_value.scalar_one_or_none.return_value = credential_record

    with _patched_session(session):
        with patch.object(ProviderConfiguration, "_check_provider_credential_name_exists", return_value=False):
            with patch.object(ProviderConfiguration, "validate_provider_credentials", return_value={"api_key": "enc"}):
                with patch.object(ProviderConfiguration, "_get_provider_record", return_value=provider_record):
                    with patch.object(
                        ProviderConfiguration,
                        "_update_load_balancing_configs_with_credential",
                    ) as mock_lb:
                        with patch("core.entities.provider_configuration.ProviderCredentialsCache") as mock_cache:
                            configuration.update_provider_credential(
                                credentials={"api_key": "raw"},
                                credential_id="cred-1",
                                credential_name="New Name",
                            )

    assert credential_record.credential_name == "New Name"
    session.commit.assert_called_once()
    mock_cache.return_value.delete.assert_called_once()
    mock_lb.assert_called_once()


def test_update_provider_credential_raises_when_record_not_found() -> None:
    configuration = _build_provider_configuration()
    session = Mock()
    session.execute.return_value.scalar_one_or_none.return_value = None

    with _patched_session(session):
        with patch.object(ProviderConfiguration, "validate_provider_credentials", return_value={"api_key": "enc"}):
            with patch.object(ProviderConfiguration, "_get_provider_record", return_value=None):
                with pytest.raises(ValueError, match="Credential record not found"):
                    configuration.update_provider_credential({"api_key": "raw"}, "cred-1", None)


def test_update_load_balancing_configs_updates_all_matching_configs() -> None:
    configuration = _build_provider_configuration()
    session = Mock()
    lb_config = SimpleNamespace(id="lb-1", encrypted_config="old", name="old", updated_at=None)
    session.execute.return_value.scalars.return_value.all.return_value = [lb_config]
    credential_record = SimpleNamespace(encrypted_config='{"api_key":"enc"}', credential_name="API KEY 3")

    with patch("core.entities.provider_configuration.ProviderCredentialsCache") as mock_cache:
        configuration._update_load_balancing_configs_with_credential(
            credential_id="cred-1",
            credential_record=credential_record,
            credential_source=CredentialSourceType.PROVIDER,
            session=session,
        )

    assert lb_config.encrypted_config == '{"api_key":"enc"}'
    assert lb_config.name == "API KEY 3"
    mock_cache.return_value.delete.assert_called_once()
    session.commit.assert_called_once()


def test_update_load_balancing_configs_returns_when_no_matching_configs() -> None:
    configuration = _build_provider_configuration()
    session = Mock()
    session.execute.return_value.scalars.return_value.all.return_value = []

    configuration._update_load_balancing_configs_with_credential(
        credential_id="cred-1",
        credential_record=SimpleNamespace(encrypted_config="{}", credential_name="Main"),
        credential_source=CredentialSourceType.PROVIDER,
        session=session,
    )

    session.commit.assert_not_called()


def test_delete_provider_credential_removes_provider_record_when_last_credential() -> None:
    configuration = _build_provider_configuration()
    session = Mock()
    credential_record = SimpleNamespace(id="cred-1")
    provider_record = SimpleNamespace(id="provider-1", credential_id="cred-1", updated_at=None)
    session.execute.side_effect = [
        _exec_result(scalar_one_or_none=credential_record),
        _exec_result(scalars_all=[]),
        _exec_result(scalar=1),
    ]

    with _patched_session(session):
        with patch.object(ProviderConfiguration, "_get_provider_record", return_value=provider_record):
            with patch.object(ProviderConfiguration, "switch_preferred_provider_type") as mock_switch:
                with patch("core.entities.provider_configuration.ProviderCredentialsCache") as mock_cache:
                    configuration.delete_provider_credential("cred-1")

    assert any(call.args and call.args[0] is provider_record for call in session.delete.call_args_list)
    mock_cache.return_value.delete.assert_called_once()
    mock_switch.assert_called_once_with(provider_type=ProviderType.SYSTEM, session=session)


def test_delete_provider_credential_raises_when_not_found() -> None:
    configuration = _build_provider_configuration()
    session = Mock()
    session.execute.return_value.scalar_one_or_none.return_value = None

    with _patched_session(session):
        with pytest.raises(ValueError, match="Credential record not found"):
            configuration.delete_provider_credential("cred-1")


def test_delete_provider_credential_unsets_active_credential_when_more_available() -> None:
    configuration = _build_provider_configuration()
    session = Mock()
    credential_record = SimpleNamespace(id="cred-1")
    lb_config = SimpleNamespace(id="lb-1")
    provider_record = SimpleNamespace(id="provider-1", credential_id="cred-1", updated_at=None)
    session.execute.side_effect = [
        _exec_result(scalar_one_or_none=credential_record),
        _exec_result(scalars_all=[lb_config]),
        _exec_result(scalar=2),
    ]

    with _patched_session(session):
        with patch.object(ProviderConfiguration, "_get_provider_record", return_value=provider_record):
            with patch.object(ProviderConfiguration, "switch_preferred_provider_type") as mock_switch:
                with patch("core.entities.provider_configuration.ProviderCredentialsCache") as mock_cache:
                    configuration.delete_provider_credential("cred-1")

    assert provider_record.credential_id is None
    assert mock_cache.return_value.delete.call_count == 2
    mock_switch.assert_called_once_with(provider_type=ProviderType.SYSTEM, session=session)


def test_switch_active_provider_credential_success_and_failures() -> None:
    configuration = _build_provider_configuration()
    session = Mock()
    session.execute.return_value.scalar_one_or_none.return_value = None
    with _patched_session(session):
        with pytest.raises(ValueError, match="Credential record not found"):
            configuration.switch_active_provider_credential("cred-1")

    session = Mock()
    session.execute.return_value.scalar_one_or_none.return_value = SimpleNamespace(id="cred-1")
    with _patched_session(session):
        with patch.object(ProviderConfiguration, "_get_provider_record", return_value=None):
            with pytest.raises(ValueError, match="Provider record not found"):
                configuration.switch_active_provider_credential("cred-1")

    session = Mock()
    credential_record = SimpleNamespace(id="cred-1")
    provider_record = SimpleNamespace(id="provider-1", credential_id=None, updated_at=None)
    session.execute.return_value.scalar_one_or_none.return_value = credential_record
    with _patched_session(session):
        with patch.object(ProviderConfiguration, "_get_provider_record", return_value=provider_record):
            with patch.object(ProviderConfiguration, "switch_preferred_provider_type") as mock_switch:
                with patch("core.entities.provider_configuration.ProviderCredentialsCache") as mock_cache:
                    configuration.switch_active_provider_credential("cred-1")

    assert provider_record.credential_id == "cred-1"
    mock_cache.return_value.delete.assert_called_once()
    mock_switch.assert_called_once_with(ProviderType.CUSTOM, session=session)


def test_get_custom_model_record_supports_plugin_id_alias() -> None:
    configuration = _build_provider_configuration(provider_name="langgenius/openai/openai")
    session = Mock()
    custom_model_record = SimpleNamespace(id="model-1")
    session.execute.return_value.scalar_one_or_none.return_value = custom_model_record

    result = configuration._get_custom_model_record(ModelType.LLM, "gpt-4o", session)
    assert result is custom_model_record


def test_get_specific_custom_model_credential_success_and_not_found() -> None:
    configuration = _build_provider_configuration()
    configuration.provider.model_credential_schema = _build_secret_model_schema()
    session = Mock()
    record = SimpleNamespace(id="cred-1", credential_name="Main", encrypted_config='{"openai_api_key":"enc"}')
    session.execute.return_value.scalar_one_or_none.return_value = record

    with _patched_session(session):
        with patch("core.entities.provider_configuration.encrypter.decrypt_token", return_value="raw"):
            with patch.object(ProviderConfiguration, "obfuscated_credentials", return_value={"openai_api_key": "***"}):
                response = configuration._get_specific_custom_model_credential(ModelType.LLM, "gpt-4o", "cred-1")

    assert response["current_credential_id"] == "cred-1"
    assert response["credentials"] == {"openai_api_key": "***"}

    session = Mock()
    session.execute.return_value.scalar_one_or_none.return_value = None
    with _patched_session(session):
        with pytest.raises(ValueError, match="Credential with id cred-1 not found"):
            configuration._get_specific_custom_model_credential(ModelType.LLM, "gpt-4o", "cred-1")

    session = Mock()
    session.execute.return_value.scalar_one_or_none.return_value = SimpleNamespace(
        id="cred-1",
        credential_name="Main",
        encrypted_config="{invalid-json",
    )
    with _patched_session(session):
        invalid_json = configuration._get_specific_custom_model_credential(ModelType.LLM, "gpt-4o", "cred-1")
    assert invalid_json["credentials"] == {}


def test_check_custom_model_credential_name_exists_respects_exclusion() -> None:
    configuration = _build_provider_configuration()
    session = Mock()
    session.execute.return_value.scalar_one_or_none.return_value = SimpleNamespace(id="cred-1")
    assert configuration._check_custom_model_credential_name_exists(
        ModelType.LLM, "gpt-4o", "Main", session, exclude_id="other-id"
    )

    session.execute.return_value.scalar_one_or_none.return_value = None
    assert not configuration._check_custom_model_credential_name_exists(ModelType.LLM, "gpt-4o", "Main", session)


def test_get_custom_model_credential_uses_specific_id_or_configuration_fallback() -> None:
    configuration = _build_provider_configuration()
    with patch.object(
        ProviderConfiguration,
        "_get_specific_custom_model_credential",
        return_value={"current_credential_id": "cred-1"},
    ) as mock_specific:
        result = configuration.get_custom_model_credential(ModelType.LLM, "gpt-4o", "cred-1")
    assert result == {"current_credential_id": "cred-1"}
    mock_specific.assert_called_once()

    configuration.provider.model_credential_schema = _build_secret_model_schema()
    configuration.custom_configuration.models = [
        CustomModelConfiguration(
            model="gpt-4o",
            model_type=ModelType.LLM,
            credentials={"openai_api_key": "raw"},
            current_credential_id="cred-1",
            current_credential_name="Main",
        )
    ]
    with patch.object(ProviderConfiguration, "obfuscated_credentials", return_value={"openai_api_key": "***"}):
        fallback = configuration.get_custom_model_credential(ModelType.LLM, "gpt-4o", None)
    assert fallback == {
        "current_credential_id": "cred-1",
        "current_credential_name": "Main",
        "credentials": {"openai_api_key": "***"},
    }

    configuration.custom_configuration.models = []
    assert configuration.get_custom_model_credential(ModelType.LLM, "gpt-4o", None) is None


def test_validate_custom_model_credentials_supports_hidden_reuse_and_sessionless_path() -> None:
    configuration = _build_provider_configuration()
    configuration.provider.model_credential_schema = _build_secret_model_schema()
    session = Mock()
    session.execute.return_value.scalar_one_or_none.return_value = SimpleNamespace(
        encrypted_config='{"openai_api_key":"enc"}'
    )
    mock_factory = Mock()
    mock_factory.model_credentials_validate.return_value = {"openai_api_key": "raw"}

    with patch("core.entities.provider_configuration.ModelProviderFactory", return_value=mock_factory):
        with patch("core.entities.provider_configuration.encrypter.decrypt_token", return_value="raw"):
            with patch("core.entities.provider_configuration.encrypter.encrypt_token", return_value="enc-new"):
                validated = configuration.validate_custom_model_credentials(
                    model_type=ModelType.LLM,
                    model="gpt-4o",
                    credentials={"openai_api_key": HIDDEN_VALUE},
                    credential_id="cred-1",
                    session=session,
                )
    assert validated == {"openai_api_key": "enc-new"}

    session = Mock()
    mock_factory = Mock()
    mock_factory.model_credentials_validate.return_value = {"region": "us"}
    with _patched_session(session):
        with patch("core.entities.provider_configuration.ModelProviderFactory", return_value=mock_factory):
            validated = configuration.validate_custom_model_credentials(
                model_type=ModelType.LLM,
                model="gpt-4o",
                credentials={"region": "us"},
            )
    assert validated == {"region": "us"}


def test_create_update_delete_custom_model_credential_flow() -> None:
    configuration = _build_provider_configuration()
    session = Mock()
    session.flush.side_effect = lambda: None
    provider_model_record = SimpleNamespace(id="model-1", credential_id="cred-1", updated_at=None)
    credential_record = SimpleNamespace(id="cred-1", encrypted_config="{}", credential_name="Old", updated_at=None)

    with _patched_session(session):
        with patch.object(ProviderConfiguration, "_generate_custom_model_credential_name", return_value="API KEY 1"):
            with patch.object(
                ProviderConfiguration,
                "validate_custom_model_credentials",
                return_value={"openai_api_key": "enc"},
            ):
                with patch.object(ProviderConfiguration, "_get_custom_model_record", return_value=None):
                    with patch("core.entities.provider_configuration.ProviderCredentialsCache") as mock_cache:
                        configuration.create_custom_model_credential(ModelType.LLM, "gpt-4o", {"k": "v"}, None)
    assert session.add.call_count == 2
    assert mock_cache.return_value.delete.call_count == 1

    session = Mock()
    session.execute.return_value.scalar_one_or_none.return_value = credential_record
    with _patched_session(session):
        with patch.object(ProviderConfiguration, "_check_custom_model_credential_name_exists", return_value=False):
            with patch.object(
                ProviderConfiguration,
                "validate_custom_model_credentials",
                return_value={"openai_api_key": "enc2"},
            ):
                with patch.object(
                    ProviderConfiguration,
                    "_get_custom_model_record",
                    return_value=provider_model_record,
                ):
                    with patch.object(
                        ProviderConfiguration,
                        "_update_load_balancing_configs_with_credential",
                    ) as mock_lb:
                        with patch("core.entities.provider_configuration.ProviderCredentialsCache") as mock_cache:
                            configuration.update_custom_model_credential(
                                model_type=ModelType.LLM,
                                model="gpt-4o",
                                credentials={"k": "v"},
                                credential_name="New Name",
                                credential_id="cred-1",
                            )
    assert credential_record.credential_name == "New Name"
    assert mock_cache.return_value.delete.call_count == 1
    mock_lb.assert_called_once()

    session = Mock()
    credential_record = SimpleNamespace(id="cred-1")
    lb_config = SimpleNamespace(id="lb-1")
    provider_model_record = SimpleNamespace(id="model-1", credential_id="cred-1", updated_at=None)
    session.execute.side_effect = [
        _exec_result(scalar_one_or_none=credential_record),
        _exec_result(scalars_all=[lb_config]),
        _exec_result(scalar=2),
    ]
    with _patched_session(session):
        with patch.object(ProviderConfiguration, "_get_custom_model_record", return_value=provider_model_record):
            with patch("core.entities.provider_configuration.ProviderCredentialsCache") as mock_cache:
                configuration.delete_custom_model_credential(ModelType.LLM, "gpt-4o", "cred-1")
    assert provider_model_record.credential_id is None
    assert mock_cache.return_value.delete.call_count == 2


def test_add_model_credential_to_model_and_switch_custom_model_credential() -> None:
    configuration = _build_provider_configuration()
    session = Mock()
    session.execute.return_value.scalar_one_or_none.return_value = None
    with _patched_session(session):
        with pytest.raises(ValueError, match="Credential record not found"):
            configuration.add_model_credential_to_model(ModelType.LLM, "gpt-4o", "cred-1")

    session = Mock()
    credential_record = SimpleNamespace(id="cred-1")
    session.execute.return_value.scalar_one_or_none.return_value = credential_record
    with _patched_session(session):
        with patch.object(ProviderConfiguration, "_get_custom_model_record", return_value=None):
            configuration.add_model_credential_to_model(ModelType.LLM, "gpt-4o", "cred-1")
    session.add.assert_called_once()
    session.commit.assert_called_once()

    session = Mock()
    credential_record = SimpleNamespace(id="cred-1")
    provider_model_record = SimpleNamespace(id="model-1", credential_id="cred-1", updated_at=None)
    session.execute.return_value.scalar_one_or_none.return_value = credential_record
    with _patched_session(session):
        with patch.object(ProviderConfiguration, "_get_custom_model_record", return_value=provider_model_record):
            with pytest.raises(ValueError, match="Can't add same credential"):
                configuration.add_model_credential_to_model(ModelType.LLM, "gpt-4o", "cred-1")

    session = Mock()
    credential_record = SimpleNamespace(id="cred-2")
    provider_model_record = SimpleNamespace(id="model-1", credential_id="cred-1", updated_at=None)
    session.execute.return_value.scalar_one_or_none.return_value = credential_record
    with _patched_session(session):
        with patch.object(ProviderConfiguration, "_get_custom_model_record", return_value=provider_model_record):
            with patch("core.entities.provider_configuration.ProviderCredentialsCache") as mock_cache:
                configuration.add_model_credential_to_model(ModelType.LLM, "gpt-4o", "cred-2")
    assert provider_model_record.credential_id == "cred-2"
    mock_cache.return_value.delete.assert_called_once()

    session = Mock()
    session.execute.return_value.scalar_one_or_none.return_value = None
    with _patched_session(session):
        with pytest.raises(ValueError, match="Credential record not found"):
            configuration.switch_custom_model_credential(ModelType.LLM, "gpt-4o", "cred-1")

    session = Mock()
    credential_record = SimpleNamespace(id="cred-1")
    session.execute.return_value.scalar_one_or_none.return_value = credential_record
    with _patched_session(session):
        with patch.object(ProviderConfiguration, "_get_custom_model_record", return_value=None):
            with pytest.raises(ValueError, match="custom model record not found"):
                configuration.switch_custom_model_credential(ModelType.LLM, "gpt-4o", "cred-1")

    session = Mock()
    credential_record = SimpleNamespace(id="cred-1")
    provider_model_record = SimpleNamespace(id="model-1", credential_id=None, updated_at=None)
    session.execute.return_value.scalar_one_or_none.return_value = credential_record
    with _patched_session(session):
        with patch.object(ProviderConfiguration, "_get_custom_model_record", return_value=provider_model_record):
            with patch("core.entities.provider_configuration.ProviderCredentialsCache") as mock_cache:
                configuration.switch_custom_model_credential(ModelType.LLM, "gpt-4o", "cred-1")
    assert provider_model_record.credential_id == "cred-1"
    mock_cache.return_value.delete.assert_called_once()


def test_delete_custom_model_and_model_setting_methods() -> None:
    configuration = _build_provider_configuration()
    session = Mock()
    provider_model_record = SimpleNamespace(id="model-1")
    with _patched_session(session):
        with patch.object(ProviderConfiguration, "_get_custom_model_record", return_value=provider_model_record):
            with patch("core.entities.provider_configuration.ProviderCredentialsCache") as mock_cache:
                configuration.delete_custom_model(ModelType.LLM, "gpt-4o")
    session.delete.assert_called_once_with(provider_model_record)
    session.commit.assert_called_once()
    mock_cache.return_value.delete.assert_called_once()

    session = Mock()
    existing = SimpleNamespace(enabled=False, updated_at=None)
    with _patched_session(session):
        with patch.object(ProviderConfiguration, "_get_provider_model_setting", return_value=existing):
            assert configuration.enable_model(ModelType.LLM, "gpt-4o") is existing
    assert existing.enabled is True

    session = Mock()
    with _patched_session(session):
        with patch.object(ProviderConfiguration, "_get_provider_model_setting", return_value=None):
            created = configuration.enable_model(ModelType.LLM, "gpt-4o")
    assert created.enabled is True

    session = Mock()
    existing = SimpleNamespace(enabled=True, load_balancing_enabled=True, updated_at=None)
    with _patched_session(session):
        with patch.object(ProviderConfiguration, "_get_provider_model_setting", return_value=existing):
            assert configuration.disable_model(ModelType.LLM, "gpt-4o") is existing
    assert existing.enabled is False

    session = Mock()
    with _patched_session(session):
        with patch.object(ProviderConfiguration, "_get_provider_model_setting", return_value=None):
            created = configuration.disable_model(ModelType.LLM, "gpt-4o")
    assert created.enabled is False

    session = Mock()
    with _patched_session(session):
        with patch.object(ProviderConfiguration, "_get_provider_model_setting", return_value=existing):
            result = configuration.get_provider_model_setting(ModelType.LLM, "gpt-4o")
    assert result is existing


def test_model_load_balancing_enable_disable_and_switch_preferred_provider_type_without_session() -> None:
    configuration = _build_provider_configuration()
    session = Mock()
    session.execute.return_value.scalar.return_value = 1
    with _patched_session(session):
        with pytest.raises(ValueError, match="must be more than 1"):
            configuration.enable_model_load_balancing(ModelType.LLM, "gpt-4o")

    session = Mock()
    session.execute.return_value.scalar.return_value = 2
    existing = SimpleNamespace(load_balancing_enabled=False, updated_at=None)
    with _patched_session(session):
        with patch.object(ProviderConfiguration, "_get_provider_model_setting", return_value=existing):
            result = configuration.enable_model_load_balancing(ModelType.LLM, "gpt-4o")
    assert result is existing
    assert existing.load_balancing_enabled is True

    session = Mock()
    session.execute.return_value.scalar.return_value = 2
    with _patched_session(session):
        with patch.object(ProviderConfiguration, "_get_provider_model_setting", return_value=None):
            created = configuration.enable_model_load_balancing(ModelType.LLM, "gpt-4o")
    assert created.load_balancing_enabled is True

    session = Mock()
    existing = SimpleNamespace(load_balancing_enabled=True, updated_at=None)
    with _patched_session(session):
        with patch.object(ProviderConfiguration, "_get_provider_model_setting", return_value=existing):
            result = configuration.disable_model_load_balancing(ModelType.LLM, "gpt-4o")
    assert result is existing
    assert existing.load_balancing_enabled is False

    session = Mock()
    with _patched_session(session):
        with patch.object(ProviderConfiguration, "_get_provider_model_setting", return_value=None):
            created = configuration.disable_model_load_balancing(ModelType.LLM, "gpt-4o")
    assert created.load_balancing_enabled is False

    configuration.preferred_provider_type = ProviderType.SYSTEM
    switch_session = Mock()
    with _patched_session(switch_session):
        switch_session.execute.return_value.scalars.return_value.first.return_value = None
        configuration.switch_preferred_provider_type(ProviderType.CUSTOM)
    assert any(
        call.args and call.args[0].__class__.__name__ == "TenantPreferredModelProvider"
        for call in switch_session.add.call_args_list
    )
    switch_session.commit.assert_called()


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

    with patch(
        "core.entities.provider_configuration.original_provider_configurate_methods",
        {"openai": [ConfigurateMethod.CUSTOMIZABLE_MODEL]},
    ):
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


def test_get_specific_provider_credential_decrypts_and_obfuscates_credentials() -> None:
    configuration = _build_provider_configuration()
    configuration.provider.provider_credential_schema = _build_secret_provider_schema()
    session = Mock()
    session.execute.return_value.scalar_one_or_none.return_value = SimpleNamespace(
        encrypted_config='{"openai_api_key":"enc-secret","region":"us"}'
    )
    provider_record = SimpleNamespace(provider_name="aliased-openai")

    with _patched_session(session):
        with patch.object(ProviderConfiguration, "_get_provider_record", return_value=provider_record):
            with patch("core.entities.provider_configuration.encrypter.decrypt_token", return_value="raw-secret"):
                with patch.object(
                    ProviderConfiguration,
                    "obfuscated_credentials",
                    side_effect=lambda credentials, credential_form_schemas: credentials,
                ):
                    credentials = configuration._get_specific_provider_credential("cred-1")

    assert credentials == {"openai_api_key": "raw-secret", "region": "us"}


def test_get_specific_provider_credential_logs_when_decrypt_fails() -> None:
    configuration = _build_provider_configuration()
    configuration.provider.provider_credential_schema = _build_secret_provider_schema()
    session = Mock()
    session.execute.return_value.scalar_one_or_none.return_value = SimpleNamespace(
        encrypted_config='{"openai_api_key":"enc-secret"}'
    )

    with _patched_session(session):
        with patch.object(ProviderConfiguration, "_get_provider_record", return_value=None):
            with patch(
                "core.entities.provider_configuration.encrypter.decrypt_token",
                side_effect=RuntimeError("boom"),
            ):
                with patch("core.entities.provider_configuration.logger.exception") as mock_logger:
                    with patch.object(
                        ProviderConfiguration,
                        "obfuscated_credentials",
                        side_effect=lambda credentials, credential_form_schemas: credentials,
                    ):
                        credentials = configuration._get_specific_provider_credential("cred-1")

    assert credentials == {"openai_api_key": "enc-secret"}
    mock_logger.assert_called_once()


def test_validate_provider_credentials_uses_empty_original_when_record_missing() -> None:
    configuration = _build_provider_configuration()
    configuration.provider.provider_credential_schema = _build_secret_provider_schema()
    session = Mock()
    session.execute.return_value.scalar_one_or_none.return_value = None
    mock_factory = Mock()
    mock_factory.provider_credentials_validate.return_value = {"openai_api_key": "raw"}

    with patch("core.entities.provider_configuration.ModelProviderFactory", return_value=mock_factory):
        with patch("core.entities.provider_configuration.encrypter.encrypt_token", return_value="enc-new"):
            validated = configuration.validate_provider_credentials(
                credentials={"openai_api_key": HIDDEN_VALUE},
                credential_id="cred-1",
                session=session,
            )

    assert validated == {"openai_api_key": "enc-new"}


def test_create_provider_credential_rolls_back_on_error() -> None:
    configuration = _build_provider_configuration()
    session = Mock()
    session.add.side_effect = RuntimeError("boom")

    with _patched_session(session):
        with patch.object(ProviderConfiguration, "_generate_provider_credential_name", return_value="API KEY 9"):
            with patch.object(ProviderConfiguration, "validate_provider_credentials", return_value={"api_key": "enc"}):
                with patch.object(ProviderConfiguration, "_get_provider_record", return_value=None):
                    with pytest.raises(RuntimeError, match="boom"):
                        configuration.create_provider_credential({"api_key": "raw"}, None)

    session.rollback.assert_called_once()


def test_update_provider_credential_raises_on_duplicate_name() -> None:
    configuration = _build_provider_configuration()
    session = Mock()

    with _patched_session(session):
        with patch.object(ProviderConfiguration, "_check_provider_credential_name_exists", return_value=True):
            with pytest.raises(ValueError, match="already exists"):
                configuration.update_provider_credential({"api_key": "raw"}, "cred-1", "Main")


def test_update_provider_credential_rolls_back_on_error() -> None:
    configuration = _build_provider_configuration()
    session = Mock()
    session.execute.return_value.scalar_one_or_none.return_value = SimpleNamespace(
        id="cred-1",
        encrypted_config="{}",
        credential_name="Main",
        updated_at=None,
    )
    session.commit.side_effect = RuntimeError("boom")

    with _patched_session(session):
        with patch.object(ProviderConfiguration, "_check_provider_credential_name_exists", return_value=False):
            with patch.object(ProviderConfiguration, "validate_provider_credentials", return_value={"api_key": "enc"}):
                with patch.object(ProviderConfiguration, "_get_provider_record", return_value=None):
                    with pytest.raises(RuntimeError, match="boom"):
                        configuration.update_provider_credential({"api_key": "raw"}, "cred-1", "Main")

    session.rollback.assert_called_once()


def test_delete_provider_credential_rolls_back_on_error() -> None:
    configuration = _build_provider_configuration()
    session = Mock()
    session.delete.side_effect = RuntimeError("boom")
    session.execute.side_effect = [
        _exec_result(scalar_one_or_none=SimpleNamespace(id="cred-1")),
        _exec_result(scalars_all=[]),
        _exec_result(scalar=2),
    ]

    with _patched_session(session):
        with patch.object(ProviderConfiguration, "_get_provider_record", return_value=None):
            with pytest.raises(RuntimeError, match="boom"):
                configuration.delete_provider_credential("cred-1")

    session.rollback.assert_called_once()


def test_switch_active_provider_credential_rolls_back_on_error() -> None:
    configuration = _build_provider_configuration()
    session = Mock()
    session.execute.return_value.scalar_one_or_none.return_value = SimpleNamespace(id="cred-1")
    session.commit.side_effect = RuntimeError("boom")
    provider_record = SimpleNamespace(id="provider-1", credential_id=None, updated_at=None)

    with _patched_session(session):
        with patch.object(ProviderConfiguration, "_get_provider_record", return_value=provider_record):
            with pytest.raises(RuntimeError, match="boom"):
                configuration.switch_active_provider_credential("cred-1")

    session.rollback.assert_called_once()


def test_get_specific_custom_model_credential_logs_when_decrypt_fails() -> None:
    configuration = _build_provider_configuration()
    configuration.provider.model_credential_schema = _build_secret_model_schema()
    session = Mock()
    session.execute.return_value.scalar_one_or_none.return_value = SimpleNamespace(
        id="cred-1",
        credential_name="Main",
        encrypted_config='{"openai_api_key":"enc-secret"}',
    )

    with _patched_session(session):
        with patch("core.entities.provider_configuration.encrypter.decrypt_token", side_effect=RuntimeError("boom")):
            with patch("core.entities.provider_configuration.logger.exception") as mock_logger:
                with patch.object(
                    ProviderConfiguration,
                    "obfuscated_credentials",
                    side_effect=lambda credentials, credential_form_schemas: credentials,
                ):
                    result = configuration._get_specific_custom_model_credential(ModelType.LLM, "gpt-4o", "cred-1")

    assert result["credentials"] == {"openai_api_key": "enc-secret"}
    mock_logger.assert_called_once()


def test_validate_custom_model_credentials_handles_invalid_original_json() -> None:
    configuration = _build_provider_configuration()
    configuration.provider.model_credential_schema = _build_secret_model_schema()
    session = Mock()
    session.execute.return_value.scalar_one_or_none.return_value = SimpleNamespace(encrypted_config="{invalid-json")
    mock_factory = Mock()
    mock_factory.model_credentials_validate.return_value = {"openai_api_key": "raw"}

    with patch("core.entities.provider_configuration.ModelProviderFactory", return_value=mock_factory):
        with patch("core.entities.provider_configuration.encrypter.encrypt_token", return_value="enc-new"):
            validated = configuration.validate_custom_model_credentials(
                model_type=ModelType.LLM,
                model="gpt-4o",
                credentials={"openai_api_key": HIDDEN_VALUE},
                credential_id="cred-1",
                session=session,
            )

    assert validated == {"openai_api_key": "enc-new"}


def test_create_custom_model_credential_raises_on_duplicate_name() -> None:
    configuration = _build_provider_configuration()
    session = Mock()

    with _patched_session(session):
        with patch.object(ProviderConfiguration, "_check_custom_model_credential_name_exists", return_value=True):
            with pytest.raises(ValueError, match="already exists"):
                configuration.create_custom_model_credential(ModelType.LLM, "gpt-4o", {"k": "v"}, "Main")


def test_create_custom_model_credential_rolls_back_on_error() -> None:
    configuration = _build_provider_configuration()
    session = Mock()
    session.add.side_effect = RuntimeError("boom")

    with _patched_session(session):
        with patch.object(ProviderConfiguration, "_generate_custom_model_credential_name", return_value="API KEY 4"):
            with patch.object(
                ProviderConfiguration,
                "validate_custom_model_credentials",
                return_value={"openai_api_key": "enc"},
            ):
                with patch.object(ProviderConfiguration, "_get_custom_model_record", return_value=None):
                    with pytest.raises(RuntimeError, match="boom"):
                        configuration.create_custom_model_credential(ModelType.LLM, "gpt-4o", {"k": "v"}, None)

    session.rollback.assert_called_once()


def test_update_custom_model_credential_raises_on_duplicate_name() -> None:
    configuration = _build_provider_configuration()
    session = Mock()

    with _patched_session(session):
        with patch.object(ProviderConfiguration, "_check_custom_model_credential_name_exists", return_value=True):
            with pytest.raises(ValueError, match="already exists"):
                configuration.update_custom_model_credential(
                    model_type=ModelType.LLM,
                    model="gpt-4o",
                    credentials={"k": "v"},
                    credential_name="Main",
                    credential_id="cred-1",
                )


def test_update_custom_model_credential_raises_when_record_not_found() -> None:
    configuration = _build_provider_configuration()
    session = Mock()
    session.execute.return_value.scalar_one_or_none.return_value = None

    with _patched_session(session):
        with patch.object(ProviderConfiguration, "_check_custom_model_credential_name_exists", return_value=False):
            with patch.object(ProviderConfiguration, "validate_custom_model_credentials", return_value={"k": "v"}):
                with patch.object(ProviderConfiguration, "_get_custom_model_record", return_value=None):
                    with pytest.raises(ValueError, match="Credential record not found"):
                        configuration.update_custom_model_credential(
                            model_type=ModelType.LLM,
                            model="gpt-4o",
                            credentials={"k": "v"},
                            credential_name="Main",
                            credential_id="cred-1",
                        )


def test_update_custom_model_credential_rolls_back_on_error() -> None:
    configuration = _build_provider_configuration()
    session = Mock()
    session.execute.return_value.scalar_one_or_none.return_value = SimpleNamespace(
        id="cred-1",
        encrypted_config="{}",
        credential_name="Main",
        updated_at=None,
    )
    session.commit.side_effect = RuntimeError("boom")

    with _patched_session(session):
        with patch.object(ProviderConfiguration, "_check_custom_model_credential_name_exists", return_value=False):
            with patch.object(ProviderConfiguration, "validate_custom_model_credentials", return_value={"k": "v"}):
                with patch.object(ProviderConfiguration, "_get_custom_model_record", return_value=None):
                    with pytest.raises(RuntimeError, match="boom"):
                        configuration.update_custom_model_credential(
                            model_type=ModelType.LLM,
                            model="gpt-4o",
                            credentials={"k": "v"},
                            credential_name="Main",
                            credential_id="cred-1",
                        )

    session.rollback.assert_called_once()


def test_delete_custom_model_credential_raises_when_record_not_found() -> None:
    configuration = _build_provider_configuration()
    session = Mock()
    session.execute.return_value.scalar_one_or_none.return_value = None

    with _patched_session(session):
        with pytest.raises(ValueError, match="Credential record not found"):
            configuration.delete_custom_model_credential(ModelType.LLM, "gpt-4o", "cred-1")


def test_delete_custom_model_credential_removes_custom_model_record_when_last_credential() -> None:
    configuration = _build_provider_configuration()
    session = Mock()
    credential_record = SimpleNamespace(id="cred-1")
    provider_model_record = SimpleNamespace(id="model-1", credential_id="cred-1", updated_at=None)
    session.execute.side_effect = [
        _exec_result(scalar_one_or_none=credential_record),
        _exec_result(scalars_all=[]),
        _exec_result(scalar=1),
    ]

    with _patched_session(session):
        with patch.object(ProviderConfiguration, "_get_custom_model_record", return_value=provider_model_record):
            configuration.delete_custom_model_credential(ModelType.LLM, "gpt-4o", "cred-1")

    assert any(call.args and call.args[0] is provider_model_record for call in session.delete.call_args_list)


def test_delete_custom_model_credential_rolls_back_on_error() -> None:
    configuration = _build_provider_configuration()
    session = Mock()
    session.delete.side_effect = RuntimeError("boom")
    session.execute.side_effect = [
        _exec_result(scalar_one_or_none=SimpleNamespace(id="cred-1")),
        _exec_result(scalars_all=[]),
        _exec_result(scalar=2),
    ]

    with _patched_session(session):
        with patch.object(ProviderConfiguration, "_get_custom_model_record", return_value=None):
            with pytest.raises(RuntimeError, match="boom"):
                configuration.delete_custom_model_credential(ModelType.LLM, "gpt-4o", "cred-1")

    session.rollback.assert_called_once()


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


def test_get_custom_provider_models_skips_custom_models_on_schema_error_or_none() -> None:
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

    with patch("core.entities.provider_configuration.logger.warning") as mock_warning:
        with patch.object(ProviderConfiguration, "get_model_schema", side_effect=_schema):
            models = configuration._get_custom_provider_models(
                model_types=[ModelType.LLM],
                provider_schema=provider_schema,
                model_setting_map={},
            )

    assert mock_warning.call_count == 1
    assert any(model.model == "ok-custom" for model in models)
    assert all(model.model != "none-custom" for model in models)
