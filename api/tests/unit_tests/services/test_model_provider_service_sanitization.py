import types

import pytest

from core.entities.provider_entities import CredentialConfiguration, CustomModelConfiguration
from core.model_runtime.entities.common_entities import I18nObject
from core.model_runtime.entities.model_entities import ModelType
from core.model_runtime.entities.provider_entities import ConfigurateMethod
from models.provider import ProviderType
from services.model_provider_service import ModelProviderService


class _FakeConfigurations:
    def __init__(self, provider_configuration: types.SimpleNamespace) -> None:
        self._provider_configuration = provider_configuration

    def values(self) -> list[types.SimpleNamespace]:
        return [self._provider_configuration]


@pytest.fixture
def service_with_fake_configurations():
    # Build a fake provider schema with minimal fields used by ProviderResponse
    fake_provider = types.SimpleNamespace(
        provider="langgenius/openai_api_compatible/openai_api_compatible",
        label=I18nObject(en_US="OpenAI API Compatible", zh_Hans="OpenAI API Compatible"),
        description=None,
        icon_small=None,
        icon_small_dark=None,
        background=None,
        help=None,
        supported_model_types=[ModelType.LLM],
        configurate_methods=[ConfigurateMethod.CUSTOMIZABLE_MODEL],
        provider_credential_schema=None,
        model_credential_schema=None,
    )

    # Include decrypted credentials to simulate the leak source
    custom_model = CustomModelConfiguration(
        model="gpt-4o-mini",
        model_type=ModelType.LLM,
        credentials={"api_key": "sk-plain-text", "endpoint": "https://example.com"},
        current_credential_id="cred-1",
        current_credential_name="API KEY 1",
        available_model_credentials=[],
        unadded_to_model_list=False,
    )

    fake_custom_provider = types.SimpleNamespace(
        current_credential_id="cred-1",
        current_credential_name="API KEY 1",
        available_credentials=[CredentialConfiguration(credential_id="cred-1", credential_name="API KEY 1")],
    )

    fake_custom_configuration = types.SimpleNamespace(
        provider=fake_custom_provider, models=[custom_model], can_added_models=[]
    )

    fake_system_configuration = types.SimpleNamespace(enabled=False, current_quota_type=None, quota_configurations=[])

    fake_provider_configuration = types.SimpleNamespace(
        provider=fake_provider,
        preferred_provider_type=ProviderType.CUSTOM,
        custom_configuration=fake_custom_configuration,
        system_configuration=fake_system_configuration,
        is_custom_configuration_available=lambda: True,
    )

    class _FakeProviderManager:
        def get_configurations(self, tenant_id: str) -> _FakeConfigurations:
            return _FakeConfigurations(fake_provider_configuration)

    svc = ModelProviderService()
    svc.provider_manager = _FakeProviderManager()
    return svc


def test_get_provider_list_strips_credentials(service_with_fake_configurations: ModelProviderService):
    providers = service_with_fake_configurations.get_provider_list(tenant_id="tenant-1", model_type=None)

    assert len(providers) == 1
    custom_models = providers[0].custom_configuration.custom_models

    assert custom_models is not None
    assert len(custom_models) == 1
    # The sanitizer should drop credentials in list response
    assert custom_models[0].credentials is None
