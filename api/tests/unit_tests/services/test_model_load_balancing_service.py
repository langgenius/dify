from __future__ import annotations

import json
from types import SimpleNamespace
from typing import Any, cast
from unittest.mock import MagicMock

import pytest
from graphon.model_runtime.entities.common_entities import I18nObject
from graphon.model_runtime.entities.model_entities import ModelType
from graphon.model_runtime.entities.provider_entities import (
    CredentialFormSchema,
    FieldModelSchema,
    FormType,
    ModelCredentialSchema,
    ProviderCredentialSchema,
)
from pytest_mock import MockerFixture

from constants import HIDDEN_VALUE
from models.provider import LoadBalancingModelConfig
from services.model_load_balancing_service import ModelLoadBalancingService


def _build_provider_credential_schema() -> ProviderCredentialSchema:
    return ProviderCredentialSchema(
        credential_form_schemas=[
            CredentialFormSchema(variable="api_key", label=I18nObject(en_US="API Key"), type=FormType.SECRET_INPUT)
        ]
    )


def _build_model_credential_schema() -> ModelCredentialSchema:
    return ModelCredentialSchema(
        model=FieldModelSchema(label=I18nObject(en_US="Model")),
        credential_form_schemas=[
            CredentialFormSchema(variable="api_key", label=I18nObject(en_US="API Key"), type=FormType.SECRET_INPUT)
        ],
    )


def _build_provider_configuration(
    *,
    custom_provider: bool = False,
    load_balancing_enabled: bool | None = None,
    model_schema: ModelCredentialSchema | None = None,
    provider_schema: ProviderCredentialSchema | None = None,
) -> MagicMock:
    provider_configuration = MagicMock()
    provider_configuration.provider = SimpleNamespace(
        provider="openai",
        model_credential_schema=model_schema,
        provider_credential_schema=provider_schema,
    )
    provider_configuration.custom_configuration = SimpleNamespace(provider=custom_provider)
    provider_configuration.extract_secret_variables.return_value = ["api_key"]
    provider_configuration.obfuscated_credentials.side_effect = lambda credentials, credential_form_schemas: credentials
    provider_configuration.get_provider_model_setting.return_value = (
        None if load_balancing_enabled is None else SimpleNamespace(load_balancing_enabled=load_balancing_enabled)
    )
    return provider_configuration


def _load_balancing_model_config(**kwargs: Any) -> LoadBalancingModelConfig:
    return cast(LoadBalancingModelConfig, SimpleNamespace(**kwargs))


@pytest.fixture
def service(mocker: MockerFixture) -> ModelLoadBalancingService:
    # Arrange
    provider_manager = MagicMock()
    mocker.patch("services.model_load_balancing_service.create_plugin_provider_manager", return_value=provider_manager)
    model_assembly = SimpleNamespace(provider_manager=provider_manager, model_provider_factory=MagicMock())
    mocker.patch("services.model_load_balancing_service.create_plugin_model_assembly", return_value=model_assembly)
    svc = ModelLoadBalancingService()
    svc.provider_manager = provider_manager
    svc.model_assembly = model_assembly
    svc._get_provider_manager = lambda _tenant_id: provider_manager  # type: ignore[method-assign]
    return svc


@pytest.fixture
def mock_db(mocker: MockerFixture) -> MagicMock:
    # Arrange
    mocked_db = mocker.patch("services.model_load_balancing_service.db")
    mocked_db.session = MagicMock()
    return mocked_db


@pytest.mark.parametrize(
    ("method_name", "expected_provider_method"),
    [
        ("enable_model_load_balancing", "enable_model_load_balancing"),
        ("disable_model_load_balancing", "disable_model_load_balancing"),
    ],
)
def test_enable_disable_model_load_balancing_should_call_provider_configuration_method_when_provider_exists(
    method_name: str,
    expected_provider_method: str,
    service: ModelLoadBalancingService,
) -> None:
    # Arrange
    provider_configuration = _build_provider_configuration(provider_schema=_build_provider_credential_schema())
    service.provider_manager.get_configurations.return_value = {"openai": provider_configuration}

    # Act
    getattr(service, method_name)("tenant-1", "openai", "gpt-4o-mini", ModelType.LLM.value)

    # Assert
    getattr(provider_configuration, expected_provider_method).assert_called_once_with(
        model="gpt-4o-mini", model_type=ModelType.LLM
    )


@pytest.mark.parametrize(
    "method_name",
    ["enable_model_load_balancing", "disable_model_load_balancing"],
)
def test_enable_disable_model_load_balancing_should_raise_value_error_when_provider_missing(
    method_name: str,
    service: ModelLoadBalancingService,
) -> None:
    # Arrange
    service.provider_manager.get_configurations.return_value = {}

    # Act + Assert
    with pytest.raises(ValueError, match="Provider openai does not exist"):
        getattr(service, method_name)("tenant-1", "openai", "gpt-4o-mini", ModelType.LLM.value)


def test_get_load_balancing_configs_should_raise_value_error_when_provider_missing(
    service: ModelLoadBalancingService,
) -> None:
    # Arrange
    service.provider_manager.get_configurations.return_value = {}

    # Act + Assert
    with pytest.raises(ValueError, match="Provider openai does not exist"):
        service.get_load_balancing_configs("tenant-1", "openai", "gpt-4o-mini", ModelType.LLM.value)


def test_get_load_balancing_configs_should_insert_inherit_config_when_missing_for_custom_provider(
    service: ModelLoadBalancingService,
    mock_db: MagicMock,
    mocker: MockerFixture,
) -> None:
    # Arrange
    provider_configuration = _build_provider_configuration(
        custom_provider=True,
        load_balancing_enabled=True,
        provider_schema=_build_provider_credential_schema(),
    )
    service.provider_manager.get_configurations.return_value = {"openai": provider_configuration}
    config = SimpleNamespace(
        id="cfg-1",
        name="primary",
        encrypted_config=json.dumps({"api_key": "encrypted-key"}),
        credential_id="cred-1",
        enabled=True,
    )
    mock_db.session.query.return_value.where.return_value.order_by.return_value.all.return_value = [config]
    mocker.patch(
        "services.model_load_balancing_service.encrypter.get_decrypt_decoding",
        return_value=("rsa", "cipher"),
    )
    mocker.patch(
        "services.model_load_balancing_service.encrypter.decrypt_token_with_decoding",
        return_value="plain-key",
    )
    mocker.patch(
        "services.model_load_balancing_service.LBModelManager.get_config_in_cooldown_and_ttl",
        return_value=(False, 0),
    )

    # Act
    is_enabled, configs = service.get_load_balancing_configs(
        "tenant-1",
        "openai",
        "gpt-4o-mini",
        ModelType.LLM.value,
    )

    # Assert
    assert is_enabled is True
    assert len(configs) == 2
    assert configs[0]["name"] == "__inherit__"
    assert configs[1]["name"] == "primary"
    assert configs[1]["credentials"] == {"api_key": "plain-key"}
    assert mock_db.session.add.call_count == 1
    assert mock_db.session.commit.call_count == 1


def test_get_load_balancing_configs_should_reorder_existing_inherit_and_tolerate_json_or_decrypt_errors(
    service: ModelLoadBalancingService,
    mock_db: MagicMock,
    mocker: MockerFixture,
) -> None:
    # Arrange
    provider_configuration = _build_provider_configuration(
        custom_provider=True,
        load_balancing_enabled=None,
        provider_schema=_build_provider_credential_schema(),
    )
    service.provider_manager.get_configurations.return_value = {"openai": provider_configuration}
    normal_config = SimpleNamespace(
        id="cfg-1",
        name="normal",
        encrypted_config=json.dumps({"api_key": "bad-encrypted"}),
        credential_id="cred-1",
        enabled=True,
    )
    inherit_config = SimpleNamespace(
        id="cfg-2",
        name="__inherit__",
        encrypted_config="not-json",
        credential_id=None,
        enabled=False,
    )
    mock_db.session.query.return_value.where.return_value.order_by.return_value.all.return_value = [
        normal_config,
        inherit_config,
    ]
    mocker.patch(
        "services.model_load_balancing_service.encrypter.get_decrypt_decoding",
        return_value=("rsa", "cipher"),
    )
    mocker.patch(
        "services.model_load_balancing_service.encrypter.decrypt_token_with_decoding",
        side_effect=ValueError("cannot decrypt"),
    )
    mocker.patch(
        "services.model_load_balancing_service.LBModelManager.get_config_in_cooldown_and_ttl",
        return_value=(True, 15),
    )

    # Act
    is_enabled, configs = service.get_load_balancing_configs(
        "tenant-1",
        "openai",
        "gpt-4o-mini",
        ModelType.LLM.value,
        config_from="predefined-model",
    )

    # Assert
    assert is_enabled is False
    assert configs[0]["name"] == "__inherit__"
    assert configs[0]["credentials"] == {}
    assert configs[1]["credentials"] == {"api_key": "bad-encrypted"}
    assert configs[1]["in_cooldown"] is True
    assert configs[1]["ttl"] == 15


def test_get_load_balancing_config_should_raise_value_error_when_provider_missing(
    service: ModelLoadBalancingService,
) -> None:
    # Arrange
    service.provider_manager.get_configurations.return_value = {}

    # Act + Assert
    with pytest.raises(ValueError, match="Provider openai does not exist"):
        service.get_load_balancing_config("tenant-1", "openai", "gpt-4o-mini", ModelType.LLM.value, "cfg-1")


def test_get_load_balancing_config_should_return_none_when_config_not_found(
    service: ModelLoadBalancingService,
    mock_db: MagicMock,
) -> None:
    # Arrange
    provider_configuration = _build_provider_configuration(provider_schema=_build_provider_credential_schema())
    service.provider_manager.get_configurations.return_value = {"openai": provider_configuration}
    mock_db.session.query.return_value.where.return_value.first.return_value = None

    # Act
    result = service.get_load_balancing_config("tenant-1", "openai", "gpt-4o-mini", ModelType.LLM.value, "cfg-1")

    # Assert
    assert result is None


def test_get_load_balancing_config_should_return_obfuscated_payload_when_config_exists(
    service: ModelLoadBalancingService,
    mock_db: MagicMock,
) -> None:
    # Arrange
    provider_configuration = _build_provider_configuration(provider_schema=_build_provider_credential_schema())
    provider_configuration.obfuscated_credentials.side_effect = lambda credentials, credential_form_schemas: {
        "masked": credentials.get("api_key", "")
    }
    service.provider_manager.get_configurations.return_value = {"openai": provider_configuration}
    config = SimpleNamespace(id="cfg-1", name="primary", encrypted_config="not-json", enabled=True)
    mock_db.session.query.return_value.where.return_value.first.return_value = config

    # Act
    result = service.get_load_balancing_config("tenant-1", "openai", "gpt-4o-mini", ModelType.LLM.value, "cfg-1")

    # Assert
    assert result == {
        "id": "cfg-1",
        "name": "primary",
        "credentials": {"masked": ""},
        "enabled": True,
    }


def test_init_inherit_config_should_create_and_persist_inherit_configuration(
    service: ModelLoadBalancingService,
    mock_db: MagicMock,
) -> None:
    # Arrange
    model_type = ModelType.LLM

    # Act
    inherit_config = service._init_inherit_config("tenant-1", "openai", "gpt-4o-mini", model_type)

    # Assert
    assert inherit_config.tenant_id == "tenant-1"
    assert inherit_config.provider_name == "openai"
    assert inherit_config.model_name == "gpt-4o-mini"
    assert inherit_config.model_type == "llm"
    assert inherit_config.name == "__inherit__"
    mock_db.session.add.assert_called_once_with(inherit_config)
    mock_db.session.commit.assert_called_once()


def test_update_load_balancing_configs_should_raise_value_error_when_provider_missing(
    service: ModelLoadBalancingService,
) -> None:
    # Arrange
    service.provider_manager.get_configurations.return_value = {}

    # Act + Assert
    with pytest.raises(ValueError, match="Provider openai does not exist"):
        service.update_load_balancing_configs(
            "tenant-1",
            "openai",
            "gpt-4o-mini",
            ModelType.LLM.value,
            [],
            "custom-model",
        )


def test_update_load_balancing_configs_should_raise_value_error_when_configs_is_not_list(
    service: ModelLoadBalancingService,
) -> None:
    # Arrange
    provider_configuration = _build_provider_configuration(provider_schema=_build_provider_credential_schema())
    service.provider_manager.get_configurations.return_value = {"openai": provider_configuration}

    # Act + Assert
    with pytest.raises(ValueError, match="Invalid load balancing configs"):
        service.update_load_balancing_configs(  # type: ignore[arg-type]
            "tenant-1",
            "openai",
            "gpt-4o-mini",
            ModelType.LLM.value,
            cast(list[dict[str, object]], "invalid-configs"),
            "custom-model",
        )


def test_update_load_balancing_configs_should_raise_value_error_when_config_item_is_not_dict(
    service: ModelLoadBalancingService,
    mock_db: MagicMock,
) -> None:
    # Arrange
    provider_configuration = _build_provider_configuration(provider_schema=_build_provider_credential_schema())
    service.provider_manager.get_configurations.return_value = {"openai": provider_configuration}
    mock_db.session.scalars.return_value.all.return_value = []

    # Act + Assert
    with pytest.raises(ValueError, match="Invalid load balancing config"):
        service.update_load_balancing_configs(  # type: ignore[list-item]
            "tenant-1",
            "openai",
            "gpt-4o-mini",
            ModelType.LLM.value,
            cast(list[dict[str, object]], ["bad-item"]),
            "custom-model",
        )


def test_update_load_balancing_configs_should_raise_value_error_when_credential_id_not_found(
    service: ModelLoadBalancingService,
    mock_db: MagicMock,
) -> None:
    # Arrange
    provider_configuration = _build_provider_configuration(provider_schema=_build_provider_credential_schema())
    service.provider_manager.get_configurations.return_value = {"openai": provider_configuration}
    mock_db.session.scalars.return_value.all.return_value = []
    mock_db.session.query.return_value.filter_by.return_value.first.return_value = None

    # Act + Assert
    with pytest.raises(ValueError, match="Provider credential with id cred-1 not found"):
        service.update_load_balancing_configs(
            "tenant-1",
            "openai",
            "gpt-4o-mini",
            ModelType.LLM.value,
            [{"credential_id": "cred-1", "enabled": True}],
            "predefined-model",
        )


def test_update_load_balancing_configs_should_raise_value_error_when_name_or_enabled_is_invalid(
    service: ModelLoadBalancingService,
    mock_db: MagicMock,
) -> None:
    # Arrange
    provider_configuration = _build_provider_configuration(provider_schema=_build_provider_credential_schema())
    service.provider_manager.get_configurations.return_value = {"openai": provider_configuration}
    mock_db.session.scalars.return_value.all.return_value = []

    # Act + Assert
    with pytest.raises(ValueError, match="Invalid load balancing config name"):
        service.update_load_balancing_configs(
            "tenant-1",
            "openai",
            "gpt-4o-mini",
            ModelType.LLM.value,
            [{"enabled": True}],
            "custom-model",
        )

    with pytest.raises(ValueError, match="Invalid load balancing config enabled"):
        service.update_load_balancing_configs(
            "tenant-1",
            "openai",
            "gpt-4o-mini",
            ModelType.LLM.value,
            [{"name": "cfg-without-enabled"}],
            "custom-model",
        )


def test_update_load_balancing_configs_should_raise_value_error_when_existing_config_id_is_invalid(
    service: ModelLoadBalancingService,
    mock_db: MagicMock,
) -> None:
    # Arrange
    provider_configuration = _build_provider_configuration(provider_schema=_build_provider_credential_schema())
    service.provider_manager.get_configurations.return_value = {"openai": provider_configuration}
    current_config = SimpleNamespace(id="cfg-1")
    mock_db.session.scalars.return_value.all.return_value = [current_config]

    # Act + Assert
    with pytest.raises(ValueError, match="Invalid load balancing config id: cfg-2"):
        service.update_load_balancing_configs(
            "tenant-1",
            "openai",
            "gpt-4o-mini",
            ModelType.LLM.value,
            [{"id": "cfg-2", "name": "invalid", "enabled": True}],
            "custom-model",
        )


def test_update_load_balancing_configs_should_raise_value_error_when_credentials_are_invalid_for_update_or_create(
    service: ModelLoadBalancingService,
    mock_db: MagicMock,
) -> None:
    # Arrange
    provider_configuration = _build_provider_configuration(provider_schema=_build_provider_credential_schema())
    service.provider_manager.get_configurations.return_value = {"openai": provider_configuration}
    existing_config = SimpleNamespace(id="cfg-1", name="old", enabled=True, encrypted_config=None, updated_at=None)
    mock_db.session.scalars.return_value.all.return_value = [existing_config]

    # Act + Assert
    with pytest.raises(ValueError, match="Invalid load balancing config credentials"):
        service.update_load_balancing_configs(
            "tenant-1",
            "openai",
            "gpt-4o-mini",
            ModelType.LLM.value,
            [{"id": "cfg-1", "name": "new", "enabled": True, "credentials": "bad"}],
            "custom-model",
        )

    with pytest.raises(ValueError, match="Invalid load balancing config credentials"):
        service.update_load_balancing_configs(
            "tenant-1",
            "openai",
            "gpt-4o-mini",
            ModelType.LLM.value,
            [{"name": "new-config", "enabled": True, "credentials": "bad"}],
            "custom-model",
        )


def test_update_load_balancing_configs_should_update_existing_create_new_and_delete_removed_configs(
    service: ModelLoadBalancingService,
    mock_db: MagicMock,
    mocker: MockerFixture,
) -> None:
    # Arrange
    provider_configuration = _build_provider_configuration(provider_schema=_build_provider_credential_schema())
    service.provider_manager.get_configurations.return_value = {"openai": provider_configuration}
    existing_config_1 = SimpleNamespace(
        id="cfg-1",
        name="existing-one",
        enabled=True,
        encrypted_config=json.dumps({"api_key": "old"}),
        updated_at=None,
    )
    existing_config_2 = SimpleNamespace(
        id="cfg-2",
        name="existing-two",
        enabled=True,
        encrypted_config=None,
        updated_at=None,
    )
    mock_db.session.scalars.return_value.all.return_value = [existing_config_1, existing_config_2]
    mocker.patch.object(service, "_custom_credentials_validate", return_value={"api_key": "encrypted"})
    mock_clear_cache = mocker.patch.object(service, "_clear_credentials_cache")

    # Act
    service.update_load_balancing_configs(
        "tenant-1",
        "openai",
        "gpt-4o-mini",
        ModelType.LLM.value,
        [
            {"id": "cfg-1", "name": "updated-name", "enabled": False, "credentials": {"api_key": "plain"}},
            {"name": "new-config", "enabled": True, "credentials": {"api_key": "plain"}},
        ],
        "custom-model",
    )

    # Assert
    assert existing_config_1.name == "updated-name"
    assert existing_config_1.enabled is False
    assert json.loads(existing_config_1.encrypted_config) == {"api_key": "encrypted"}
    assert mock_db.session.add.call_count == 1
    mock_db.session.delete.assert_called_once_with(existing_config_2)
    assert mock_db.session.commit.call_count >= 3
    mock_clear_cache.assert_any_call("tenant-1", "cfg-1")
    mock_clear_cache.assert_any_call("tenant-1", "cfg-2")


def test_update_load_balancing_configs_should_raise_value_error_for_invalid_new_config_name_or_missing_credentials(
    service: ModelLoadBalancingService,
    mock_db: MagicMock,
) -> None:
    # Arrange
    provider_configuration = _build_provider_configuration(provider_schema=_build_provider_credential_schema())
    service.provider_manager.get_configurations.return_value = {"openai": provider_configuration}
    mock_db.session.scalars.return_value.all.return_value = []

    # Act + Assert
    with pytest.raises(ValueError, match="Invalid load balancing config name"):
        service.update_load_balancing_configs(
            "tenant-1",
            "openai",
            "gpt-4o-mini",
            ModelType.LLM.value,
            [{"name": "__inherit__", "enabled": True, "credentials": {"api_key": "x"}}],
            "custom-model",
        )

    with pytest.raises(ValueError, match="Invalid load balancing config credentials"):
        service.update_load_balancing_configs(
            "tenant-1",
            "openai",
            "gpt-4o-mini",
            ModelType.LLM.value,
            [{"name": "new", "enabled": True}],
            "custom-model",
        )


def test_update_load_balancing_configs_should_create_from_existing_provider_credential_when_credential_id_provided(
    service: ModelLoadBalancingService,
    mock_db: MagicMock,
) -> None:
    # Arrange
    provider_configuration = _build_provider_configuration(provider_schema=_build_provider_credential_schema())
    service.provider_manager.get_configurations.return_value = {"openai": provider_configuration}
    mock_db.session.scalars.return_value.all.return_value = []
    credential_record = SimpleNamespace(credential_name="Main Credential", encrypted_config='{"api_key":"enc"}')
    mock_db.session.query.return_value.filter_by.return_value.first.return_value = credential_record

    # Act
    service.update_load_balancing_configs(
        "tenant-1",
        "openai",
        "gpt-4o-mini",
        ModelType.LLM.value,
        [{"credential_id": "cred-1", "enabled": True}],
        "predefined-model",
    )

    # Assert
    created_config = mock_db.session.add.call_args.args[0]
    assert created_config.name == "Main Credential"
    assert created_config.credential_id == "cred-1"
    assert created_config.credential_source_type == "provider"
    assert created_config.encrypted_config == '{"api_key":"enc"}'
    mock_db.session.commit.assert_called()


def test_validate_load_balancing_credentials_should_raise_value_error_when_provider_missing(
    service: ModelLoadBalancingService,
) -> None:
    # Arrange
    service.provider_manager.get_configurations.return_value = {}

    # Act + Assert
    with pytest.raises(ValueError, match="Provider openai does not exist"):
        service.validate_load_balancing_credentials(
            "tenant-1",
            "openai",
            "gpt-4o-mini",
            ModelType.LLM.value,
            {"api_key": "plain"},
        )


def test_validate_load_balancing_credentials_should_raise_value_error_when_config_id_is_invalid(
    service: ModelLoadBalancingService,
    mock_db: MagicMock,
) -> None:
    # Arrange
    provider_configuration = _build_provider_configuration(provider_schema=_build_provider_credential_schema())
    service.provider_manager.get_configurations.return_value = {"openai": provider_configuration}
    mock_db.session.query.return_value.where.return_value.first.return_value = None

    # Act + Assert
    with pytest.raises(ValueError, match="Load balancing config cfg-1 does not exist"):
        service.validate_load_balancing_credentials(
            "tenant-1",
            "openai",
            "gpt-4o-mini",
            ModelType.LLM.value,
            {"api_key": "plain"},
            config_id="cfg-1",
        )


def test_validate_load_balancing_credentials_should_delegate_to_custom_validate_with_or_without_config(
    service: ModelLoadBalancingService,
    mock_db: MagicMock,
    mocker: MockerFixture,
) -> None:
    # Arrange
    provider_configuration = _build_provider_configuration(provider_schema=_build_provider_credential_schema())
    service.provider_manager.get_configurations.return_value = {"openai": provider_configuration}
    existing_config = SimpleNamespace(id="cfg-1")
    mock_db.session.query.return_value.where.return_value.first.return_value = existing_config
    mock_validate = mocker.patch.object(service, "_custom_credentials_validate")

    # Act
    service.validate_load_balancing_credentials(
        "tenant-1",
        "openai",
        "gpt-4o-mini",
        ModelType.LLM.value,
        {"api_key": "plain"},
        config_id="cfg-1",
    )
    service.validate_load_balancing_credentials(
        "tenant-1",
        "openai",
        "gpt-4o-mini",
        ModelType.LLM.value,
        {"api_key": "plain"},
    )

    # Assert
    assert mock_validate.call_count == 2
    assert mock_validate.call_args_list[0].kwargs["load_balancing_model_config"] is existing_config
    assert mock_validate.call_args_list[1].kwargs["load_balancing_model_config"] is None
    shared_model_provider_factory = service.model_assembly.model_provider_factory
    assert mock_validate.call_args_list[0].kwargs["model_provider_factory"] is shared_model_provider_factory
    assert mock_validate.call_args_list[1].kwargs["model_provider_factory"] is shared_model_provider_factory


def test_custom_credentials_validate_should_replace_hidden_secret_with_original_value_and_encrypt(
    service: ModelLoadBalancingService,
    mocker: MockerFixture,
) -> None:
    # Arrange
    provider_configuration = _build_provider_configuration(provider_schema=_build_provider_credential_schema())
    load_balancing_model_config = _load_balancing_model_config(
        encrypted_config=json.dumps({"api_key": "old-encrypted-token"})
    )
    mocker.patch("services.model_load_balancing_service.encrypter.decrypt_token", return_value="old-plain-value")
    mock_encrypt = mocker.patch(
        "services.model_load_balancing_service.encrypter.encrypt_token",
        side_effect=lambda tenant_id, value: f"enc:{value}",
    )

    # Act
    result = service._custom_credentials_validate(
        tenant_id="tenant-1",
        provider_configuration=provider_configuration,
        model_type=ModelType.LLM,
        model="gpt-4o-mini",
        credentials={"api_key": HIDDEN_VALUE, "region": "us"},
        load_balancing_model_config=load_balancing_model_config,
        validate=False,
    )

    # Assert
    assert result == {"api_key": "enc:old-plain-value", "region": "us"}
    mock_encrypt.assert_called_once_with("tenant-1", "old-plain-value")


def test_custom_credentials_validate_should_handle_invalid_original_json_and_validate_with_model_schema(
    service: ModelLoadBalancingService,
    mocker: MockerFixture,
) -> None:
    # Arrange
    provider_configuration = _build_provider_configuration(model_schema=_build_model_credential_schema())
    load_balancing_model_config = _load_balancing_model_config(encrypted_config="not-json")
    mock_factory = MagicMock()
    mock_factory.model_credentials_validate.return_value = {"api_key": "validated"}
    mock_encrypt = mocker.patch(
        "services.model_load_balancing_service.encrypter.encrypt_token",
        side_effect=lambda tenant_id, value: f"enc:{value}",
    )

    # Act
    result = service._custom_credentials_validate(
        tenant_id="tenant-1",
        provider_configuration=provider_configuration,
        model_type=ModelType.LLM,
        model="gpt-4o-mini",
        credentials={"api_key": "plain"},
        load_balancing_model_config=load_balancing_model_config,
        model_provider_factory=mock_factory,
        validate=True,
    )

    # Assert
    assert result == {"api_key": "enc:validated"}
    mock_factory.model_credentials_validate.assert_called_once()
    mock_factory.provider_credentials_validate.assert_not_called()
    mock_encrypt.assert_called_once_with("tenant-1", "validated")


def test_custom_credentials_validate_should_validate_with_provider_schema_when_model_schema_absent(
    service: ModelLoadBalancingService,
    mocker: MockerFixture,
) -> None:
    # Arrange
    provider_configuration = _build_provider_configuration(provider_schema=_build_provider_credential_schema())
    mock_factory = MagicMock()
    mock_factory.provider_credentials_validate.return_value = {"api_key": "provider-validated"}
    mocker.patch(
        "services.model_load_balancing_service.encrypter.encrypt_token",
        side_effect=lambda tenant_id, value: f"enc:{value}",
    )

    # Act
    result = service._custom_credentials_validate(
        tenant_id="tenant-1",
        provider_configuration=provider_configuration,
        model_type=ModelType.LLM,
        model="gpt-4o-mini",
        credentials={"api_key": "plain"},
        model_provider_factory=mock_factory,
        validate=True,
    )

    # Assert
    assert result == {"api_key": "enc:provider-validated"}
    mock_factory.provider_credentials_validate.assert_called_once()
    mock_factory.model_credentials_validate.assert_not_called()


def test_get_credential_schema_should_return_model_schema_or_provider_schema_or_raise(
    service: ModelLoadBalancingService,
) -> None:
    # Arrange
    model_schema = _build_model_credential_schema()
    provider_schema = _build_provider_credential_schema()
    provider_configuration_with_model = _build_provider_configuration(model_schema=model_schema)
    provider_configuration_with_provider = _build_provider_configuration(provider_schema=provider_schema)
    provider_configuration_without_schema = _build_provider_configuration()

    # Act
    schema_from_model = service._get_credential_schema(provider_configuration_with_model)
    schema_from_provider = service._get_credential_schema(provider_configuration_with_provider)

    # Assert
    assert schema_from_model is model_schema
    assert schema_from_provider is provider_schema
    with pytest.raises(ValueError, match="No credential schema found"):
        service._get_credential_schema(provider_configuration_without_schema)


def test_clear_credentials_cache_should_delete_load_balancing_cache_entry(
    service: ModelLoadBalancingService,
    mocker: MockerFixture,
) -> None:
    # Arrange
    mock_cache_instance = MagicMock()
    mock_cache_cls = mocker.patch(
        "services.model_load_balancing_service.ProviderCredentialsCache",
        return_value=mock_cache_instance,
    )

    # Act
    service._clear_credentials_cache("tenant-1", "cfg-1")

    # Assert
    mock_cache_cls.assert_called_once()
    assert mock_cache_cls.call_args.kwargs == {
        "tenant_id": "tenant-1",
        "identity_id": "cfg-1",
        "cache_type": mocker.ANY,
    }
    assert mock_cache_cls.call_args.kwargs["cache_type"].name == "LOAD_BALANCING_MODEL"
    mock_cache_instance.delete.assert_called_once()
