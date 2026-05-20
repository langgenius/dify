from unittest.mock import MagicMock, patch

MODULE = "services.plugin.plugin_service"


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

            from services.plugin.plugin_service import PluginService

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

            from services.plugin.plugin_service import PluginService

            result = PluginService.fetch_latest_plugin_version(["langgenius/openai"])

        # The list arg is mutated by remove() after the call, so check call count + result.
        mock_marketplace.batch_fetch_plugin_manifests.assert_called_once()
        assert result["langgenius/openai"] is not None
        assert result["langgenius/openai"].version == "1.0.0"
