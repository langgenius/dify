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
    bundle.model_type_instance.model_type = ModelType.LLM
    provider_manager.get_provider_model_bundle.return_value = bundle
    return ModelManager(provider_manager), bundle


def test_model_manager_wraps_allowlisted_system_llm() -> None:
    manager, _ = _build_model_manager_bundle(
        provider_type=ProviderType.SYSTEM,
        restrict_models=[RestrictModel(model="gpt-4", model_type=ModelType.LLM)],
    )

    model_instance = manager.get_model_instance("tenant-1", "openai", ModelType.LLM, "gpt-4")

    assert isinstance(model_instance, QuotaManagedModelInstance)


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
