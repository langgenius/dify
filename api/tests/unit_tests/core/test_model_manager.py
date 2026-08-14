from collections.abc import Callable
from io import BytesIO
from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest
import redis
from pytest_mock import MockerFixture

from core.entities.provider_entities import (
    ModelLoadBalancingConfiguration,
    ProviderQuotaType,
    QuotaConfiguration,
    QuotaUnit,
    RestrictModel,
)
from core.errors.error import ModelCurrentlyNotSupportError
from core.model_manager import LBModelManager, ModelInstance, ModelManager, QuotaManagedModelInstance
from extensions.ext_redis import redis_client
from graphon.model_runtime.entities.llm_entities import LLMResult, LLMResultChunk, LLMResultChunkDelta, LLMUsage
from graphon.model_runtime.entities.message_entities import AssistantPromptMessage
from graphon.model_runtime.entities.model_entities import ModelType
from models.provider import ProviderType


@pytest.fixture
def lb_model_manager():
    load_balancing_configs = [
        ModelLoadBalancingConfiguration(id="id1", name="__inherit__", credentials={}),
        ModelLoadBalancingConfiguration(id="id2", name="first", credentials={"openai_api_key": "fake_key"}),
        ModelLoadBalancingConfiguration(id="id3", name="second", credentials={"openai_api_key": "fake_key"}),
    ]

    lb_model_manager = LBModelManager(
        tenant_id="tenant_id",
        provider="openai",
        model_type=ModelType.LLM,
        model="gpt-4",
        load_balancing_configs=load_balancing_configs,
        managed_credentials={"openai_api_key": "fake_key"},
    )

    lb_model_manager.cooldown = MagicMock(return_value=None)

    def is_cooldown(config: ModelLoadBalancingConfiguration):
        if config.id == "id1":
            return True

        return False

    lb_model_manager.in_cooldown = MagicMock(side_effect=is_cooldown)

    return lb_model_manager


def test_model_manager_with_cache_enabled_reuses_stored_credentials():
    """With ``enable_credentials_cache=True``, later calls for the same key return cached creds."""
    provider_manager = MagicMock()
    bundle = MagicMock()
    bundle.configuration.provider.provider = "openai"
    bundle.configuration.tenant_id = "tenant-1"
    bundle.configuration.model_settings = []
    bundle.model_type_instance.model_type = ModelType.LLM
    get_creds = MagicMock(return_value={"api_key": "first"})
    bundle.configuration.get_current_credentials = get_creds
    provider_manager.get_provider_model_bundle.return_value = bundle

    manager = ModelManager(provider_manager, enable_credentials_cache=True)
    first = manager.get_model_instance("tenant-1", "openai", ModelType.LLM, "gpt-4")
    assert first.credentials == {"api_key": "first"}
    get_creds.assert_called_once()

    get_creds.return_value = {"api_key": "second"}
    second = manager.get_model_instance("tenant-1", "openai", ModelType.LLM, "gpt-4")
    assert second.credentials == {"api_key": "first"}
    get_creds.assert_called_once()


def _build_model_manager_bundle(
    *,
    provider_type: ProviderType,
    restrict_models: list[RestrictModel],
    model_type: ModelType = ModelType.LLM,
) -> tuple[ModelManager, MagicMock]:
    provider_manager = MagicMock()
    bundle = MagicMock()
    bundle.configuration.provider.provider = "openai"
    bundle.configuration.tenant_id = "tenant-1"
    bundle.configuration.model_settings = []
    bundle.configuration.using_provider_type = provider_type
    bundle.configuration.system_configuration.current_quota_type = ProviderQuotaType.TRIAL
    bundle.configuration.system_configuration.quota_configurations = [
        QuotaConfiguration(
            quota_type=ProviderQuotaType.TRIAL,
            quota_unit=QuotaUnit.CREDITS,
            quota_limit=200,
            quota_used=0,
            is_valid=True,
            restrict_models=restrict_models,
        )
    ]
    bundle.configuration.get_current_credentials.return_value = {"api_key": "hosted"}
    bundle.model_type_instance.model_type = model_type
    provider_manager.get_provider_model_bundle.return_value = bundle
    return ModelManager(provider_manager), bundle


def test_model_manager_wraps_allowlisted_system_llm() -> None:
    manager, _ = _build_model_manager_bundle(
        provider_type=ProviderType.SYSTEM,
        restrict_models=[RestrictModel(model="gpt-4", model_type=ModelType.LLM)],
    )

    model_instance = manager.get_model_instance("tenant-1", "openai", ModelType.LLM, "gpt-4")

    assert isinstance(model_instance, QuotaManagedModelInstance)


@pytest.mark.parametrize("model_type", list(ModelType))
def test_model_manager_wraps_every_system_model_type(model_type: ModelType) -> None:
    manager, _ = _build_model_manager_bundle(
        provider_type=ProviderType.SYSTEM,
        restrict_models=[RestrictModel(model="hosted-model", model_type=model_type)],
        model_type=model_type,
    )

    model_instance = manager.get_model_instance("tenant-1", "openai", model_type, "hosted-model")

    assert isinstance(model_instance, QuotaManagedModelInstance)


def test_model_manager_does_not_wrap_custom_non_llm_model() -> None:
    manager, _ = _build_model_manager_bundle(
        provider_type=ProviderType.CUSTOM,
        restrict_models=[],
        model_type=ModelType.TEXT_EMBEDDING,
    )

    model_instance = manager.get_model_instance(
        "tenant-1", "openai", ModelType.TEXT_EMBEDDING, "text-embedding-3-small"
    )

    assert type(model_instance) is ModelInstance


def test_model_manager_rejects_system_model_by_exact_name() -> None:
    manager, bundle = _build_model_manager_bundle(
        provider_type=ProviderType.SYSTEM,
        restrict_models=[RestrictModel(model="gpt-4", model_type=ModelType.LLM)],
    )

    with pytest.raises(ModelCurrentlyNotSupportError, match="llm/gpt-4o is not allowed"):
        manager.get_model_instance("tenant-1", "openai", ModelType.LLM, "gpt-4o")

    bundle.configuration.get_current_credentials.assert_not_called()


def test_model_manager_matches_allowlist_name_across_model_types() -> None:
    manager, _ = _build_model_manager_bundle(
        provider_type=ProviderType.SYSTEM,
        restrict_models=[RestrictModel(model="shared-model", model_type=ModelType.TEXT_EMBEDDING)],
    )

    model_instance = manager.get_model_instance("tenant-1", "openai", ModelType.LLM, "shared-model")

    assert isinstance(model_instance, QuotaManagedModelInstance)


def test_quota_managed_non_streaming_invocation_finalizes_reservation() -> None:
    manager, _ = _build_model_manager_bundle(
        provider_type=ProviderType.SYSTEM,
        restrict_models=[RestrictModel(model="gpt-4", model_type=ModelType.LLM)],
    )
    model_instance = manager.get_model_instance("tenant-1", "openai", ModelType.LLM, "gpt-4")
    usage = LLMUsage.empty_usage().model_copy(update={"total_tokens": 12})
    result = MagicMock(spec=LLMResult, usage=usage)
    reservation = MagicMock(commit_before_delivery=True)

    invocation_id = str(uuid4())
    with (
        patch.object(model_instance, "reserve_quota", return_value=reservation) as reserve_quota,
        patch.object(ModelInstance, "invoke_llm", return_value=result) as invoke,
    ):
        response = model_instance.invoke_llm(
            prompt_messages=[],
            stream=False,
            request_metadata={"invocation_id": invocation_id},
        )

    assert response is result
    reserve_quota.assert_called_once_with(request_id=invocation_id)
    invoke.assert_called_once()
    reservation.commit.assert_called_once_with(usage)
    reservation.release.assert_called_once_with()


def test_quota_managed_stream_commits_before_first_chunk() -> None:
    manager, _ = _build_model_manager_bundle(
        provider_type=ProviderType.SYSTEM,
        restrict_models=[RestrictModel(model="gpt-4", model_type=ModelType.LLM)],
    )
    model_instance = manager.get_model_instance("tenant-1", "openai", ModelType.LLM, "gpt-4")
    chunk = LLMResultChunk(
        model="gpt-4",
        prompt_messages=[],
        delta=LLMResultChunkDelta(index=0, message=AssistantPromptMessage(content="hello")),
    )
    reservation = MagicMock(commit_before_delivery=True)
    events: list[str] = []
    reservation.commit.side_effect = lambda _usage: events.append("commit")

    invocation_id = str(uuid4())
    with (
        patch.object(model_instance, "reserve_quota", return_value=reservation) as reserve_quota,
        patch.object(ModelInstance, "invoke_llm", return_value=(item for item in [chunk])),
    ):
        response = model_instance.invoke_llm(
            prompt_messages=[],
            stream=True,
            request_metadata={"invocation_id": invocation_id},
        )
        assert next(response) is chunk
        events.append("delivered")
        with pytest.raises(StopIteration):
            next(response)

    assert events == ["commit", "delivered"]
    reserve_quota.assert_called_once_with(request_id=invocation_id)
    reservation.release.assert_called_once_with()


def test_quota_managed_stream_releases_when_provider_fails_before_first_chunk() -> None:
    manager, _ = _build_model_manager_bundle(
        provider_type=ProviderType.SYSTEM,
        restrict_models=[RestrictModel(model="gpt-4", model_type=ModelType.LLM)],
    )
    model_instance = manager.get_model_instance("tenant-1", "openai", ModelType.LLM, "gpt-4")
    reservation = MagicMock(commit_before_delivery=True)

    def failing_stream():
        raise RuntimeError("provider failed")
        yield

    with (
        patch.object(model_instance, "reserve_quota", return_value=reservation),
        patch.object(ModelInstance, "invoke_llm", return_value=failing_stream()),
        pytest.raises(RuntimeError, match="provider failed"),
    ):
        list(model_instance.invoke_llm(prompt_messages=[], stream=True))

    reservation.commit.assert_not_called()
    reservation.release.assert_called_once_with()


def test_quota_managed_usage_stream_commits_before_delivering_buffered_chunks() -> None:
    manager, _ = _build_model_manager_bundle(
        provider_type=ProviderType.SYSTEM,
        restrict_models=[RestrictModel(model="gpt-4", model_type=ModelType.LLM)],
    )
    model_instance = manager.get_model_instance("tenant-1", "openai", ModelType.LLM, "gpt-4")
    usage = LLMUsage.empty_usage().model_copy(update={"total_tokens": 12})
    chunks = [
        LLMResultChunk(
            model="gpt-4",
            prompt_messages=[],
            delta=LLMResultChunkDelta(index=0, message=AssistantPromptMessage(content="hello")),
        ),
        LLMResultChunk(
            model="gpt-4",
            prompt_messages=[],
            delta=LLMResultChunkDelta(index=1, message=AssistantPromptMessage(content=" world"), usage=usage),
        ),
    ]
    reservation = MagicMock(commit_before_delivery=False)
    events: list[str] = []
    reservation.commit.side_effect = lambda _usage: events.append("commit")

    def provider_stream():
        for index, chunk in enumerate(chunks):
            events.append(f"provider-{index}")
            yield chunk

    with (
        patch.object(model_instance, "reserve_quota", return_value=reservation),
        patch.object(ModelInstance, "invoke_llm", return_value=provider_stream()),
    ):
        response = model_instance.invoke_llm(prompt_messages=[], stream=True)
        assert next(response) is chunks[0]
        events.append("delivered")
        assert list(response) == [chunks[1]]

    assert events == ["provider-0", "provider-1", "commit", "delivered"]
    reservation.commit.assert_called_once_with(usage)
    reservation.release.assert_called_once_with()


def test_quota_managed_usage_stream_does_not_deliver_when_settlement_fails() -> None:
    manager, _ = _build_model_manager_bundle(
        provider_type=ProviderType.SYSTEM,
        restrict_models=[RestrictModel(model="gpt-4", model_type=ModelType.LLM)],
    )
    model_instance = manager.get_model_instance("tenant-1", "openai", ModelType.LLM, "gpt-4")
    chunk = LLMResultChunk(
        model="gpt-4",
        prompt_messages=[],
        delta=LLMResultChunkDelta(index=0, message=AssistantPromptMessage(content="hello")),
    )
    reservation = MagicMock(commit_before_delivery=False)
    reservation.commit.side_effect = ValueError("terminal usage is required")

    with (
        patch.object(model_instance, "reserve_quota", return_value=reservation),
        patch.object(ModelInstance, "invoke_llm", return_value=(item for item in [chunk])),
        pytest.raises(ValueError, match="terminal usage is required"),
    ):
        next(model_instance.invoke_llm(prompt_messages=[], stream=True))

    reservation.release.assert_called_once_with()


@pytest.mark.parametrize(
    ("model_type", "method_name", "invoke_model"),
    [
        (
            ModelType.TEXT_EMBEDDING,
            "invoke_text_embedding",
            lambda model_instance: model_instance.invoke_text_embedding(texts=["hello"]),
        ),
        (
            ModelType.TEXT_EMBEDDING,
            "invoke_multimodal_embedding",
            lambda model_instance: model_instance.invoke_multimodal_embedding(
                multimodel_documents=[{"content": "image"}]
            ),
        ),
        (
            ModelType.RERANK,
            "invoke_rerank",
            lambda model_instance: model_instance.invoke_rerank(query="hello", docs=["document"]),
        ),
        (
            ModelType.RERANK,
            "invoke_multimodal_rerank",
            lambda model_instance: model_instance.invoke_multimodal_rerank(query=MagicMock(), docs=[MagicMock()]),
        ),
        (
            ModelType.MODERATION,
            "invoke_moderation",
            lambda model_instance: model_instance.invoke_moderation(text="hello"),
        ),
        (
            ModelType.SPEECH2TEXT,
            "invoke_speech2text",
            lambda model_instance: model_instance.invoke_speech2text(file=BytesIO(b"audio")),
        ),
    ],
)
def test_quota_managed_non_llm_invocation_finalizes_reservation(
    model_type: ModelType,
    method_name: str,
    invoke_model: Callable[[ModelInstance], object],
) -> None:
    manager, _ = _build_model_manager_bundle(
        provider_type=ProviderType.SYSTEM,
        restrict_models=[RestrictModel(model="hosted-model", model_type=model_type)],
        model_type=model_type,
    )
    model_instance = manager.get_model_instance("tenant-1", "openai", model_type, "hosted-model")
    result = MagicMock()
    reservation = MagicMock()

    with (
        patch.object(model_instance, "reserve_quota", return_value=reservation),
        patch.object(ModelInstance, method_name, return_value=result) as invoke,
    ):
        response = invoke_model(model_instance)

    assert response is result
    invoke.assert_called_once()
    reservation.commit.assert_called_once_with()
    reservation.release.assert_called_once_with()


def test_quota_managed_non_llm_invocation_releases_when_provider_fails() -> None:
    manager, _ = _build_model_manager_bundle(
        provider_type=ProviderType.SYSTEM,
        restrict_models=[RestrictModel(model="embedding-model", model_type=ModelType.TEXT_EMBEDDING)],
        model_type=ModelType.TEXT_EMBEDDING,
    )
    model_instance = manager.get_model_instance("tenant-1", "openai", ModelType.TEXT_EMBEDDING, "embedding-model")
    reservation = MagicMock()

    with (
        patch.object(model_instance, "reserve_quota", return_value=reservation),
        patch.object(ModelInstance, "invoke_text_embedding", side_effect=RuntimeError("provider failed")),
        pytest.raises(RuntimeError, match="provider failed"),
    ):
        model_instance.invoke_text_embedding(texts=["hello"])

    reservation.commit.assert_not_called()
    reservation.release.assert_called_once_with()


def test_quota_managed_tts_commits_before_first_chunk() -> None:
    manager, _ = _build_model_manager_bundle(
        provider_type=ProviderType.SYSTEM,
        restrict_models=[RestrictModel(model="tts-model", model_type=ModelType.TTS)],
        model_type=ModelType.TTS,
    )
    model_instance = manager.get_model_instance("tenant-1", "openai", ModelType.TTS, "tts-model")
    reservation = MagicMock()
    events: list[str] = []
    reservation.commit.side_effect = lambda: events.append("commit")

    def provider_stream():
        events.append("provider")
        yield b"audio"

    with (
        patch.object(model_instance, "reserve_quota", return_value=reservation),
        patch.object(ModelInstance, "invoke_tts", return_value=provider_stream()),
    ):
        response = iter(model_instance.invoke_tts(content_text="hello", voice="voice"))
        assert next(response) == b"audio"
        events.append("delivered")
        with pytest.raises(StopIteration):
            next(response)

    assert events == ["provider", "commit", "delivered"]
    reservation.commit.assert_called_once_with()
    reservation.release.assert_called_once_with()


def test_quota_managed_tts_releases_when_provider_fails_before_first_chunk() -> None:
    manager, _ = _build_model_manager_bundle(
        provider_type=ProviderType.SYSTEM,
        restrict_models=[RestrictModel(model="tts-model", model_type=ModelType.TTS)],
        model_type=ModelType.TTS,
    )
    model_instance = manager.get_model_instance("tenant-1", "openai", ModelType.TTS, "tts-model")
    reservation = MagicMock()

    def failing_stream():
        raise RuntimeError("provider failed")
        yield b""

    with (
        patch.object(model_instance, "reserve_quota", return_value=reservation),
        patch.object(ModelInstance, "invoke_tts", return_value=failing_stream()),
        pytest.raises(RuntimeError, match="provider failed"),
    ):
        list(model_instance.invoke_tts(content_text="hello"))

    reservation.commit.assert_not_called()
    reservation.release.assert_called_once_with()


def test_quota_managed_non_inference_helper_does_not_reserve_quota() -> None:
    manager, _ = _build_model_manager_bundle(
        provider_type=ProviderType.SYSTEM,
        restrict_models=[RestrictModel(model="embedding-model", model_type=ModelType.TEXT_EMBEDDING)],
        model_type=ModelType.TEXT_EMBEDDING,
    )
    model_instance = manager.get_model_instance("tenant-1", "openai", ModelType.TEXT_EMBEDDING, "embedding-model")

    with (
        patch.object(model_instance, "reserve_quota") as reserve,
        patch.object(ModelInstance, "get_text_embedding_num_tokens", return_value=[1]) as count_tokens,
    ):
        result = model_instance.get_text_embedding_num_tokens(["hello"])

    assert result == [1]
    count_tokens.assert_called_once_with(["hello"])
    reserve.assert_not_called()


def test_lb_model_manager_fetch_next(mocker: MockerFixture, lb_model_manager: LBModelManager):
    # initialize redis client
    redis_client.initialize(redis.Redis())

    assert len(lb_model_manager._load_balancing_configs) == 3

    config1 = lb_model_manager._load_balancing_configs[0]
    config2 = lb_model_manager._load_balancing_configs[1]
    config3 = lb_model_manager._load_balancing_configs[2]

    assert lb_model_manager.in_cooldown(config1) is True
    assert lb_model_manager.in_cooldown(config2) is False
    assert lb_model_manager.in_cooldown(config3) is False

    start_index = 0

    def incr(key):
        nonlocal start_index
        start_index += 1
        return start_index

    with (
        patch.object(redis_client, "incr", side_effect=incr),
        patch.object(redis_client, "set", return_value=None),
        patch.object(redis_client, "expire", return_value=None),
    ):
        config = lb_model_manager.fetch_next()
        assert config == config2

        config = lb_model_manager.fetch_next()
        assert config == config3
