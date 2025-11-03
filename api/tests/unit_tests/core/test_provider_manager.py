import pytest
from pytest_mock import MockerFixture

from core.entities.provider_entities import ModelSettings
from core.model_runtime.entities.model_entities import ModelType
from core.provider_manager import ProviderManager
from models.provider import LoadBalancingModelConfig, ProviderModelSetting


@pytest.fixture
def mock_provider_entity(mocker: MockerFixture):
    mock_entity = mocker.Mock()
    mock_entity.provider = "openai"
    mock_entity.configurate_methods = ["predefined-model"]
    mock_entity.supported_model_types = [ModelType.LLM]

    # Use PropertyMock to ensure credential_form_schemas is iterable
    provider_credential_schema = mocker.Mock()
    type(provider_credential_schema).credential_form_schemas = mocker.PropertyMock(return_value=[])
    mock_entity.provider_credential_schema = provider_credential_schema

    model_credential_schema = mocker.Mock()
    type(model_credential_schema).credential_form_schemas = mocker.PropertyMock(return_value=[])
    mock_entity.model_credential_schema = model_credential_schema

    return mock_entity


def test__to_model_settings(mocker: MockerFixture, mock_provider_entity):
    # Mocking the inputs
    provider_model_settings = [
        ProviderModelSetting(
            id="id",
            tenant_id="tenant_id",
            provider_name="openai",
            model_name="gpt-4",
            model_type="text-generation",
            enabled=True,
            load_balancing_enabled=True,
        )
    ]
    load_balancing_model_configs = [
        LoadBalancingModelConfig(
            id="id1",
            tenant_id="tenant_id",
            provider_name="openai",
            model_name="gpt-4",
            model_type="text-generation",
            name="__inherit__",
            encrypted_config=None,
            enabled=True,
        ),
        LoadBalancingModelConfig(
            id="id2",
            tenant_id="tenant_id",
            provider_name="openai",
            model_name="gpt-4",
            model_type="text-generation",
            name="first",
            encrypted_config='{"openai_api_key": "fake_key"}',
            enabled=True,
        ),
    ]

    mocker.patch(
        "core.helper.model_provider_cache.ProviderCredentialsCache.get", return_value={"openai_api_key": "fake_key"}
    )

    provider_manager = ProviderManager()

    # Running the method
    result = provider_manager._to_model_settings(
        provider_entity=mock_provider_entity,
        provider_model_settings=provider_model_settings,
        load_balancing_model_configs=load_balancing_model_configs,
    )

    # Asserting that the result is as expected
    assert len(result) == 1
    assert isinstance(result[0], ModelSettings)
    assert result[0].model == "gpt-4"
    assert result[0].model_type == ModelType.LLM
    assert result[0].enabled is True
    assert len(result[0].load_balancing_configs) == 2
    assert result[0].load_balancing_configs[0].name == "__inherit__"
    assert result[0].load_balancing_configs[1].name == "first"


def test__to_model_settings_only_one_lb(mocker: MockerFixture, mock_provider_entity):
    # Mocking the inputs
    provider_model_settings = [
        ProviderModelSetting(
            id="id",
            tenant_id="tenant_id",
            provider_name="openai",
            model_name="gpt-4",
            model_type="text-generation",
            enabled=True,
            load_balancing_enabled=True,
        )
    ]
    load_balancing_model_configs = [
        LoadBalancingModelConfig(
            id="id1",
            tenant_id="tenant_id",
            provider_name="openai",
            model_name="gpt-4",
            model_type="text-generation",
            name="__inherit__",
            encrypted_config=None,
            enabled=True,
        )
    ]

    mocker.patch(
        "core.helper.model_provider_cache.ProviderCredentialsCache.get", return_value={"openai_api_key": "fake_key"}
    )

    provider_manager = ProviderManager()

    # Running the method
    result = provider_manager._to_model_settings(
        provider_entity=mock_provider_entity,
        provider_model_settings=provider_model_settings,
        load_balancing_model_configs=load_balancing_model_configs,
    )

    # Asserting that the result is as expected
    assert len(result) == 1
    assert isinstance(result[0], ModelSettings)
    assert result[0].model == "gpt-4"
    assert result[0].model_type == ModelType.LLM
    assert result[0].enabled is True
    assert len(result[0].load_balancing_configs) == 0


def test__to_model_settings_lb_disabled(mocker: MockerFixture, mock_provider_entity):
    # Mocking the inputs
    provider_model_settings = [
        ProviderModelSetting(
            id="id",
            tenant_id="tenant_id",
            provider_name="openai",
            model_name="gpt-4",
            model_type="text-generation",
            enabled=True,
            load_balancing_enabled=False,
        )
    ]
    load_balancing_model_configs = [
        LoadBalancingModelConfig(
            id="id1",
            tenant_id="tenant_id",
            provider_name="openai",
            model_name="gpt-4",
            model_type="text-generation",
            name="__inherit__",
            encrypted_config=None,
            enabled=True,
        ),
        LoadBalancingModelConfig(
            id="id2",
            tenant_id="tenant_id",
            provider_name="openai",
            model_name="gpt-4",
            model_type="text-generation",
            name="first",
            encrypted_config='{"openai_api_key": "fake_key"}',
            enabled=True,
        ),
    ]

    mocker.patch(
        "core.helper.model_provider_cache.ProviderCredentialsCache.get", return_value={"openai_api_key": "fake_key"}
    )

    provider_manager = ProviderManager()

    # Running the method
    result = provider_manager._to_model_settings(
        provider_entity=mock_provider_entity,
        provider_model_settings=provider_model_settings,
        load_balancing_model_configs=load_balancing_model_configs,
    )

    # Asserting that the result is as expected
    assert len(result) == 1
    assert isinstance(result[0], ModelSettings)
    assert result[0].model == "gpt-4"
    assert result[0].model_type == ModelType.LLM
    assert result[0].enabled is True
    assert len(result[0].load_balancing_configs) == 0
