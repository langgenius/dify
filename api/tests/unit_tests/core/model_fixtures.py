"""Build real model configuration and memory objects without resolving provider credentials."""

from core.app.entities.app_invoke_entities import ModelConfigWithCredentialsEntity
from core.entities.provider_configuration import ProviderConfiguration, ProviderModelBundle
from core.entities.provider_entities import CustomConfiguration, SystemConfiguration
from core.memory.token_buffer_memory import TokenBufferMemory
from core.model_manager import ModelInstance
from core.plugin.impl.model_runtime_factory import create_plugin_model_runtime
from graphon.model_runtime.entities.common_entities import I18nObject
from graphon.model_runtime.entities.model_entities import AIModelEntity, FetchFrom, ModelType
from graphon.model_runtime.entities.provider_entities import ProviderEntity
from graphon.model_runtime.model_providers.base.large_language_model import LargeLanguageModel
from models.model import Conversation
from models.provider import ProviderType


def make_model_config(*, provider: str, model: str, mode: str) -> ModelConfigWithCredentialsEntity:
    provider_schema = ProviderEntity(
        provider=provider,
        label=I18nObject(en_US="Test"),
        supported_model_types=[ModelType.LLM],
        configurate_methods=[],
    )
    return ModelConfigWithCredentialsEntity(
        provider=provider_schema.provider,
        model=model,
        mode=mode,
        model_schema=AIModelEntity(
            model=model,
            label=I18nObject(en_US="Test"),
            model_type=ModelType.LLM,
            fetch_from=FetchFrom.PREDEFINED_MODEL,
            model_properties={},
        ),
        provider_model_bundle=ProviderModelBundle(
            configuration=ProviderConfiguration(
                tenant_id="test-tenant-id",
                provider=provider_schema,
                preferred_provider_type=ProviderType.CUSTOM,
                using_provider_type=ProviderType.CUSTOM,
                system_configuration=SystemConfiguration(enabled=False),
                custom_configuration=CustomConfiguration(provider=None),
                model_settings=[],
            ),
            model_type_instance=LargeLanguageModel(
                provider_schema=provider_schema,
                model_runtime=create_plugin_model_runtime(tenant_id="test-tenant-id"),
            ),
        ),
    )


def make_token_buffer_memory(config: ModelConfigWithCredentialsEntity) -> TokenBufferMemory:
    return TokenBufferMemory(
        conversation=Conversation(),
        model_instance=ModelInstance(
            provider_model_bundle=config.provider_model_bundle,
            model=config.model,
            credentials=config.credentials,
        ),
    )


def make_model_instance(*, provider: str, model: str) -> ModelInstance:
    """Build an LLM instance with explicit credentials and no provider lookup."""
    config = make_model_config(provider=provider, model=model, mode="chat")
    return ModelInstance(
        provider_model_bundle=config.provider_model_bundle, model=config.model, credentials=config.credentials
    )
