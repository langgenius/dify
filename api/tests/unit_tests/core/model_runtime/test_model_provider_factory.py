from unittest.mock import Mock

import pytest

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
from dify_graph.model_runtime.model_providers.__base.large_language_model import LargeLanguageModel
from dify_graph.model_runtime.model_providers.__base.moderation_model import ModerationModel
from dify_graph.model_runtime.model_providers.__base.rerank_model import RerankModel
from dify_graph.model_runtime.model_providers.__base.speech2text_model import Speech2TextModel
from dify_graph.model_runtime.model_providers.__base.text_embedding_model import TextEmbeddingModel
from dify_graph.model_runtime.model_providers.__base.tts_model import TTSModel
from dify_graph.model_runtime.model_providers.model_provider_factory import ModelProviderFactory


def _build_model(model: str, model_type: ModelType) -> AIModelEntity:
    return AIModelEntity(
        model=model,
        label=I18nObject(en_US=model),
        model_type=model_type,
        fetch_from=FetchFrom.PREDEFINED_MODEL,
        model_properties={},
    )


def _build_provider(
    *,
    provider: str,
    provider_name: str,
    supported_model_types: list[ModelType],
    models: list[AIModelEntity] | None = None,
    provider_credential_schema: ProviderCredentialSchema | None = None,
    model_credential_schema: ModelCredentialSchema | None = None,
) -> ProviderEntity:
    return ProviderEntity(
        provider=provider,
        provider_name=provider_name,
        label=I18nObject(en_US=provider_name or provider),
        supported_model_types=supported_model_types,
        configurate_methods=[ConfigurateMethod.PREDEFINED_MODEL],
        models=models or [],
        provider_credential_schema=provider_credential_schema,
        model_credential_schema=model_credential_schema,
    )


class _FakeModelRuntime:
    def __init__(self, providers: list[ProviderEntity]) -> None:
        self._providers = providers
        self.validate_provider_credentials = Mock()
        self.validate_model_credentials = Mock()
        self.get_model_schema = Mock()
        self.get_provider_icon = Mock()

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


def test_model_provider_factory_get_models_filters_provider_and_model_type() -> None:
    providers = [
        _build_provider(
            provider="langgenius/openai/openai",
            provider_name="openai",
            supported_model_types=[ModelType.LLM, ModelType.TTS],
            models=[_build_model("gpt-4o-mini", ModelType.LLM), _build_model("tts-1", ModelType.TTS)],
        ),
        _build_provider(
            provider="langgenius/cohere/cohere",
            provider_name="cohere",
            supported_model_types=[ModelType.RERANK],
            models=[_build_model("rerank-v3", ModelType.RERANK)],
        ),
    ]
    factory = ModelProviderFactory(model_runtime=_FakeModelRuntime(providers))

    results = factory.get_models(provider="openai", model_type=ModelType.LLM)

    assert len(results) == 1
    assert results[0].provider == "langgenius/openai/openai"
    assert [model.model for model in results[0].models] == ["gpt-4o-mini"]


def test_model_provider_factory_validates_provider_credentials() -> None:
    runtime = _FakeModelRuntime(
        [
            _build_provider(
                provider="langgenius/openai/openai",
                provider_name="openai",
                supported_model_types=[ModelType.LLM],
                provider_credential_schema=ProviderCredentialSchema(
                    credential_form_schemas=[
                        CredentialFormSchema(
                            variable="api_key",
                            label=I18nObject(en_US="API key"),
                            type=FormType.SECRET_INPUT,
                            required=True,
                        )
                    ]
                ),
            )
        ]
    )
    factory = ModelProviderFactory(model_runtime=runtime)

    filtered = factory.provider_credentials_validate(
        provider="openai",
        credentials={"api_key": "secret", "ignored": "value"},
    )

    assert filtered == {"api_key": "secret"}
    runtime.validate_provider_credentials.assert_called_once_with(
        provider="langgenius/openai/openai",
        credentials={"api_key": "secret"},
    )


def test_model_provider_factory_validates_model_credentials() -> None:
    runtime = _FakeModelRuntime(
        [
            _build_provider(
                provider="langgenius/openai/openai",
                provider_name="openai",
                supported_model_types=[ModelType.LLM],
                model_credential_schema=ModelCredentialSchema(
                    model=FieldModelSchema(label=I18nObject(en_US="Model")),
                    credential_form_schemas=[
                        CredentialFormSchema(
                            variable="api_key",
                            label=I18nObject(en_US="API key"),
                            type=FormType.SECRET_INPUT,
                            required=True,
                        )
                    ],
                ),
            )
        ]
    )
    factory = ModelProviderFactory(model_runtime=runtime)

    filtered = factory.model_credentials_validate(
        provider="openai",
        model_type=ModelType.LLM,
        model="gpt-4o-mini",
        credentials={"api_key": "secret", "ignored": "value"},
    )

    assert filtered == {"api_key": "secret"}
    runtime.validate_model_credentials.assert_called_once_with(
        provider="langgenius/openai/openai",
        model_type=ModelType.LLM,
        model="gpt-4o-mini",
        credentials={"api_key": "secret"},
    )


def test_model_provider_factory_get_model_schema_and_icon_use_canonical_provider() -> None:
    runtime = _FakeModelRuntime(
        [
            _build_provider(
                provider="langgenius/openai/openai",
                provider_name="openai",
                supported_model_types=[ModelType.LLM],
            )
        ]
    )
    runtime.get_model_schema.return_value = "schema"
    runtime.get_provider_icon.return_value = (b"icon", "image/png")
    factory = ModelProviderFactory(model_runtime=runtime)

    assert (
        factory.get_model_schema(
            provider="openai",
            model_type=ModelType.LLM,
            model="gpt-4o-mini",
            credentials=None,
        )
        == "schema"
    )
    assert factory.get_provider_icon("openai", "icon_small", "en_US") == (b"icon", "image/png")
    runtime.get_model_schema.assert_called_once_with(
        provider="langgenius/openai/openai",
        model_type=ModelType.LLM,
        model="gpt-4o-mini",
        credentials={},
    )
    runtime.get_provider_icon.assert_called_once_with(
        provider="langgenius/openai/openai",
        icon_type="icon_small",
        lang="en_US",
    )


@pytest.mark.parametrize(
    ("model_type", "expected_type"),
    [
        (ModelType.LLM, LargeLanguageModel),
        (ModelType.TEXT_EMBEDDING, TextEmbeddingModel),
        (ModelType.RERANK, RerankModel),
        (ModelType.SPEECH2TEXT, Speech2TextModel),
        (ModelType.MODERATION, ModerationModel),
        (ModelType.TTS, TTSModel),
    ],
)
def test_model_provider_factory_builds_model_type_instances(
    model_type: ModelType,
    expected_type: type[object],
) -> None:
    factory = ModelProviderFactory(
        model_runtime=_FakeModelRuntime(
            [
                _build_provider(
                    provider="langgenius/openai/openai",
                    provider_name="openai",
                    supported_model_types=[model_type],
                )
            ]
        )
    )

    instance = factory.get_model_type_instance("openai", model_type)

    assert isinstance(instance, expected_type)
