import pytest

from dify_graph.model_runtime.entities.common_entities import I18nObject
from dify_graph.model_runtime.entities.model_entities import ModelType
from dify_graph.model_runtime.entities.provider_entities import ConfigurateMethod, ProviderEntity
from dify_graph.model_runtime.model_providers.model_provider_factory import ModelProviderFactory


class _FakeModelRuntime:
    def __init__(self, providers: list[ProviderEntity]) -> None:
        self._providers = providers

    def fetch_model_providers(self) -> list[ProviderEntity]:
        return self._providers


def test_model_provider_factory_resolves_runtime_provider_name() -> None:
    provider = ProviderEntity(
        provider="langgenius/openai/openai",
        provider_name="openai",
        label=I18nObject(en_US="OpenAI"),
        supported_model_types=[ModelType.LLM],
        configurate_methods=[ConfigurateMethod.PREDEFINED_MODEL],
    )
    factory = ModelProviderFactory(model_runtime=_FakeModelRuntime([provider]))

    provider_schema = factory.get_model_provider("openai")

    assert provider_schema.provider == "langgenius/openai/openai"
    assert provider_schema.provider_name == "openai"


def test_model_provider_factory_resolves_canonical_short_name_independent_of_provider_order() -> None:
    providers = [
        ProviderEntity(
            provider="acme/openai/openai",
            provider_name="",
            label=I18nObject(en_US="Acme OpenAI"),
            supported_model_types=[ModelType.LLM],
            configurate_methods=[ConfigurateMethod.PREDEFINED_MODEL],
        ),
        ProviderEntity(
            provider="langgenius/openai/openai",
            provider_name="openai",
            label=I18nObject(en_US="OpenAI"),
            supported_model_types=[ModelType.LLM],
            configurate_methods=[ConfigurateMethod.PREDEFINED_MODEL],
        ),
    ]
    factory = ModelProviderFactory(model_runtime=_FakeModelRuntime(providers))

    provider_schema = factory.get_model_provider("openai")

    assert provider_schema.provider == "langgenius/openai/openai"
    assert provider_schema.provider_name == "openai"


def test_model_provider_factory_requires_runtime() -> None:
    with pytest.raises(ValueError, match="model_runtime is required"):
        ModelProviderFactory(model_runtime=None)  # type: ignore[arg-type]
