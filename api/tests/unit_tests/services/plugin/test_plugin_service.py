from unittest.mock import MagicMock, patch

MODULE = "core.plugin.plugin_service"


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


class TestPluginModelProviderCacheInvalidation:
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
