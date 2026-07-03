import datetime
import uuid
from types import SimpleNamespace
from unittest.mock import MagicMock, Mock, call, patch

import pytest
import zstandard
from pydantic import TypeAdapter
from redis import RedisError

from core.plugin.entities.plugin_daemon import PluginInstallTask, PluginInstallTaskStatus, PluginModelProviderEntity
from graphon.model_runtime.entities.common_entities import I18nObject
from graphon.model_runtime.entities.provider_entities import ConfigurateMethod, ProviderEntity

MODULE = "core.plugin.plugin_service"


class _FakeSession:
    def __init__(self) -> None:
        self.execute = Mock()
        self.scalars = Mock(return_value=SimpleNamespace(all=Mock(return_value=[])))

    def __enter__(self) -> "_FakeSession":
        return self

    def __exit__(self, exc_type, exc, traceback) -> None:
        return None

    def begin(self) -> "_FakeSession":
        return self


def _build_provider_entity(provider: str = "openai") -> ProviderEntity:
    return ProviderEntity(
        provider=f"langgenius/{provider}/{provider}",
        label=I18nObject(en_US=provider.title()),
        supported_model_types=[],
        configurate_methods=[ConfigurateMethod.PREDEFINED_MODEL],
    )


def _build_plugin_model_provider(*, tenant_id: str = "tenant-1", provider: str = "openai") -> PluginModelProviderEntity:
    return PluginModelProviderEntity(
        id=uuid.uuid4().hex,
        created_at=datetime.datetime.now(),
        updated_at=datetime.datetime.now(),
        provider=provider,
        tenant_id=tenant_id,
        plugin_unique_identifier=f"langgenius/{provider}/{provider}",
        plugin_id=f"langgenius/{provider}",
        declaration=ProviderEntity(
            provider=provider,
            label=I18nObject(en_US=provider.title()),
            supported_model_types=[],
            configurate_methods=[ConfigurateMethod.PREDEFINED_MODEL],
        ),
    )


def _build_install_task(*, task_id: str = "task-1", status: PluginInstallTaskStatus) -> PluginInstallTask:
    now = datetime.datetime.now()
    return PluginInstallTask(
        id=task_id,
        created_at=now,
        updated_at=now,
        status=status,
        total_plugins=1,
        completed_plugins=1 if status != PluginInstallTaskStatus.Pending else 0,
        plugins=[],
    )


def _provider_cache_key(tenant_id: str, generation: int | None = None) -> str:
    if generation is None:
        return f"plugin_model_providers:tenant_id:{tenant_id}"

    return f"plugin_model_providers:tenant_id:{tenant_id}:generation:{generation}"


def _provider_generation_key(tenant_id: str) -> str:
    return f"plugin_model_providers_generation:tenant_id:{tenant_id}"


class TestFetchLatestPluginVersion:
    def test_skips_marketplace_fetch_when_disabled(self) -> None:
        """Cache misses stay None; marketplace is never called when disabled."""
        with (
            patch(f"{MODULE}.dify_config") as mock_cfg,
            patch(f"{MODULE}.redis_client") as mock_redis,
            patch(f"{MODULE}.marketplace") as mock_marketplace,
        ):
            mock_cfg.MARKETPLACE_ENABLED = False
            mock_redis.get.return_value = None  # all cache misses

            from core.plugin.plugin_service import PluginService

            result = PluginService.fetch_latest_plugin_version(["langgenius/openai", "langgenius/anthropic"])

        mock_marketplace.batch_fetch_plugin_manifests.assert_not_called()
        assert result == {"langgenius/openai": None, "langgenius/anthropic": None}

    def test_calls_marketplace_fetch_when_enabled(self) -> None:
        """Cache misses trigger marketplace fetch when enabled."""
        manifest = MagicMock()
        manifest.plugin_id = "langgenius/openai"
        manifest.latest_version = "1.0.0"
        manifest.latest_package_identifier = "langgenius/openai:1.0.0@abc"
        manifest.status = "active"
        manifest.deprecated_reason = ""
        manifest.alternative_plugin_id = ""

        with (
            patch(f"{MODULE}.dify_config") as mock_cfg,
            patch(f"{MODULE}.redis_client") as mock_redis,
            patch(f"{MODULE}.marketplace") as mock_marketplace,
        ):
            mock_cfg.MARKETPLACE_ENABLED = True
            mock_redis.get.return_value = None
            mock_marketplace.batch_fetch_plugin_manifests.return_value = [manifest]

            from core.plugin.plugin_service import PluginService

            result = PluginService.fetch_latest_plugin_version(["langgenius/openai"])

        # The list arg is mutated by remove() after the call, so check call count + result.
        mock_marketplace.batch_fetch_plugin_manifests.assert_called_once()
        assert result["langgenius/openai"] is not None
        assert result["langgenius/openai"].version == "1.0.0"


class TestPluginModelProviderCache:
    def test_store_cached_plugin_model_providers_compresses_large_payload(self) -> None:
        """Large provider metadata payloads are compressed before being stored in Redis."""
        large_provider = _build_provider_entity()
        large_provider.label = I18nObject(en_US="OpenAI " * 10000)
        raw_payload = TypeAdapter(list[ProviderEntity]).dump_json([large_provider])
        cache_key = _provider_cache_key("tenant-1", 0)

        with (
            patch(f"{MODULE}.redis_client") as redis_client,
            patch(f"{MODULE}.dify_config") as mock_config,
        ):
            mock_config.PLUGIN_MODEL_PROVIDERS_CACHE_TTL = 86400

            from core.plugin.plugin_service import PluginService

            PluginService._store_cached_plugin_model_providers("tenant-1", 0, [large_provider])

        redis_client.setex.assert_called_once()
        stored_key, ttl, stored_payload = redis_client.setex.call_args.args
        assert stored_key == cache_key
        assert ttl == 86400
        assert isinstance(stored_payload, bytes)
        prefix = PluginService.PLUGIN_MODEL_PROVIDERS_CACHE_COMPRESSION_PREFIX
        assert stored_payload.startswith(prefix)
        assert len(stored_payload) < len(raw_payload)
        assert zstandard.decompress(stored_payload[len(prefix) :]) == raw_payload

    def test_fetch_plugin_model_providers_reads_compressed_cached_provider_without_calling_daemon(self) -> None:
        """Compressed tenant cache entries are decoded before provider schema validation."""
        cached_provider = _build_provider_entity()
        cached_provider.label = I18nObject(en_US="OpenAI " * 10000)
        cached_payload = TypeAdapter(list[ProviderEntity]).dump_json([cached_provider])
        generation_key = _provider_generation_key("tenant-1")
        cache_key = _provider_cache_key("tenant-1", 0)

        from core.plugin.plugin_service import PluginService

        compressed_payload = PluginService.PLUGIN_MODEL_PROVIDERS_CACHE_COMPRESSION_PREFIX + zstandard.compress(
            cached_payload, level=1
        )

        with patch(f"{MODULE}.redis_client") as redis_client:
            redis_client.get.return_value = None
            redis_client.mget.return_value = [compressed_payload]
            client = Mock()

            result = PluginService.fetch_plugin_model_providers(tenant_id="tenant-1", client=client)

        assert [provider.provider for provider in result] == ["langgenius/openai/openai"]
        assert result[0].label.en_us == "OpenAI " * 10000
        client.fetch_model_providers.assert_not_called()
        redis_client.setex.assert_not_called()
        redis_client.get.assert_called_once_with(generation_key)
        redis_client.mget.assert_called_once_with([cache_key])

    def test_fetch_plugin_model_providers_returns_cached_provider_without_calling_daemon(self) -> None:
        """A valid tenant cache entry is reused across runtime calls without plugin daemon access."""
        cached_provider = _build_provider_entity()
        cached_payload = TypeAdapter(list[ProviderEntity]).dump_json([cached_provider])
        generation_key = _provider_generation_key("tenant-1")
        cache_key = _provider_cache_key("tenant-1", 0)

        with patch(f"{MODULE}.redis_client") as redis_client:
            redis_client.get.return_value = None
            redis_client.mget.return_value = [cached_payload]

            from core.plugin.plugin_service import PluginService

            client = Mock()
            result = PluginService.fetch_plugin_model_providers(tenant_id="tenant-1", client=client)

        assert [provider.provider for provider in result] == ["langgenius/openai/openai"]
        client.fetch_model_providers.assert_not_called()
        redis_client.setex.assert_not_called()
        redis_client.get.assert_called_once_with(generation_key)
        redis_client.mget.assert_called_once_with([cache_key])

    def test_fetch_plugin_model_providers_deletes_invalid_cache_and_refetches(self) -> None:
        """Invalid generation-scoped cache payloads are removed before falling back to the daemon."""
        generation_key = _provider_generation_key("tenant-1")
        cache_key = _provider_cache_key("tenant-1", 0)
        with (
            patch(f"{MODULE}.redis_client") as redis_client,
            patch(f"{MODULE}.dify_config") as mock_config,
        ):
            redis_client.get.side_effect = [None, None, None]
            redis_client.mget.side_effect = [["not-json"], [None]]
            mock_config.PLUGIN_MODEL_PROVIDERS_CACHE_TTL = 86400
            client = Mock()
            client.fetch_model_providers.return_value = [_build_plugin_model_provider()]

            from core.plugin.plugin_service import PluginService

            result = PluginService.fetch_plugin_model_providers(tenant_id="tenant-1", client=client)

        redis_client.delete.assert_called_once_with(cache_key)
        redis_client.setex.assert_called_once()
        assert redis_client.setex.call_args.args[0] == cache_key
        assert redis_client.setex.call_args.args[1] == 86400
        assert [provider.provider for provider in result] == ["langgenius/openai/openai"]
        redis_client.get.assert_has_calls([call(generation_key), call(generation_key), call(generation_key)])
        assert redis_client.mget.call_args_list == [
            call([cache_key]),
            call([cache_key]),
        ]

    def test_fetch_plugin_model_providers_refetches_when_cache_read_fails(self) -> None:
        """Redis read failures do not block provider discovery for the tenant."""
        with patch(f"{MODULE}.redis_client") as redis_client:
            redis_client.get.side_effect = RedisError("redis unavailable")
            client = Mock()
            client.fetch_model_providers.return_value = [_build_plugin_model_provider()]

            from core.plugin.plugin_service import PluginService

            result = PluginService.fetch_plugin_model_providers(tenant_id="tenant-1", client=client)

        client.fetch_model_providers.assert_called_once_with("tenant-1")
        assert [provider.provider for provider in result] == ["langgenius/openai/openai"]

    def test_fetch_plugin_model_providers_refetches_when_cached_payload_batch_read_fails(self) -> None:
        """Redis mget failures do not block provider discovery for the tenant."""
        cache_key = _provider_cache_key("tenant-1", 0)
        with patch(f"{MODULE}.redis_client") as redis_client:
            redis_client.get.return_value = None
            redis_client.mget.side_effect = RedisError("redis unavailable")
            client = Mock()
            client.fetch_model_providers.return_value = [_build_plugin_model_provider()]

            from core.plugin.plugin_service import PluginService

            result = PluginService.fetch_plugin_model_providers(tenant_id="tenant-1", client=client)

        client.fetch_model_providers.assert_called_once_with("tenant-1")
        redis_client.mget.assert_called_once_with([cache_key])
        assert [provider.provider for provider in result] == ["langgenius/openai/openai"]

    def test_fetch_plugin_model_providers_returns_fresh_result_when_cache_write_fails(self) -> None:
        """Redis write failures are non-fatal after fresh provider data has been fetched."""
        with patch(f"{MODULE}.redis_client") as redis_client:
            redis_client.get.return_value = None
            redis_client.mget.return_value = [None]
            redis_client.setex.side_effect = RedisError("redis unavailable")
            client = Mock()
            client.fetch_model_providers.return_value = [_build_plugin_model_provider()]

            from core.plugin.plugin_service import PluginService

            result = PluginService.fetch_plugin_model_providers(tenant_id="tenant-1", client=client)

        client.fetch_model_providers.assert_called_once_with("tenant-1")
        assert [provider.provider for provider in result] == ["langgenius/openai/openai"]

    def test_fetch_plugin_model_providers_waits_for_concurrent_refresh_cache_fill(self) -> None:
        """A cache miss waits for the active tenant refresh instead of stampeding the daemon."""
        cached_provider = _build_provider_entity()
        cached_payload = TypeAdapter(list[ProviderEntity]).dump_json([cached_provider])
        cache_key = _provider_cache_key("tenant-1", 0)

        with (
            patch(f"{MODULE}.redis_client") as redis_client,
            patch(f"{MODULE}.time.monotonic", return_value=100.0),
        ):
            redis_client.get.return_value = None
            redis_client.mget.side_effect = [[None], [cached_payload]]
            client = Mock()
            client.fetch_model_providers.return_value = [_build_plugin_model_provider(provider="anthropic")]

            from core.plugin.plugin_service import PluginService

            result = PluginService.fetch_plugin_model_providers(tenant_id="tenant-1", client=client)

        redis_client.lock.assert_called_once_with(
            PluginService._get_plugin_model_providers_lock_key("tenant-1", 0),
            timeout=PluginService.PLUGIN_MODEL_PROVIDERS_LOCK_TTL,
            sleep=PluginService.PLUGIN_MODEL_PROVIDERS_LOCK_WAIT_INTERVAL,
        )
        redis_client.lock.return_value.acquire.assert_called_once_with(
            blocking=True,
            blocking_timeout=PluginService.PLUGIN_MODEL_PROVIDERS_LOCK_WAIT_TIMEOUT,
        )
        assert redis_client.mget.call_args_list == [
            call([cache_key]),
            call([cache_key]),
        ]
        redis_client.lock.return_value.release.assert_called_once()
        client.fetch_model_providers.assert_not_called()
        assert [provider.provider for provider in result] == ["langgenius/openai/openai"]

    def test_fetch_plugin_model_providers_falls_back_when_refresh_lock_wait_times_out(self) -> None:
        """A request should stop waiting and fetch directly instead of surfacing lock contention."""
        cache_key = _provider_cache_key("tenant-1", 0)
        with (
            patch(f"{MODULE}.redis_client") as redis_client,
            patch(f"{MODULE}.PluginService.PLUGIN_MODEL_PROVIDERS_LOCK_WAIT_TIMEOUT", 0),
            patch(f"{MODULE}.time.monotonic", return_value=100.0),
        ):
            redis_client.get.return_value = None
            redis_client.mget.return_value = [None]
            redis_client.lock.return_value.acquire.return_value = False
            client = Mock()
            client.fetch_model_providers.return_value = [_build_plugin_model_provider()]

            from core.plugin.plugin_service import PluginService

            result = PluginService.fetch_plugin_model_providers(tenant_id="tenant-1", client=client)

        redis_client.lock.assert_called_once_with(
            PluginService._get_plugin_model_providers_lock_key("tenant-1", 0),
            timeout=PluginService.PLUGIN_MODEL_PROVIDERS_LOCK_TTL,
            sleep=PluginService.PLUGIN_MODEL_PROVIDERS_LOCK_WAIT_INTERVAL,
        )
        redis_client.lock.return_value.acquire.assert_called_once_with(blocking=True, blocking_timeout=0)
        redis_client.lock.return_value.release.assert_not_called()
        client.fetch_model_providers.assert_called_once_with("tenant-1")
        redis_client.setex.assert_called_once()
        assert redis_client.setex.call_args.args[0] == cache_key
        assert [provider.provider for provider in result] == ["langgenius/openai/openai"]

    def test_fetch_plugin_model_providers_restarts_lock_path_after_generation_changes(self) -> None:
        """Waiters re-read provider generation before trying to become the next refresh owner."""
        generation_key = _provider_generation_key("tenant-1")
        stale_cache_key = _provider_cache_key("tenant-1", 0)
        new_cache_key = _provider_cache_key("tenant-1", 1)
        with (
            patch(f"{MODULE}.redis_client") as redis_client,
            patch(f"{MODULE}.time.monotonic", side_effect=[100.0, 100.0, 100.5, 101.0]),
        ):
            redis_client.get.side_effect = [None, b"1", b"1", b"1", b"1"]
            redis_client.mget.side_effect = [[None], [None], [None], [None]]
            client = Mock()
            client.fetch_model_providers.return_value = [_build_plugin_model_provider(provider="anthropic")]

            from core.plugin.plugin_service import PluginService

            result = PluginService.fetch_plugin_model_providers(tenant_id="tenant-1", client=client)

        assert redis_client.get.call_args_list == [
            call(generation_key),
            call(generation_key),
            call(generation_key),
            call(generation_key),
            call(generation_key),
        ]
        assert redis_client.mget.call_args_list == [
            call([stale_cache_key]),
            call([new_cache_key]),
            call([new_cache_key]),
            call([new_cache_key]),
        ]
        assert redis_client.lock.call_args_list == [
            call(
                PluginService._get_plugin_model_providers_lock_key("tenant-1", 0),
                timeout=PluginService.PLUGIN_MODEL_PROVIDERS_LOCK_TTL,
                sleep=PluginService.PLUGIN_MODEL_PROVIDERS_LOCK_WAIT_INTERVAL,
            ),
            call(
                PluginService._get_plugin_model_providers_lock_key("tenant-1", 1),
                timeout=PluginService.PLUGIN_MODEL_PROVIDERS_LOCK_TTL,
                sleep=PluginService.PLUGIN_MODEL_PROVIDERS_LOCK_WAIT_INTERVAL,
            ),
        ]
        assert redis_client.lock.return_value.acquire.call_args_list == [
            call(blocking=True, blocking_timeout=2.0),
            call(blocking=True, blocking_timeout=1.5),
        ]
        assert redis_client.lock.return_value.release.call_count == 2
        client.fetch_model_providers.assert_called_once_with("tenant-1")
        redis_client.setex.assert_called_once()
        assert redis_client.setex.call_args.args[0] == new_cache_key
        assert [provider.provider for provider in result] == ["langgenius/anthropic/anthropic"]

    def test_fetch_plugin_model_providers_falls_back_when_generation_retries_exhaust_wait_budget(self) -> None:
        """Generation retry loops share one request-local lock wait deadline before direct fetch fallback."""
        generation_key = _provider_generation_key("tenant-1")
        stale_cache_key = _provider_cache_key("tenant-1", 0)
        new_cache_key = _provider_cache_key("tenant-1", 1)

        with (
            patch(f"{MODULE}.redis_client") as redis_client,
            patch(f"{MODULE}.time.monotonic", side_effect=[100.0, 100.0, 102.1]),
        ):
            redis_client.get.side_effect = [None, b"1", b"1", b"1"]
            redis_client.mget.side_effect = [[None], [None], [None]]
            client = Mock()
            client.fetch_model_providers.return_value = [_build_plugin_model_provider(provider="anthropic")]

            from core.plugin.plugin_service import PluginService

            result = PluginService.fetch_plugin_model_providers(tenant_id="tenant-1", client=client)

        assert redis_client.get.call_args_list == [
            call(generation_key),
            call(generation_key),
            call(generation_key),
            call(generation_key),
        ]
        assert redis_client.mget.call_args_list == [
            call([stale_cache_key]),
            call([new_cache_key]),
            call([new_cache_key]),
        ]
        redis_client.lock.assert_called_once_with(
            PluginService._get_plugin_model_providers_lock_key("tenant-1", 0),
            timeout=PluginService.PLUGIN_MODEL_PROVIDERS_LOCK_TTL,
            sleep=PluginService.PLUGIN_MODEL_PROVIDERS_LOCK_WAIT_INTERVAL,
        )
        redis_client.lock.return_value.acquire.assert_called_once_with(blocking=True, blocking_timeout=2.0)
        redis_client.lock.return_value.release.assert_called_once()
        client.fetch_model_providers.assert_called_once_with("tenant-1")
        redis_client.setex.assert_called_once()
        assert redis_client.setex.call_args.args[0] == new_cache_key
        assert [provider.provider for provider in result] == ["langgenius/anthropic/anthropic"]

    def test_fetch_plugin_model_providers_releases_owned_refresh_lock_after_store(self) -> None:
        """The refresh owner releases only its token after storing provider metadata."""
        cache_key = _provider_cache_key("tenant-1", 0)

        with (
            patch(f"{MODULE}.redis_client") as redis_client,
            patch(f"{MODULE}.time.monotonic", return_value=100.0),
        ):
            redis_client.get.return_value = None
            redis_client.mget.return_value = [None]
            client = Mock()
            client.fetch_model_providers.return_value = [_build_plugin_model_provider()]

            from core.plugin.plugin_service import PluginService

            result = PluginService.fetch_plugin_model_providers(tenant_id="tenant-1", client=client)

        redis_client.lock.assert_called_once_with(
            PluginService._get_plugin_model_providers_lock_key("tenant-1", 0),
            timeout=PluginService.PLUGIN_MODEL_PROVIDERS_LOCK_TTL,
            sleep=PluginService.PLUGIN_MODEL_PROVIDERS_LOCK_WAIT_INTERVAL,
        )
        redis_client.lock.return_value.acquire.assert_called_once_with(
            blocking=True,
            blocking_timeout=PluginService.PLUGIN_MODEL_PROVIDERS_LOCK_WAIT_TIMEOUT,
        )
        assert redis_client.mget.call_args_list == [
            call([cache_key]),
            call([cache_key]),
        ]
        redis_client.lock.return_value.release.assert_called_once()
        redis_client.eval.assert_not_called()
        client.fetch_model_providers.assert_called_once_with("tenant-1")
        assert [provider.provider for provider in result] == ["langgenius/openai/openai"]

    def test_fetch_plugin_model_providers_returns_fresh_result_when_refresh_lock_release_fails(self) -> None:
        """Release failures are logged, not allowed to hide a successful daemon refresh."""
        cache_key = _provider_cache_key("tenant-1", 0)

        with (
            patch(f"{MODULE}.redis_client") as redis_client,
            patch(f"{MODULE}.time.monotonic", return_value=100.0),
        ):
            redis_client.get.return_value = None
            redis_client.mget.return_value = [None]
            redis_client.lock.return_value.release.side_effect = RedisError("release failed")
            client = Mock()
            client.fetch_model_providers.return_value = [_build_plugin_model_provider()]

            from core.plugin.plugin_service import PluginService

            result = PluginService.fetch_plugin_model_providers(tenant_id="tenant-1", client=client)

        assert redis_client.mget.call_args_list == [
            call([cache_key]),
            call([cache_key]),
        ]
        client.fetch_model_providers.assert_called_once_with("tenant-1")
        redis_client.setex.assert_called_once()
        redis_client.lock.return_value.release.assert_called_once()
        assert [provider.provider for provider in result] == ["langgenius/openai/openai"]

    def test_fetch_plugin_model_providers_releases_owned_refresh_lock_when_fetch_fails(self) -> None:
        """Release failures must not hide the daemon failure that happened while owning the lock."""
        cache_key = _provider_cache_key("tenant-1", 0)

        with (
            patch(f"{MODULE}.redis_client") as redis_client,
            patch(f"{MODULE}.time.monotonic", return_value=100.0),
        ):
            redis_client.get.return_value = None
            redis_client.mget.return_value = [None]
            redis_client.lock.return_value.release.side_effect = RedisError("release failed")
            client = Mock()
            client.fetch_model_providers.side_effect = RuntimeError("daemon failed")

            from core.plugin.plugin_service import PluginService

            with pytest.raises(RuntimeError, match="daemon failed"):
                PluginService.fetch_plugin_model_providers(tenant_id="tenant-1", client=client)

        assert redis_client.mget.call_args_list == [
            call([cache_key]),
            call([cache_key]),
        ]
        client.fetch_model_providers.assert_called_once_with("tenant-1")
        redis_client.setex.assert_not_called()
        redis_client.lock.return_value.release.assert_called_once()

    def test_fetch_plugin_model_providers_falls_back_when_refresh_lock_acquire_fails(self) -> None:
        """Redis acquire failures degrade to a direct daemon fetch instead of hiding provider data."""
        with (
            patch(f"{MODULE}.redis_client") as redis_client,
            patch(f"{MODULE}.time.monotonic", return_value=100.0),
        ):
            redis_client.get.return_value = None
            redis_client.mget.return_value = [None]
            redis_client.lock.return_value.acquire.side_effect = RedisError("redis unavailable")
            client = Mock()
            client.fetch_model_providers.return_value = [_build_plugin_model_provider()]

            from core.plugin.plugin_service import PluginService

            result = PluginService.fetch_plugin_model_providers(tenant_id="tenant-1", client=client)

        redis_client.lock.return_value.acquire.assert_called_once()
        redis_client.lock.return_value.release.assert_not_called()
        client.fetch_model_providers.assert_called_once_with("tenant-1")
        assert [provider.provider for provider in result] == ["langgenius/openai/openai"]

    def test_fetch_plugin_model_providers_skips_wait_when_refresh_lock_fails(self) -> None:
        """Lock API failures should fall back directly instead of adding timeout latency."""
        with (
            patch(f"{MODULE}.redis_client") as redis_client,
            patch(f"{MODULE}.time.sleep") as sleep,
        ):
            redis_client.get.return_value = None
            redis_client.mget.return_value = [None]
            redis_client.lock.side_effect = RedisError("redis unavailable")
            redis_client.set.side_effect = AssertionError("raw redis set must not be used for refresh locks")
            client = Mock()
            client.fetch_model_providers.return_value = [_build_plugin_model_provider()]

            from core.plugin.plugin_service import PluginService

            result = PluginService.fetch_plugin_model_providers(tenant_id="tenant-1", client=client)

        sleep.assert_not_called()
        redis_client.lock.assert_called_once()
        client.fetch_model_providers.assert_called_once_with("tenant-1")
        assert [provider.provider for provider in result] == ["langgenius/openai/openai"]

    def test_fetch_plugin_model_providers_caches_empty_provider_list(self) -> None:
        """An empty provider list is still a valid refresh result for single-flight waiters."""
        cache_key = _provider_cache_key("tenant-1", 0)
        with patch(f"{MODULE}.redis_client") as redis_client:
            redis_client.get.return_value = None
            redis_client.mget.return_value = [None]
            client = Mock()
            client.fetch_model_providers.return_value = []

            from core.plugin.plugin_service import PluginService

            result = PluginService.fetch_plugin_model_providers(tenant_id="tenant-1", client=client)

        assert result == ()
        redis_client.setex.assert_called_once()
        assert redis_client.setex.call_args.args[0] == cache_key
        redis_client.lock.return_value.release.assert_called_once()

    def test_fetch_plugin_model_providers_skips_cache_write_when_generation_changes_during_refresh(self) -> None:
        """A refresh that started before invalidation must not populate the newer generation cache."""
        with patch(f"{MODULE}.redis_client") as redis_client:
            redis_client.get.side_effect = [None, None, "1"]
            redis_client.mget.return_value = [None]
            client = Mock()
            client.fetch_model_providers.return_value = []

            from core.plugin.plugin_service import PluginService

            result = PluginService.fetch_plugin_model_providers(tenant_id="tenant-1", client=client)

        assert result == ()
        client.fetch_model_providers.assert_called_once_with("tenant-1")
        redis_client.setex.assert_not_called()
        redis_client.lock.return_value.release.assert_called_once()

    def test_fetch_plugin_model_providers_reuses_cached_empty_provider_list(self) -> None:
        """A cached empty list should prevent repeated daemon fetches for tenants without plugin models."""
        empty_payload = TypeAdapter(list[ProviderEntity]).dump_json([])
        cache_key = _provider_cache_key("tenant-1", 0)

        with patch(f"{MODULE}.redis_client") as redis_client:
            redis_client.get.return_value = None
            redis_client.mget.return_value = [empty_payload]
            client = Mock()

            from core.plugin.plugin_service import PluginService

            result = PluginService.fetch_plugin_model_providers(tenant_id="tenant-1", client=client)

        assert result == ()
        redis_client.mget.assert_called_once_with([cache_key])
        client.fetch_model_providers.assert_not_called()

    def test_fetch_plugin_model_providers_creates_default_client_on_cache_miss(self) -> None:
        """The service owns plugin daemon access when no runtime-provided client is injected."""
        with (
            patch(f"{MODULE}.redis_client") as redis_client,
            patch(f"{MODULE}.PluginModelClient") as client_cls,
        ):
            redis_client.get.return_value = None
            redis_client.mget.return_value = [None]
            client = client_cls.return_value
            client.fetch_model_providers.return_value = [_build_plugin_model_provider()]

            from core.plugin.plugin_service import PluginService

            result = PluginService.fetch_plugin_model_providers(tenant_id="tenant-1")

        client_cls.assert_called_once_with()
        client.fetch_model_providers.assert_called_once_with("tenant-1")
        assert [provider.provider for provider in result] == ["langgenius/openai/openai"]

    def test_invalidate_plugin_model_providers_cache_uses_redis_pipeline(self) -> None:
        with patch(f"{MODULE}.redis_client") as redis_client:
            pipe = redis_client.pipeline.return_value

            from core.plugin.plugin_service import PluginService

            PluginService.invalidate_plugin_model_providers_cache("tenant-1")

        redis_client.pipeline.assert_called_once_with(transaction=False)
        pipe.delete.assert_called_once_with(_provider_cache_key("tenant-1"))
        pipe.incr.assert_called_once_with(_provider_generation_key("tenant-1"))
        pipe.execute.assert_called_once_with()

    def test_invalidate_plugin_model_providers_cache_ignores_redis_pipeline_failure(self) -> None:
        with patch(f"{MODULE}.redis_client") as redis_client:
            pipe = redis_client.pipeline.return_value
            pipe.execute.side_effect = RedisError("redis unavailable")

            from core.plugin.plugin_service import PluginService

            PluginService.invalidate_plugin_model_providers_cache("tenant-1")

        redis_client.pipeline.assert_called_once_with(transaction=False)
        pipe.delete.assert_called_once_with(_provider_cache_key("tenant-1"))
        pipe.incr.assert_called_once_with(_provider_generation_key("tenant-1"))
        pipe.execute.assert_called_once_with()

    def test_fetch_plugin_model_providers_uses_new_generation_cache_after_generation_bump(self) -> None:
        generation_key = _provider_generation_key("tenant-1")
        new_cache_key = _provider_cache_key("tenant-1", 1)
        with patch(f"{MODULE}.redis_client") as redis_client:
            redis_client.get.side_effect = [b"1", b"1", b"1"]
            redis_client.mget.return_value = [None]
            client = Mock()
            client.fetch_model_providers.return_value = [_build_plugin_model_provider(provider="anthropic")]

            from core.plugin.plugin_service import PluginService

            result = PluginService.fetch_plugin_model_providers(tenant_id="tenant-1", client=client)

        client.fetch_model_providers.assert_called_once_with("tenant-1")
        redis_client.get.assert_has_calls([call(generation_key), call(generation_key), call(generation_key)])
        assert redis_client.mget.call_args_list == [
            call([new_cache_key]),
            call([new_cache_key]),
        ]
        redis_client.setex.assert_called_once()
        assert redis_client.setex.call_args.args[0] == new_cache_key
        redis_client.lock.return_value.acquire.assert_called_once()
        redis_client.lock.return_value.release.assert_called_once()
        assert [provider.provider for provider in result] == ["langgenius/anthropic/anthropic"]


class TestPluginListEndpointCounts:
    def test_list_with_total_reconciles_live_endpoint_counts_for_endpoint_plugins(self) -> None:
        """Endpoint-enabled plugins use plugin-scoped live endpoint records instead of stale daemon aggregates."""
        wecom_plugin = SimpleNamespace(
            plugin_id="langgenius/wecom-bot",
            endpoints_setups=0,
            endpoints_active=0,
            declaration=SimpleNamespace(endpoint=object()),
        )
        tool_plugin = SimpleNamespace(
            plugin_id="langgenius/openai",
            endpoints_setups=0,
            endpoints_active=0,
            declaration=SimpleNamespace(endpoint=None),
        )
        paged_plugins = SimpleNamespace(list=[wecom_plugin, tool_plugin], total=2)
        endpoints = [
            SimpleNamespace(plugin_id="langgenius/wecom-bot", enabled=True),
            SimpleNamespace(plugin_id="langgenius/wecom-bot", enabled=True),
            SimpleNamespace(plugin_id="langgenius/wecom-bot", enabled=True),
        ]

        with (
            patch(f"{MODULE}.PluginInstaller") as installer_cls,
            patch(f"{MODULE}.PluginEndpointClient") as endpoint_client_cls,
        ):
            installer_cls.return_value.list_plugins_with_total.return_value = paged_plugins
            endpoint_client_cls.return_value.list_endpoints_for_single_plugin.return_value = endpoints

            from core.plugin.plugin_service import PluginService

            result = PluginService.list_with_total("tenant-1", "user-1", 1, 100)

        assert result is paged_plugins
        assert wecom_plugin.endpoints_setups == 3
        assert wecom_plugin.endpoints_active == 3
        assert tool_plugin.endpoints_setups == 0
        assert tool_plugin.endpoints_active == 0
        endpoint_client_cls.return_value.list_endpoints_for_single_plugin.assert_called_once_with(
            tenant_id="tenant-1",
            user_id="user-1",
            plugin_id="langgenius/wecom-bot",
            page=1,
            page_size=PluginService.ENDPOINT_RECONCILIATION_PAGE_SIZE,
        )

    def test_list_with_total_falls_back_to_sanitized_daemon_counts_when_reconciliation_fails(self) -> None:
        """Best-effort reconciliation still clamps daemon sentinel values before returning the list response."""
        wecom_plugin = SimpleNamespace(
            plugin_id="langgenius/wecom-bot",
            endpoints_setups=-1,
            endpoints_active=-1,
            declaration=SimpleNamespace(endpoint=object()),
        )
        paged_plugins = SimpleNamespace(list=[wecom_plugin], total=1)

        with (
            patch(f"{MODULE}.PluginInstaller") as installer_cls,
            patch(f"{MODULE}.PluginEndpointClient") as endpoint_client_cls,
        ):
            installer_cls.return_value.list_plugins_with_total.return_value = paged_plugins
            endpoint_client_cls.return_value.list_endpoints_for_single_plugin.side_effect = RuntimeError(
                "endpoint daemon unavailable"
            )

            from core.plugin.plugin_service import PluginService

            result = PluginService.list_with_total("tenant-1", "user-1", 1, 100)

        assert result is paged_plugins
        assert wecom_plugin.endpoints_setups == 0
        assert wecom_plugin.endpoints_active == 0

    def test_list_with_total_clamps_negative_daemon_counts_for_plugins_without_endpoints(self) -> None:
        """Plugins that do not expose endpoint setup APIs must still never return negative counters."""
        tool_plugin = SimpleNamespace(
            plugin_id="langgenius/openai",
            endpoints_setups=-1,
            endpoints_active=-1,
            declaration=SimpleNamespace(endpoint=None),
        )
        paged_plugins = SimpleNamespace(list=[tool_plugin], total=1)

        with patch(f"{MODULE}.PluginInstaller") as installer_cls:
            installer_cls.return_value.list_plugins_with_total.return_value = paged_plugins

            from core.plugin.plugin_service import PluginService

            result = PluginService.list_with_total("tenant-1", "user-1", 1, 100)

        assert result is paged_plugins
        assert tool_plugin.endpoints_setups == 0
        assert tool_plugin.endpoints_active == 0


class TestPluginModelProviderCacheInvalidation:
    def test_fetch_install_task_invalidates_model_provider_cache_when_finished(self) -> None:
        """Finished plugin install tasks invalidate tenant provider cache."""
        task = _build_install_task(status=PluginInstallTaskStatus.Success)

        with (
            patch(f"{MODULE}.PluginInstaller") as installer_cls,
            patch(f"{MODULE}.PluginService.invalidate_plugin_model_providers_cache") as invalidate_cache,
        ):
            installer_cls.return_value.fetch_plugin_installation_task.return_value = task

            from core.plugin.plugin_service import PluginService

            result = PluginService.fetch_install_task("tenant-1", "task-1")

        assert result is task
        invalidate_cache.assert_called_once_with("tenant-1")

    def test_fetch_install_tasks_invalidates_model_provider_cache_for_finished_tasks(self) -> None:
        """Finished tasks from task list polling also invalidate tenant provider cache."""
        task = _build_install_task(status=PluginInstallTaskStatus.Success)

        with (
            patch(f"{MODULE}.PluginInstaller") as installer_cls,
            patch(f"{MODULE}.PluginService.invalidate_plugin_model_providers_cache") as invalidate_cache,
        ):
            installer_cls.return_value.fetch_plugin_installation_tasks.return_value = [task]

            from core.plugin.plugin_service import PluginService

            result = PluginService.fetch_install_tasks("tenant-1", 1, 256)

        assert result == [task]
        invalidate_cache.assert_called_once_with("tenant-1")

    def test_fetch_install_tasks_ignores_running_model_provider_cache_tasks(self) -> None:
        """Running plugin install tasks do not invalidate provider cache until they reach a terminal state."""
        task = _build_install_task(status=PluginInstallTaskStatus.Running)

        with (
            patch(f"{MODULE}.PluginInstaller") as installer_cls,
            patch(f"{MODULE}.PluginService.invalidate_plugin_model_providers_cache") as invalidate_cache,
        ):
            installer_cls.return_value.fetch_plugin_installation_tasks.return_value = [task]

            from core.plugin.plugin_service import PluginService

            result = PluginService.fetch_install_tasks("tenant-1", 1, 256)

        assert result == [task]
        invalidate_cache.assert_not_called()

    def test_upgrade_plugin_with_marketplace_invalidates_model_provider_cache_for_tenant(self) -> None:
        """Marketplace upgrades invalidate only the mutated tenant provider cache."""
        with (
            patch(f"{MODULE}.dify_config") as mock_config,
            patch(f"{MODULE}.FeatureService") as feature_service,
            patch(f"{MODULE}.PluginInstaller") as installer_cls,
            patch(f"{MODULE}.marketplace") as marketplace,
            patch(f"{MODULE}.PluginService.invalidate_plugin_model_providers_cache") as invalidate_cache,
        ):
            mock_config.MARKETPLACE_ENABLED = True
            feature_service.get_system_features.return_value = SimpleNamespace(
                plugin_installation_permission=SimpleNamespace(restrict_to_marketplace_only=False)
            )
            installer = installer_cls.return_value
            installer.fetch_plugin_manifest.return_value = MagicMock()
            installer.upgrade_plugin.return_value = "task-id"

            from core.plugin.plugin_service import PluginService

            result = PluginService.upgrade_plugin_with_marketplace("tenant-1", "old-uid", "new-uid")

        assert result == "task-id"
        marketplace.record_install_plugin_event.assert_called_once_with("new-uid")
        invalidate_cache.assert_called_once_with("tenant-1")

    def test_install_from_local_pkg_invalidates_model_provider_cache_for_tenant(self) -> None:
        """Starting a plugin install invalidates only the mutated tenant provider cache."""
        with (
            patch(f"{MODULE}.PluginService._check_marketplace_only_permission"),
            patch(f"{MODULE}.PluginService._check_plugin_installation_scope"),
            patch(f"{MODULE}.PluginInstaller") as installer_cls,
            patch(f"{MODULE}.PluginService.invalidate_plugin_model_providers_cache") as invalidate_cache,
        ):
            installer = installer_cls.return_value
            decode_response = MagicMock()
            decode_response.verification = None
            installer.decode_plugin_from_identifier.return_value = decode_response
            installer.install_from_identifiers.return_value = "task-id"

            from core.plugin.plugin_service import PluginService

            result = PluginService.install_from_local_pkg("tenant-1", ["langgenius/openai:1.0.0"])

        assert result == "task-id"
        invalidate_cache.assert_called_once_with("tenant-1")

    def test_upgrade_plugin_with_github_invalidates_model_provider_cache_for_tenant(self) -> None:
        """Starting a plugin upgrade invalidates only the mutated tenant provider cache."""
        with (
            patch(f"{MODULE}.PluginService._check_marketplace_only_permission"),
            patch(f"{MODULE}.PluginInstaller") as installer_cls,
            patch(f"{MODULE}.PluginService.invalidate_plugin_model_providers_cache") as invalidate_cache,
        ):
            installer = installer_cls.return_value
            installer.upgrade_plugin.return_value = "task-id"

            from core.plugin.plugin_service import PluginService

            result = PluginService.upgrade_plugin_with_github(
                "tenant-1", "old-uid", "new-uid", "langgenius/openai", "1.0.0", "openai.difypkg"
            )

        assert result == "task-id"
        invalidate_cache.assert_called_once_with("tenant-1")

    def test_install_from_github_invalidates_model_provider_cache_for_tenant(self) -> None:
        """GitHub installs invalidate only the mutated tenant provider cache."""
        with (
            patch(f"{MODULE}.PluginService._check_marketplace_only_permission"),
            patch(f"{MODULE}.PluginService._check_plugin_installation_scope"),
            patch(f"{MODULE}.PluginInstaller") as installer_cls,
            patch(f"{MODULE}.PluginService.invalidate_plugin_model_providers_cache") as invalidate_cache,
        ):
            installer = installer_cls.return_value
            decode_response = MagicMock()
            decode_response.verification = None
            installer.decode_plugin_from_identifier.return_value = decode_response
            installer.install_from_identifiers.return_value = "task-id"

            from core.plugin.plugin_service import PluginService

            result = PluginService.install_from_github(
                "tenant-1", "langgenius/openai:1.0.0", "langgenius/openai", "1.0.0", "openai.difypkg"
            )

        assert result == "task-id"
        invalidate_cache.assert_called_once_with("tenant-1")

    def test_install_from_marketplace_pkg_invalidates_model_provider_cache_for_tenant(self) -> None:
        """Marketplace package installs invalidate only the mutated tenant provider cache."""
        with (
            patch(f"{MODULE}.dify_config") as mock_config,
            patch(f"{MODULE}.FeatureService") as feature_service,
            patch(f"{MODULE}.PluginService._check_plugin_installation_scope"),
            patch(f"{MODULE}.PluginInstaller") as installer_cls,
            patch(f"{MODULE}.PluginService.invalidate_plugin_model_providers_cache") as invalidate_cache,
        ):
            mock_config.MARKETPLACE_ENABLED = True
            feature_service.get_system_features.return_value = SimpleNamespace(
                plugin_installation_permission=SimpleNamespace(restrict_to_marketplace_only=False)
            )
            installer = installer_cls.return_value
            installer.fetch_plugin_manifest.return_value = MagicMock()
            decode_response = MagicMock()
            decode_response.verification = None
            installer.decode_plugin_from_identifier.return_value = decode_response
            installer.install_from_identifiers.return_value = "task-id"

            from core.plugin.plugin_service import PluginService

            result = PluginService.install_from_marketplace_pkg("tenant-1", ["langgenius/openai:1.0.0"])

        assert result == "task-id"
        invalidate_cache.assert_called_once_with("tenant-1")

    def test_uninstall_invalidates_model_provider_cache_for_tenant(self) -> None:
        """Successful uninstall invalidates only the mutated tenant provider cache."""
        with (
            patch(f"{MODULE}.PluginInstaller") as installer_cls,
            patch(f"{MODULE}.PluginService.invalidate_plugin_model_providers_cache") as invalidate_cache,
        ):
            installer = installer_cls.return_value
            installer.list_plugins.return_value = []
            installer.uninstall.return_value = True

            from core.plugin.plugin_service import PluginService

            result = PluginService.uninstall("tenant-1", "installation-1")

        assert result is True
        invalidate_cache.assert_called_once_with("tenant-1")

    def test_uninstall_existing_plugin_invalidates_cache_after_credential_cleanup(self) -> None:
        """Successful uninstall with plugin metadata also invalidates the mutated tenant provider cache."""
        plugin = SimpleNamespace(
            installation_id="installation-1",
            plugin_id="langgenius/openai",
            plugin_unique_identifier="langgenius/openai:1.0.0",
        )
        session = _FakeSession()
        with (
            patch(f"{MODULE}.db", SimpleNamespace(engine=object())),
            patch(f"{MODULE}.dify_config") as mock_config,
            patch(f"{MODULE}.PluginInstaller") as installer_cls,
            patch(f"{MODULE}.Session", return_value=session),
            patch(f"{MODULE}.PluginService.invalidate_plugin_model_providers_cache") as invalidate_cache,
        ):
            mock_config.ENTERPRISE_ENABLED = False
            installer = installer_cls.return_value
            installer.list_plugins.return_value = [plugin]
            installer.uninstall.return_value = True

            from core.plugin.plugin_service import PluginService

            result = PluginService.uninstall("tenant-1", "installation-1")

        assert result is True
        installer.uninstall.assert_called_once_with("tenant-1", "installation-1")
        invalidate_cache.assert_called_once_with("tenant-1")
