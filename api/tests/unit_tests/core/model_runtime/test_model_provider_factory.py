from unittest.mock import Mock

import pytest

from core.plugin.impl.model_runtime_factory import create_model_type_instance
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
from graphon.model_runtime.model_providers.base.large_language_model import LargeLanguageModel
from graphon.model_runtime.model_providers.base.moderation_model import ModerationModel
from graphon.model_runtime.model_providers.base.rerank_model import RerankModel
from graphon.model_runtime.model_providers.base.speech2text_model import Speech2TextModel
from graphon.model_runtime.model_providers.base.text_embedding_model import TextEmbeddingModel
from graphon.model_runtime.model_providers.base.tts_model import TTSModel
from graphon.model_runtime.model_providers.model_provider_factory import ModelProviderFactory


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
    factory = ModelProviderFactory(runtime=_FakeModelRuntime([provider]))

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
    factory = ModelProviderFactory(runtime=_FakeModelRuntime(providers))

    provider_schema = factory.get_model_provider("openai")

    assert provider_schema.provider == "langgenius/openai/openai"
    assert provider_schema.provider_name == "openai"


def test_model_provider_factory_requires_runtime() -> None:
    with pytest.raises(ValueError, match="runtime is required"):
        ModelProviderFactory(runtime=None)  # type: ignore[arg-type]


def test_model_provider_factory_get_providers_returns_runtime_providers() -> None:
    providers = [
        _build_provider(
            provider="langgenius/openai/openai",
            provider_name="openai",
            supported_model_types=[ModelType.LLM],
        )
    ]
    factory = ModelProviderFactory(runtime=_FakeModelRuntime(providers))

    result = factory.get_providers()

    assert list(result) == providers
    assert result is not providers


def test_model_provider_factory_get_provider_schema_delegates_to_provider_lookup() -> None:
    provider = _build_provider(
        provider="langgenius/openai/openai",
        provider_name="openai",
        supported_model_types=[ModelType.LLM],
    )
    factory = ModelProviderFactory(runtime=_FakeModelRuntime([provider]))

    result = factory.get_provider_schema("openai")

    assert result is provider


def test_model_provider_factory_raises_for_unknown_provider() -> None:
    factory = ModelProviderFactory(
        runtime=_FakeModelRuntime(
            [
                _build_provider(
                    provider="langgenius/openai/openai",
                    provider_name="openai",
                    supported_model_types=[ModelType.LLM],
                )
            ]
        )
    )

    with pytest.raises(ValueError, match="Invalid provider: anthropic"):
        factory.get_model_provider("anthropic")


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
    factory = ModelProviderFactory(runtime=_FakeModelRuntime(providers))

    results = factory.get_models(provider="openai", model_type=ModelType.LLM)

    assert len(results) == 1
    assert results[0].provider == "langgenius/openai/openai"
    assert [model.model for model in results[0].models] == ["gpt-4o-mini"]


def test_model_provider_factory_get_models_skips_providers_without_requested_model_type() -> None:
    providers = [
        _build_provider(
            provider="langgenius/openai/openai",
            provider_name="openai",
            supported_model_types=[ModelType.LLM],
            models=[_build_model("gpt-4o-mini", ModelType.LLM)],
        ),
        _build_provider(
            provider="langgenius/elevenlabs/elevenlabs",
            provider_name="elevenlabs",
            supported_model_types=[ModelType.TTS],
            models=[_build_model("eleven_multilingual_v2", ModelType.TTS)],
        ),
    ]
    factory = ModelProviderFactory(runtime=_FakeModelRuntime(providers))

    results = factory.get_models(model_type=ModelType.TTS)

    assert len(results) == 1
    assert results[0].provider == "langgenius/elevenlabs/elevenlabs"
    assert [model.model for model in results[0].models] == ["eleven_multilingual_v2"]


def test_model_provider_factory_get_models_without_model_type_keeps_all_provider_models() -> None:
    providers = [
        _build_provider(
            provider="langgenius/openai/openai",
            provider_name="openai",
            supported_model_types=[ModelType.LLM, ModelType.TTS],
            models=[_build_model("gpt-4o-mini", ModelType.LLM), _build_model("tts-1", ModelType.TTS)],
        )
    ]
    factory = ModelProviderFactory(runtime=_FakeModelRuntime(providers))

    results = factory.get_models(provider="openai")

    assert len(results) == 1
    assert [model.model for model in results[0].models] == ["gpt-4o-mini", "tts-1"]


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
    factory = ModelProviderFactory(runtime=runtime)

    filtered = factory.provider_credentials_validate(
        provider="openai",
        credentials={"api_key": "secret", "ignored": "value"},
    )

    assert filtered == {"api_key": "secret"}
    runtime.validate_provider_credentials.assert_called_once_with(
        provider="langgenius/openai/openai",
        credentials={"api_key": "secret"},
    )


def test_model_provider_factory_provider_credentials_validate_requires_schema() -> None:
    factory = ModelProviderFactory(
        runtime=_FakeModelRuntime(
            [
                _build_provider(
                    provider="langgenius/openai/openai",
                    provider_name="openai",
                    supported_model_types=[ModelType.LLM],
                )
            ]
        )
    )

    with pytest.raises(ValueError, match="Provider openai does not have provider_credential_schema"):
        factory.provider_credentials_validate(provider="openai", credentials={"api_key": "secret"})


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
    factory = ModelProviderFactory(runtime=runtime)

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


def test_model_provider_factory_model_credentials_validate_requires_schema() -> None:
    factory = ModelProviderFactory(
        runtime=_FakeModelRuntime(
            [
                _build_provider(
                    provider="langgenius/openai/openai",
                    provider_name="openai",
                    supported_model_types=[ModelType.LLM],
                )
            ]
        )
    )

    with pytest.raises(ValueError, match="Provider openai does not have model_credential_schema"):
        factory.model_credentials_validate(
            provider="openai",
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
    factory = ModelProviderFactory(runtime=runtime)

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
def test_create_model_type_instance_builds_model_wrappers(
    model_type: ModelType,
    expected_type: type[object],
) -> None:
    runtime = _FakeModelRuntime(
        [
            _build_provider(
                provider="langgenius/openai/openai",
                provider_name="openai",
                supported_model_types=[model_type],
            )
        ]
    )

    instance = create_model_type_instance(
        runtime=runtime,
        provider_schema=runtime.fetch_model_providers()[0],
        model_type=model_type,
    )

    assert isinstance(instance, expected_type)


def test_create_model_type_instance_rejects_unsupported_model_type() -> None:
    runtime = _FakeModelRuntime(
        [
            _build_provider(
                provider="langgenius/openai/openai",
                provider_name="openai",
                supported_model_types=[ModelType.LLM],
            )
        ]
    )

    with pytest.raises(ValueError, match="Unsupported model type: unsupported"):
        create_model_type_instance(
            runtime=runtime,
            provider_schema=runtime.fetch_model_providers()[0],
            model_type="unsupported",  # type: ignore[arg-type]
        )
