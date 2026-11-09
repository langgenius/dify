"""Audio tests use production model assembly; only provider lookup and daemon I/O are isolated."""

from collections.abc import Callable, Iterable, Iterator
from dataclasses import dataclass, field

import pytest
from redis import Redis

from core.entities.model_entities import DefaultModelEntity, DefaultModelProviderEntity
from core.entities.provider_configuration import ProviderConfiguration, ProviderModelBundle
from core.entities.provider_entities import CustomConfiguration, CustomProviderConfiguration, SystemConfiguration
from core.model_manager import ModelManager
from core.plugin.entities.plugin_daemon import (
    PluginStringResultResponse,
    PluginTTSResultResponse,
    PluginVoiceEntity,
    PluginVoicesResponse,
    TTSAudioChunk,
)
from core.plugin.impl.model import PluginModelClient
from core.plugin.impl.model_runtime import PluginModelRuntime
from core.plugin.impl.model_runtime_factory import create_model_type_instance
from core.provider_manager import ProviderManager
from extensions.ext_redis import RedisClientWrapper
from graphon.model_runtime.entities.common_entities import I18nObject
from graphon.model_runtime.entities.model_entities import AIModelEntity, FetchFrom, ModelPropertyKey, ModelType
from graphon.model_runtime.entities.provider_entities import ProviderEntity
from graphon.model_runtime.protocols.tts_runtime import TTSModelVoice
from models.provider import ProviderType

PROVIDER = "langgenius/openai/openai"


def record_calls[**P, R](function: Callable[P, R], calls: list[dict[str, object]]) -> Callable[P, R]:
    """Observe keyword arguments without replacing production behavior."""

    def delegated(*args: P.args, **kwargs: P.kwargs) -> R:
        calls.append(dict(kwargs))
        return function(*args, **kwargs)

    return delegated


@dataclass
class AudioRuntimeObservations:
    """Transport response data and observations, never installed as a runtime dependency."""

    speech_to_text_result: str = "Transcribed text"
    tts_result: bytes | Iterable[bytes] = b"audio data"
    tts_responses: list[Iterable[bytes]] = field(default_factory=list)
    voices: list[TTSModelVoice] = field(default_factory=list)
    # None means that the corresponding boundary succeeds.
    voices_error: Exception | None = None
    lookup_error: Exception | None = None
    # False represents an absent default-model database record.
    default_available: bool = True
    model_properties: dict[ModelPropertyKey, object] = field(
        default_factory=lambda: {ModelPropertyKey.AUDIO_TYPE: "mp3"}
    )
    speech_to_text_calls: list[bytes] = field(default_factory=list)
    tts_calls: list[dict[str, str]] = field(default_factory=list)
    voice_calls: list[tuple[str | None]] = field(default_factory=list)
    manager_requests: list[dict[str, object]] = field(default_factory=list)
    daemon_calls: list[dict[str, object]] = field(default_factory=list)
    runtime_calls: list[dict[str, object]] = field(default_factory=list)
    resolutions: list[tuple[str, ModelType]] = field(default_factory=list)


@pytest.fixture
def audio_runtime(monkeypatch: pytest.MonkeyPatch) -> Iterator[AudioRuntimeObservations]:
    observed = AudioRuntimeObservations()
    label = I18nObject(en_US="Audio provider")
    provider_schema = ProviderEntity(
        provider=PROVIDER,
        label=label,
        supported_model_types=[ModelType.TTS, ModelType.SPEECH2TEXT],
        configurate_methods=[],
    )

    def default_model(_manager: ProviderManager, *, tenant_id: str, model_type: ModelType) -> DefaultModelEntity | None:
        observed.resolutions.append((tenant_id, model_type))
        if observed.lookup_error is not None:
            raise observed.lookup_error
        if not observed.default_available:
            return None
        return DefaultModelEntity(
            model="audio-model",
            model_type=model_type,
            provider=DefaultModelProviderEntity(provider=PROVIDER, label=label),
        )

    def bundle(
        manager: ProviderManager, *, tenant_id: str, provider: str, model_type: ModelType
    ) -> ProviderModelBundle:
        assert provider == PROVIDER
        assert isinstance(manager._model_runtime, PluginModelRuntime)
        assert manager._model_runtime.tenant_id == tenant_id
        return ProviderModelBundle(
            configuration=ProviderConfiguration(
                tenant_id=tenant_id,
                provider=provider_schema,
                preferred_provider_type=ProviderType.CUSTOM,
                using_provider_type=ProviderType.CUSTOM,
                system_configuration=SystemConfiguration(enabled=False),
                custom_configuration=CustomConfiguration(
                    provider=CustomProviderConfiguration(credentials={"api_key": "audio-token"})
                ),
                model_settings=[],
            ),
            model_type_instance=create_model_type_instance(
                runtime=manager._model_runtime, provider_schema=provider_schema, model_type=model_type
            ),
        )

    def schema(_client: PluginModelClient, **kwargs: object) -> AIModelEntity:
        return AIModelEntity(
            model="audio-model",
            label=label,
            model_type=ModelType(kwargs["model_type"]),
            fetch_from=FetchFrom.PREDEFINED_MODEL,
            model_properties=observed.model_properties,
        )

    def dispatch(
        _client: PluginModelClient, **kwargs: object
    ) -> Iterator[PluginStringResultResponse | PluginVoicesResponse]:
        observed.daemon_calls.append(kwargs)
        data = kwargs["data"]
        assert isinstance(data, dict)
        payload = data["data"]
        assert payload["credentials"] == {"api_key": "audio-token"}
        assert payload["provider"] == "openai"
        assert payload["model"] == "audio-model"
        path = kwargs["path"]
        assert isinstance(path, str)
        if path.endswith("/voices"):
            observed.voice_calls.append((payload["language"],))
            if observed.voices_error is not None:
                raise observed.voices_error
            yield PluginVoicesResponse(
                voices=[PluginVoiceEntity(name=v.get("name", v["value"]), value=v["value"]) for v in observed.voices]
            )
        elif path.endswith("/speech2text/invoke"):
            observed.speech_to_text_calls.append(bytes.fromhex(payload["file"]))
            yield PluginStringResultResponse(result=observed.speech_to_text_result)
        else:
            assert path.endswith("/tts/invoke")
            observed.tts_calls.append({"content_text": payload["content_text"], "voice": payload["voice"]})
            response = observed.tts_responses.pop(0) if observed.tts_responses else observed.tts_result
            chunks = [response] if isinstance(response, bytes) else response
            for chunk in chunks:
                yield PluginTTSResultResponse(
                    result=chunk.hex(), mime_type=chunk.mime_type if isinstance(chunk, TTSAudioChunk) else None
                )

    monkeypatch.setattr(ProviderManager, "get_default_model", default_model)
    monkeypatch.setattr(ProviderManager, "get_provider_model_bundle", bundle)
    monkeypatch.setattr(PluginModelClient, "get_model_schema", schema)
    monkeypatch.setattr(PluginModelClient, "_request_with_plugin_daemon_response_stream", dispatch)
    monkeypatch.setattr(ModelManager, "for_tenant", record_calls(ModelManager.for_tenant, observed.manager_requests))
    monkeypatch.setattr(
        PluginModelRuntime, "invoke_tts", record_calls(PluginModelRuntime.invoke_tts, observed.runtime_calls)
    )
    monkeypatch.setattr(
        PluginModelRuntime,
        "invoke_speech_to_text",
        record_calls(PluginModelRuntime.invoke_speech_to_text, observed.runtime_calls),
    )
    with Redis() as client:
        monkeypatch.setattr(client, "execute_command", lambda *_args, **_kwargs: None)
        redis = RedisClientWrapper()
        redis.initialize(client)
        monkeypatch.setattr("core.plugin.impl.model_runtime.redis_client", redis)
        yield observed
