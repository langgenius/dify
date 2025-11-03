from unittest.mock import MagicMock

from core.app.entities.app_invoke_entities import ModelConfigWithCredentialsEntity
from core.entities.provider_configuration import ProviderConfiguration, ProviderModelBundle
from core.entities.provider_entities import CustomConfiguration, CustomProviderConfiguration, SystemConfiguration
from core.model_manager import ModelInstance
from core.model_runtime.entities.model_entities import ModelType
from core.model_runtime.model_providers.model_provider_factory import ModelProviderFactory
from models.provider import ProviderType


def get_mocked_fetch_model_config(
    provider: str,
    model: str,
    mode: str,
    credentials: dict,
):
    model_provider_factory = ModelProviderFactory(tenant_id="9d2074fc-6f86-45a9-b09d-6ecc63b9056b")
    model_type_instance = model_provider_factory.get_model_type_instance(provider, ModelType.LLM)
    provider_model_bundle = ProviderModelBundle(
        configuration=ProviderConfiguration(
            tenant_id="1",
            provider=model_provider_factory.get_provider_schema(provider),
            preferred_provider_type=ProviderType.CUSTOM,
            using_provider_type=ProviderType.CUSTOM,
            system_configuration=SystemConfiguration(enabled=False),
            custom_configuration=CustomConfiguration(provider=CustomProviderConfiguration(credentials=credentials)),
            model_settings=[],
        ),
        model_type_instance=model_type_instance,
    )
    model_instance = ModelInstance(provider_model_bundle=provider_model_bundle, model=model)
    model_schema = model_provider_factory.get_model_schema(
        provider=provider,
        model_type=model_type_instance.model_type,
        model=model,
        credentials=credentials,
    )
    assert model_schema is not None
    model_config = ModelConfigWithCredentialsEntity(
        model=model,
        provider=provider,
        mode=mode,
        credentials=credentials,
        parameters={},
        model_schema=model_schema,
        provider_model_bundle=provider_model_bundle,
    )

    return MagicMock(return_value=(model_instance, model_config))
