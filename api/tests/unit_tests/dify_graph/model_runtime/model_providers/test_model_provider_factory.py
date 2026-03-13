import logging
from datetime import datetime
from threading import Lock
from typing import Any
from unittest.mock import MagicMock, patch

import pytest
from redis import RedisError

import contexts
from core.plugin.entities.plugin_daemon import PluginModelProviderEntity
from dify_graph.model_runtime.entities.common_entities import I18nObject
from dify_graph.model_runtime.entities.model_entities import (
    AIModelEntity,
    FetchFrom,
    ModelPropertyKey,
    ModelType,
)
from dify_graph.model_runtime.entities.provider_entities import ConfigurateMethod, ProviderEntity
from dify_graph.model_runtime.model_providers.model_provider_factory import ModelProviderFactory


def _provider_entity(
    *,
    provider: str,
    supported_model_types: list[ModelType] | None = None,
    models: list[AIModelEntity] | None = None,
    icon_small: I18nObject | None = None,
    icon_small_dark: I18nObject | None = None,
) -> ProviderEntity:
    return ProviderEntity(
        provider=provider,
        label=I18nObject(en_US=provider),
        supported_model_types=supported_model_types or [ModelType.LLM],
        configurate_methods=[ConfigurateMethod.PREDEFINED_MODEL],
        models=models or [],
        icon_small=icon_small,
        icon_small_dark=icon_small_dark,
    )


def _plugin_provider(
    *, plugin_id: str, declaration: ProviderEntity, provider: str = "provider"
) -> PluginModelProviderEntity:
    return PluginModelProviderEntity.model_construct(
        id=f"{plugin_id}-id",
        created_at=datetime.now(),
        updated_at=datetime.now(),
        provider=provider,
        tenant_id="tenant",
        plugin_unique_identifier=f"{plugin_id}-uid",
        plugin_id=plugin_id,
        declaration=declaration,
    )


@pytest.fixture(autouse=True)
def _reset_plugin_model_provider_context() -> None:
    contexts.plugin_model_providers_lock.set(Lock())
    contexts.plugin_model_providers.set(None)


@pytest.fixture
def fake_plugin_manager(monkeypatch: pytest.MonkeyPatch) -> MagicMock:
    manager = MagicMock()

    import core.plugin.impl.model as plugin_model_module

    monkeypatch.setattr(plugin_model_module, "PluginModelClient", lambda: manager)
    return manager


@pytest.fixture
def factory(fake_plugin_manager: MagicMock) -> ModelProviderFactory:
    return ModelProviderFactory(tenant_id="tenant")


def test_get_plugin_model_providers_initializes_context_on_lookup_error(
    factory: ModelProviderFactory, fake_plugin_manager: MagicMock, monkeypatch: pytest.MonkeyPatch
) -> None:
    declaration = _provider_entity(provider="openai")
    fake_plugin_manager.fetch_model_providers.return_value = [
        _plugin_provider(plugin_id="langgenius/openai", declaration=declaration)
    ]

    original_get = contexts.plugin_model_providers.get
    calls = {"n": 0}

    def flaky_get() -> Any:
        calls["n"] += 1
        if calls["n"] == 1:
            raise LookupError
        return original_get()

    monkeypatch.setattr(contexts.plugin_model_providers, "get", flaky_get)

    providers = factory.get_plugin_model_providers()
    assert len(providers) == 1
    assert providers[0].declaration.provider == "langgenius/openai/openai"


def test_get_plugin_model_providers_caches_and_does_not_refetch(
    factory: ModelProviderFactory, fake_plugin_manager: MagicMock
) -> None:
    declaration = _provider_entity(provider="openai")
    fake_plugin_manager.fetch_model_providers.return_value = [
        _plugin_provider(plugin_id="langgenius/openai", declaration=declaration)
    ]

    first = factory.get_plugin_model_providers()
    second = factory.get_plugin_model_providers()

    assert first is second
    fake_plugin_manager.fetch_model_providers.assert_called_once_with("tenant")


def test_get_providers_returns_declarations(factory: ModelProviderFactory, fake_plugin_manager: MagicMock) -> None:
    d1 = _provider_entity(provider="openai")
    d2 = _provider_entity(provider="anthropic")
    fake_plugin_manager.fetch_model_providers.return_value = [
        _plugin_provider(plugin_id="langgenius/openai", declaration=d1),
        _plugin_provider(plugin_id="langgenius/anthropic", declaration=d2),
    ]

    providers = factory.get_providers()
    assert [p.provider for p in providers] == ["langgenius/openai/openai", "langgenius/anthropic/anthropic"]


def test_get_plugin_model_provider_converts_short_provider_id(
    factory: ModelProviderFactory, fake_plugin_manager: MagicMock
) -> None:
    declaration = _provider_entity(provider="openai")
    fake_plugin_manager.fetch_model_providers.return_value = [
        _plugin_provider(plugin_id="langgenius/openai", declaration=declaration)
    ]

    provider = factory.get_plugin_model_provider("openai")
    assert provider.declaration.provider == "langgenius/openai/openai"


def test_get_plugin_model_provider_raises_on_invalid_provider(
    factory: ModelProviderFactory, fake_plugin_manager: MagicMock
) -> None:
    declaration = _provider_entity(provider="openai")
    fake_plugin_manager.fetch_model_providers.return_value = [
        _plugin_provider(plugin_id="langgenius/openai", declaration=declaration)
    ]

    with pytest.raises(ValueError, match="Invalid provider"):
        factory.get_plugin_model_provider("langgenius/unknown/unknown")


def test_get_provider_schema_returns_declaration(factory: ModelProviderFactory, fake_plugin_manager: MagicMock) -> None:
    declaration = _provider_entity(provider="openai")
    fake_plugin_manager.fetch_model_providers.return_value = [
        _plugin_provider(plugin_id="langgenius/openai", declaration=declaration)
    ]

    schema = factory.get_provider_schema("openai")
    assert schema.provider == "langgenius/openai/openai"


def test_provider_credentials_validate_errors_when_schema_missing(
    factory: ModelProviderFactory, monkeypatch: pytest.MonkeyPatch
) -> None:
    schema = _provider_entity(provider="openai")
    schema.provider_credential_schema = None
    monkeypatch.setattr(
        factory,
        "get_plugin_model_provider",
        lambda **_: _plugin_provider(plugin_id="langgenius/openai", declaration=schema),
    )

    with pytest.raises(ValueError, match="does not have provider_credential_schema"):
        factory.provider_credentials_validate(provider="openai", credentials={"x": "y"})


def test_provider_credentials_validate_filters_and_calls_plugin_validation(
    factory: ModelProviderFactory, fake_plugin_manager: MagicMock, monkeypatch: pytest.MonkeyPatch
) -> None:
    schema = _provider_entity(provider="openai")
    schema.provider_credential_schema = MagicMock()
    plugin_provider = _plugin_provider(plugin_id="langgenius/openai", declaration=schema)
    monkeypatch.setattr(factory, "get_plugin_model_provider", lambda **_: plugin_provider)

    fake_validator = MagicMock()
    fake_validator.validate_and_filter.return_value = {"filtered": True}
    monkeypatch.setattr(
        "dify_graph.model_runtime.model_providers.model_provider_factory.ProviderCredentialSchemaValidator",
        lambda _: fake_validator,
    )

    filtered = factory.provider_credentials_validate(provider="openai", credentials={"raw": True})
    assert filtered == {"filtered": True}
    fake_plugin_manager.validate_provider_credentials.assert_called_once()
    kwargs = fake_plugin_manager.validate_provider_credentials.call_args.kwargs
    assert kwargs["plugin_id"] == "langgenius/openai"
    assert kwargs["provider"] == "provider"
    assert kwargs["credentials"] == {"filtered": True}


def test_model_credentials_validate_errors_when_schema_missing(
    factory: ModelProviderFactory, monkeypatch: pytest.MonkeyPatch
) -> None:
    schema = _provider_entity(provider="openai")
    schema.model_credential_schema = None
    monkeypatch.setattr(
        factory,
        "get_plugin_model_provider",
        lambda **_: _plugin_provider(plugin_id="langgenius/openai", declaration=schema),
    )

    with pytest.raises(ValueError, match="does not have model_credential_schema"):
        factory.model_credentials_validate(
            provider="openai", model_type=ModelType.LLM, model="m", credentials={"x": "y"}
        )


def test_model_credentials_validate_filters_and_calls_plugin_validation(
    factory: ModelProviderFactory, fake_plugin_manager: MagicMock, monkeypatch: pytest.MonkeyPatch
) -> None:
    schema = _provider_entity(provider="openai")
    schema.model_credential_schema = MagicMock()
    plugin_provider = _plugin_provider(plugin_id="langgenius/openai", declaration=schema)
    monkeypatch.setattr(factory, "get_plugin_model_provider", lambda **_: plugin_provider)

    fake_validator = MagicMock()
    fake_validator.validate_and_filter.return_value = {"filtered": True}
    monkeypatch.setattr(
        "dify_graph.model_runtime.model_providers.model_provider_factory.ModelCredentialSchemaValidator",
        lambda *_: fake_validator,
    )

    filtered = factory.model_credentials_validate(
        provider="openai", model_type=ModelType.TEXT_EMBEDDING, model="m", credentials={"raw": True}
    )
    assert filtered == {"filtered": True}
    kwargs = fake_plugin_manager.validate_model_credentials.call_args.kwargs
    assert kwargs["plugin_id"] == "langgenius/openai"
    assert kwargs["provider"] == "provider"
    assert kwargs["model_type"] == "text-embedding"
    assert kwargs["model"] == "m"
    assert kwargs["credentials"] == {"filtered": True}


def test_get_model_schema_cache_hit(factory: ModelProviderFactory, monkeypatch: pytest.MonkeyPatch) -> None:
    model_schema = AIModelEntity(
        model="m",
        label=I18nObject(en_US="m"),
        model_type=ModelType.LLM,
        fetch_from=FetchFrom.PREDEFINED_MODEL,
        model_properties={ModelPropertyKey.CONTEXT_SIZE: 1024},
        parameter_rules=[],
    )

    monkeypatch.setattr(factory, "get_plugin_id_and_provider_name_from_provider", lambda *_: ("pid", "prov"))

    with patch("dify_graph.model_runtime.model_providers.model_provider_factory.redis_client") as mock_redis:
        mock_redis.get.return_value = model_schema.model_dump_json().encode()
        assert (
            factory.get_model_schema(provider="x", model_type=ModelType.LLM, model="m", credentials={"k": "v"})
            == model_schema
        )


def test_get_model_schema_cache_invalid_json_deletes_key(
    factory: ModelProviderFactory, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.WARNING)

    with patch("dify_graph.model_runtime.model_providers.model_provider_factory.redis_client") as mock_redis:
        mock_redis.get.return_value = b'{"model":"m"}'
        factory.plugin_model_manager.get_model_schema.return_value = None
        factory.get_plugin_id_and_provider_name_from_provider = lambda *_: ("pid", "prov")  # type: ignore[method-assign]
        assert factory.get_model_schema(provider="x", model_type=ModelType.LLM, model="m", credentials=None) is None
        assert mock_redis.delete.called
        assert any("Failed to validate cached plugin model schema" in r.message for r in caplog.records)


def test_get_model_schema_cache_delete_redis_error_is_logged(
    factory: ModelProviderFactory, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.WARNING)

    with patch("dify_graph.model_runtime.model_providers.model_provider_factory.redis_client") as mock_redis:
        mock_redis.get.return_value = b'{"model":"m"}'
        mock_redis.delete.side_effect = RedisError("nope")
        factory.plugin_model_manager.get_model_schema.return_value = None
        factory.get_plugin_id_and_provider_name_from_provider = lambda *_: ("pid", "prov")  # type: ignore[method-assign]
        factory.get_model_schema(provider="x", model_type=ModelType.LLM, model="m", credentials=None)
        assert any("Failed to delete invalid plugin model schema cache" in r.message for r in caplog.records)


def test_get_model_schema_redis_get_error_falls_back_to_plugin(
    factory: ModelProviderFactory, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.WARNING)
    factory.get_plugin_id_and_provider_name_from_provider = lambda *_: ("pid", "prov")  # type: ignore[method-assign]
    factory.plugin_model_manager.get_model_schema.return_value = None

    with patch("dify_graph.model_runtime.model_providers.model_provider_factory.redis_client") as mock_redis:
        mock_redis.get.side_effect = RedisError("down")
        assert factory.get_model_schema(provider="x", model_type=ModelType.LLM, model="m", credentials=None) is None
        assert any("Failed to read plugin model schema cache" in r.message for r in caplog.records)


def test_get_model_schema_cache_miss_sets_cache_and_handles_setex_error(
    factory: ModelProviderFactory, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.WARNING)
    factory.get_plugin_id_and_provider_name_from_provider = lambda *_: ("pid", "prov")  # type: ignore[method-assign]

    model_schema = AIModelEntity(
        model="m",
        label=I18nObject(en_US="m"),
        model_type=ModelType.LLM,
        fetch_from=FetchFrom.PREDEFINED_MODEL,
        model_properties={ModelPropertyKey.CONTEXT_SIZE: 1024},
        parameter_rules=[],
    )
    factory.plugin_model_manager.get_model_schema.return_value = model_schema

    with patch("dify_graph.model_runtime.model_providers.model_provider_factory.redis_client") as mock_redis:
        mock_redis.get.return_value = None
        mock_redis.setex.side_effect = RedisError("nope")
        assert (
            factory.get_model_schema(provider="x", model_type=ModelType.LLM, model="m", credentials=None)
            == model_schema
        )
        assert any("Failed to write plugin model schema cache" in r.message for r in caplog.records)


@pytest.mark.parametrize(
    ("model_type", "expected_class"),
    [
        (ModelType.LLM, "LargeLanguageModel"),
        (ModelType.TEXT_EMBEDDING, "TextEmbeddingModel"),
        (ModelType.RERANK, "RerankModel"),
        (ModelType.SPEECH2TEXT, "Speech2TextModel"),
        (ModelType.MODERATION, "ModerationModel"),
        (ModelType.TTS, "TTSModel"),
    ],
)
def test_get_model_type_instance_dispatches_by_type(
    factory: ModelProviderFactory, model_type: ModelType, expected_class: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(factory, "get_plugin_id_and_provider_name_from_provider", lambda *_: ("pid", "prov"))
    monkeypatch.setattr(factory, "get_plugin_model_provider", lambda *_: MagicMock(spec=PluginModelProviderEntity))

    sentinel = object()
    monkeypatch.setattr(
        f"dify_graph.model_runtime.model_providers.model_provider_factory.{expected_class}",
        MagicMock(model_validate=lambda _: sentinel),
    )

    assert factory.get_model_type_instance("langgenius/openai/openai", model_type) is sentinel


def test_get_model_type_instance_raises_on_unsupported(
    factory: ModelProviderFactory, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(factory, "get_plugin_id_and_provider_name_from_provider", lambda *_: ("pid", "prov"))
    monkeypatch.setattr(factory, "get_plugin_model_provider", lambda *_: MagicMock(spec=PluginModelProviderEntity))

    class UnknownModelType:
        pass

    with pytest.raises(ValueError, match="Unsupported model type"):
        factory.get_model_type_instance("langgenius/openai/openai", UnknownModelType())  # type: ignore[arg-type]


def test_get_models_filters_by_provider_and_model_type(
    factory: ModelProviderFactory, fake_plugin_manager: MagicMock
) -> None:
    llm = AIModelEntity(
        model="m1",
        label=I18nObject(en_US="m1"),
        model_type=ModelType.LLM,
        fetch_from=FetchFrom.PREDEFINED_MODEL,
        model_properties={ModelPropertyKey.CONTEXT_SIZE: 1024},
        parameter_rules=[],
    )
    embed = AIModelEntity(
        model="e1",
        label=I18nObject(en_US="e1"),
        model_type=ModelType.TEXT_EMBEDDING,
        fetch_from=FetchFrom.PREDEFINED_MODEL,
        model_properties={ModelPropertyKey.CONTEXT_SIZE: 1024},
        parameter_rules=[],
    )

    openai = _provider_entity(
        provider="openai", supported_model_types=[ModelType.LLM, ModelType.TEXT_EMBEDDING], models=[llm, embed]
    )
    anthropic = _provider_entity(provider="anthropic", supported_model_types=[ModelType.LLM], models=[llm])
    fake_plugin_manager.fetch_model_providers.return_value = [
        _plugin_provider(plugin_id="langgenius/openai", declaration=openai),
        _plugin_provider(plugin_id="langgenius/anthropic", declaration=anthropic),
    ]

    # ModelType filter picks only matching models
    providers = factory.get_models(model_type=ModelType.TEXT_EMBEDDING)
    assert len(providers) == 1
    assert providers[0].provider == "langgenius/openai/openai"
    assert [m.model for m in providers[0].models] == ["e1"]

    # Provider filter excludes others
    providers = factory.get_models(provider="langgenius/anthropic/anthropic", model_type=ModelType.LLM)
    assert len(providers) == 1
    assert providers[0].provider == "langgenius/anthropic/anthropic"


def test_get_models_provider_filter_skips_non_matching(
    factory: ModelProviderFactory, fake_plugin_manager: MagicMock
) -> None:
    openai = _provider_entity(provider="openai")
    anthropic = _provider_entity(provider="anthropic")
    fake_plugin_manager.fetch_model_providers.return_value = [
        _plugin_provider(plugin_id="langgenius/openai", declaration=openai),
        _plugin_provider(plugin_id="langgenius/anthropic", declaration=anthropic),
    ]

    providers = factory.get_models(provider="langgenius/not-exist/not-exist", model_type=ModelType.LLM)
    assert providers == []


def test_get_provider_icon_fetches_asset_and_returns_mime_type(
    factory: ModelProviderFactory, monkeypatch: pytest.MonkeyPatch
) -> None:
    provider_schema = _provider_entity(
        provider="langgenius/openai/openai",
        icon_small=I18nObject(en_US="icon.png", zh_Hans="icon-zh.png"),
        icon_small_dark=I18nObject(en_US="dark.svg", zh_Hans="dark-zh.svg"),
    )
    monkeypatch.setattr(factory, "get_provider_schema", lambda *_: provider_schema)

    class FakePluginAssetManager:
        def fetch_asset(self, tenant_id: str, id: str) -> bytes:
            assert tenant_id == "tenant"
            return f"bytes:{id}".encode()

    import core.plugin.impl.asset as asset_module

    monkeypatch.setattr(asset_module, "PluginAssetManager", FakePluginAssetManager)

    data, mime = factory.get_provider_icon("openai", "icon_small", "en_US")
    assert data == b"bytes:icon.png"
    assert mime == "image/png"

    data, mime = factory.get_provider_icon("openai", "icon_small_dark", "zh_Hans")
    assert data == b"bytes:dark-zh.svg"
    assert mime == "image/svg+xml"


def test_get_provider_icon_uses_zh_hans_for_small_and_en_us_for_dark(
    factory: ModelProviderFactory, monkeypatch: pytest.MonkeyPatch
) -> None:
    provider_schema = _provider_entity(
        provider="langgenius/openai/openai",
        icon_small=I18nObject(en_US="icon-en.png", zh_Hans="icon-zh.png"),
        icon_small_dark=I18nObject(en_US="dark-en.svg", zh_Hans="dark-zh.svg"),
    )
    monkeypatch.setattr(factory, "get_provider_schema", lambda *_: provider_schema)

    class FakePluginAssetManager:
        def fetch_asset(self, tenant_id: str, id: str) -> bytes:
            return id.encode()

    import core.plugin.impl.asset as asset_module

    monkeypatch.setattr(asset_module, "PluginAssetManager", FakePluginAssetManager)

    data, _ = factory.get_provider_icon("openai", "icon_small", "zh_Hans")
    assert data == b"icon-zh.png"

    data, _ = factory.get_provider_icon("openai", "icon_small_dark", "en_US")
    assert data == b"dark-en.svg"


def test_get_provider_icon_raises_for_missing_icons(
    factory: ModelProviderFactory, monkeypatch: pytest.MonkeyPatch
) -> None:
    provider_schema = _provider_entity(provider="langgenius/openai/openai")
    monkeypatch.setattr(factory, "get_provider_schema", lambda *_: provider_schema)

    with pytest.raises(ValueError, match="does not have small icon"):
        factory.get_provider_icon("openai", "icon_small", "en_US")

    with pytest.raises(ValueError, match="does not have small dark icon"):
        factory.get_provider_icon("openai", "icon_small_dark", "en_US")


def test_get_provider_icon_raises_for_unsupported_icon_type(
    factory: ModelProviderFactory, monkeypatch: pytest.MonkeyPatch
) -> None:
    provider_schema = _provider_entity(
        provider="langgenius/openai/openai",
        icon_small=I18nObject(en_US="", zh_Hans=""),
    )
    monkeypatch.setattr(factory, "get_provider_schema", lambda *_: provider_schema)
    with pytest.raises(ValueError, match="Unsupported icon type"):
        factory.get_provider_icon("openai", "nope", "en_US")


def test_get_provider_icon_raises_when_file_name_missing(
    factory: ModelProviderFactory, monkeypatch: pytest.MonkeyPatch
) -> None:
    provider_schema = _provider_entity(
        provider="langgenius/openai/openai",
        icon_small=I18nObject(en_US="", zh_Hans=""),
    )
    monkeypatch.setattr(factory, "get_provider_schema", lambda *_: provider_schema)
    with pytest.raises(ValueError, match="does not have icon"):
        factory.get_provider_icon("openai", "icon_small", "en_US")


def test_get_plugin_id_and_provider_name_from_provider_handles_google_special_case(
    factory: ModelProviderFactory,
) -> None:
    plugin_id, provider_name = factory.get_plugin_id_and_provider_name_from_provider("google")
    assert plugin_id == "langgenius/gemini"
    assert provider_name == "google"
