import datetime
import uuid
from types import SimpleNamespace
from unittest.mock import MagicMock, Mock, patch

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
    def test_fetch_plugin_model_providers_returns_cached_provider_without_calling_daemon(self) -> None:
        """A valid tenant cache entry is reused across runtime calls without plugin daemon access."""
        cached_provider = _build_provider_entity()
        cached_payload = TypeAdapter(list[ProviderEntity]).dump_json([cached_provider]).decode("utf-8")

        with patch(f"{MODULE}.redis_client") as redis_client:
            redis_client.get.return_value = cached_payload

            from core.plugin.plugin_service import PluginService

            client = Mock()
            result = PluginService.fetch_plugin_model_providers(tenant_id="tenant-1", client=client)

        assert [provider.provider for provider in result] == ["langgenius/openai/openai"]
        client.fetch_model_providers.assert_not_called()
        redis_client.setex.assert_not_called()

    def test_fetch_plugin_model_providers_deletes_invalid_cache_and_refetches(self) -> None:
        """Invalid cache payloads are tenant-scoped invalidated before falling back to the daemon."""
        with (
            patch(f"{MODULE}.redis_client") as redis_client,
            patch(f"{MODULE}.dify_config") as mock_config,
        ):
            redis_client.get.return_value = "not-json"
            mock_config.PLUGIN_MODEL_PROVIDERS_CACHE_TTL = 86400
            client = Mock()
            client.fetch_model_providers.return_value = [_build_plugin_model_provider()]

            from core.plugin.plugin_service import PluginService

            result = PluginService.fetch_plugin_model_providers(tenant_id="tenant-1", client=client)

        cache_key = "plugin_model_providers:tenant_id:tenant-1"
        redis_client.delete.assert_called_once_with(cache_key)
        redis_client.setex.assert_called_once()
        assert redis_client.setex.call_args.args[0] == cache_key
        assert redis_client.setex.call_args.args[1] == 86400
        assert [provider.provider for provider in result] == ["langgenius/openai/openai"]

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

    def test_fetch_plugin_model_providers_returns_fresh_result_when_cache_write_fails(self) -> None:
        """Redis write failures are non-fatal after fresh provider data has been fetched."""
        with patch(f"{MODULE}.redis_client") as redis_client:
            redis_client.get.return_value = None
            redis_client.setex.side_effect = RedisError("redis unavailable")
            client = Mock()
            client.fetch_model_providers.return_value = [_build_plugin_model_provider()]

            from core.plugin.plugin_service import PluginService

            result = PluginService.fetch_plugin_model_providers(tenant_id="tenant-1", client=client)

        client.fetch_model_providers.assert_called_once_with("tenant-1")
        assert [provider.provider for provider in result] == ["langgenius/openai/openai"]

    def test_fetch_plugin_model_providers_creates_default_client_on_cache_miss(self) -> None:
        """The service owns plugin daemon access when no runtime-provided client is injected."""
        with (
            patch(f"{MODULE}.redis_client") as redis_client,
            patch(f"{MODULE}.PluginModelClient") as client_cls,
        ):
            redis_client.get.return_value = None
            client = client_cls.return_value
            client.fetch_model_providers.return_value = [_build_plugin_model_provider()]

            from core.plugin.plugin_service import PluginService

            result = PluginService.fetch_plugin_model_providers(tenant_id="tenant-1")

        client_cls.assert_called_once_with()
        client.fetch_model_providers.assert_called_once_with("tenant-1")
        assert [provider.provider for provider in result] == ["langgenius/openai/openai"]

    def test_invalidate_plugin_model_providers_cache_uses_tenant_cache_key(self) -> None:
        with patch(f"{MODULE}.redis_client") as redis_client:
            from core.plugin.plugin_service import PluginService

            PluginService.invalidate_plugin_model_providers_cache("tenant-1")

        redis_client.delete.assert_called_once_with("plugin_model_providers:tenant_id:tenant-1")

    def test_invalidate_plugin_model_providers_cache_ignores_redis_delete_failure(self) -> None:
        with patch(f"{MODULE}.redis_client") as redis_client:
            redis_client.delete.side_effect = RedisError("redis unavailable")

            from core.plugin.plugin_service import PluginService

            PluginService.invalidate_plugin_model_providers_cache("tenant-1")

        redis_client.delete.assert_called_once_with("plugin_model_providers:tenant_id:tenant-1")


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
