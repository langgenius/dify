import logging
import os

from core.model_runtime.entities.model_entities import ModelType
from core.model_runtime.entities.provider_entities import ProviderConfig, ProviderEntity, SimpleProviderEntity
from core.model_runtime.model_providers.model_provider_factory import ModelProviderExtension, ModelProviderFactory

logger = logging.getLogger(__name__)


def test_get_providers():
    factory = ModelProviderFactory()
    providers = factory.get_providers()

    for provider in providers:
        logger.debug(provider)

    assert len(providers) >= 1
    assert isinstance(providers[0], ProviderEntity)


def test_get_models():
    factory = ModelProviderFactory()
    providers = factory.get_models(
        model_type=ModelType.LLM,
        provider_configs=[
            ProviderConfig(provider="openai", credentials={"openai_api_key": os.environ.get("OPENAI_API_KEY")})
        ],
    )

    logger.debug(providers)

    assert len(providers) >= 1
    assert isinstance(providers[0], SimpleProviderEntity)

    # all provider models type equals to ModelType.LLM
    for provider in providers:
        for provider_model in provider.models:
            assert provider_model.model_type == ModelType.LLM

    providers = factory.get_models(
        provider="openai",
        provider_configs=[
            ProviderConfig(provider="openai", credentials={"openai_api_key": os.environ.get("OPENAI_API_KEY")})
        ],
    )

    assert len(providers) == 1
    assert isinstance(providers[0], SimpleProviderEntity)
    assert providers[0].provider == "openai"


def test_provider_credentials_validate():
    factory = ModelProviderFactory()
    factory.provider_credentials_validate(
        provider="openai", credentials={"openai_api_key": os.environ.get("OPENAI_API_KEY")}
    )


def test__get_model_provider_map():
    factory = ModelProviderFactory()
    model_providers = factory._get_model_provider_map()

    for name, model_provider in model_providers.items():
        logger.debug(name)
        logger.debug(model_provider.provider_instance)

    assert len(model_providers) >= 1
    assert isinstance(model_providers["openai"], ModelProviderExtension)
