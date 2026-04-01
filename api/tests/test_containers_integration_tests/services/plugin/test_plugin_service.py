"""Tests for services.plugin.plugin_service.PluginService.

Covers: version caching with Redis, install permission/scope gates,
icon URL construction, asset retrieval with MIME guessing, plugin
verification, marketplace upgrade flows, and uninstall with credential cleanup.
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest
from sqlalchemy import select

from core.plugin.entities.plugin import PluginInstallationSource
from core.plugin.entities.plugin_daemon import PluginVerification
from models.provider import Provider, ProviderCredential, TenantPreferredModelProvider
from services.errors.plugin import PluginInstallationForbiddenError
from services.feature_service import PluginInstallationScope
from services.plugin.plugin_service import PluginService


def _make_features(
    restrict_to_marketplace: bool = False,
    scope: PluginInstallationScope = PluginInstallationScope.ALL,
) -> MagicMock:
    features = MagicMock()
    features.plugin_installation_permission.restrict_to_marketplace_only = restrict_to_marketplace
    features.plugin_installation_permission.plugin_installation_scope = scope
    return features


class TestFetchLatestPluginVersion:
    @patch("services.plugin.plugin_service.marketplace")
    @patch("services.plugin.plugin_service.redis_client")
    def test_returns_cached_version(self, mock_redis, mock_marketplace):
        cached_json = PluginService.LatestPluginCache(
            plugin_id="p1",
            version="1.0.0",
            unique_identifier="uid-1",
            status="active",
            deprecated_reason="",
            alternative_plugin_id="",
        ).model_dump_json()
        mock_redis.get.return_value = cached_json

        result = PluginService.fetch_latest_plugin_version(["p1"])

        assert result["p1"].version == "1.0.0"
        mock_marketplace.batch_fetch_plugin_manifests.assert_not_called()

    @patch("services.plugin.plugin_service.marketplace")
    @patch("services.plugin.plugin_service.redis_client")
    def test_fetches_from_marketplace_on_cache_miss(self, mock_redis, mock_marketplace):
        mock_redis.get.return_value = None
        manifest = MagicMock()
        manifest.plugin_id = "p1"
        manifest.latest_version = "2.0.0"
        manifest.latest_package_identifier = "uid-2"
        manifest.status = "active"
        manifest.deprecated_reason = ""
        manifest.alternative_plugin_id = ""
        mock_marketplace.batch_fetch_plugin_manifests.return_value = [manifest]

        result = PluginService.fetch_latest_plugin_version(["p1"])

        assert result["p1"].version == "2.0.0"
        mock_redis.setex.assert_called_once()

    @patch("services.plugin.plugin_service.marketplace")
    @patch("services.plugin.plugin_service.redis_client")
    def test_returns_none_for_unknown_plugin(self, mock_redis, mock_marketplace):
        mock_redis.get.return_value = None
        mock_marketplace.batch_fetch_plugin_manifests.return_value = []

        result = PluginService.fetch_latest_plugin_version(["unknown"])

        assert result["unknown"] is None

    @patch("services.plugin.plugin_service.marketplace")
    @patch("services.plugin.plugin_service.redis_client")
    def test_handles_marketplace_exception_gracefully(self, mock_redis, mock_marketplace):
        mock_redis.get.return_value = None
        mock_marketplace.batch_fetch_plugin_manifests.side_effect = RuntimeError("network error")

        result = PluginService.fetch_latest_plugin_version(["p1"])

        assert result == {}


class TestCheckMarketplaceOnlyPermission:
    @patch("services.plugin.plugin_service.FeatureService")
    def test_raises_when_restricted(self, mock_fs):
        mock_fs.get_system_features.return_value = _make_features(restrict_to_marketplace=True)

        with pytest.raises(PluginInstallationForbiddenError):
            PluginService._check_marketplace_only_permission()

    @patch("services.plugin.plugin_service.FeatureService")
    def test_passes_when_not_restricted(self, mock_fs):
        mock_fs.get_system_features.return_value = _make_features(restrict_to_marketplace=False)

        PluginService._check_marketplace_only_permission()  # should not raise


class TestCheckPluginInstallationScope:
    @patch("services.plugin.plugin_service.FeatureService")
    def test_official_only_allows_langgenius(self, mock_fs):
        mock_fs.get_system_features.return_value = _make_features(scope=PluginInstallationScope.OFFICIAL_ONLY)
        verification = MagicMock()
        verification.authorized_category = PluginVerification.AuthorizedCategory.Langgenius

        PluginService._check_plugin_installation_scope(verification)  # should not raise

    @patch("services.plugin.plugin_service.FeatureService")
    def test_official_only_rejects_third_party(self, mock_fs):
        mock_fs.get_system_features.return_value = _make_features(scope=PluginInstallationScope.OFFICIAL_ONLY)

        with pytest.raises(PluginInstallationForbiddenError):
            PluginService._check_plugin_installation_scope(None)

    @patch("services.plugin.plugin_service.FeatureService")
    def test_official_and_partners_allows_partner(self, mock_fs):
        mock_fs.get_system_features.return_value = _make_features(
            scope=PluginInstallationScope.OFFICIAL_AND_SPECIFIC_PARTNERS
        )
        verification = MagicMock()
        verification.authorized_category = PluginVerification.AuthorizedCategory.Partner

        PluginService._check_plugin_installation_scope(verification)  # should not raise

    @patch("services.plugin.plugin_service.FeatureService")
    def test_official_and_partners_rejects_none(self, mock_fs):
        mock_fs.get_system_features.return_value = _make_features(
            scope=PluginInstallationScope.OFFICIAL_AND_SPECIFIC_PARTNERS
        )

        with pytest.raises(PluginInstallationForbiddenError):
            PluginService._check_plugin_installation_scope(None)

    @patch("services.plugin.plugin_service.FeatureService")
    def test_none_scope_always_raises(self, mock_fs):
        mock_fs.get_system_features.return_value = _make_features(scope=PluginInstallationScope.NONE)
        verification = MagicMock()
        verification.authorized_category = PluginVerification.AuthorizedCategory.Langgenius

        with pytest.raises(PluginInstallationForbiddenError):
            PluginService._check_plugin_installation_scope(verification)

    @patch("services.plugin.plugin_service.FeatureService")
    def test_all_scope_passes_any(self, mock_fs):
        mock_fs.get_system_features.return_value = _make_features(scope=PluginInstallationScope.ALL)

        PluginService._check_plugin_installation_scope(None)  # should not raise


class TestGetPluginIconUrl:
    @patch("services.plugin.plugin_service.dify_config")
    def test_constructs_url_with_params(self, mock_config):
        mock_config.CONSOLE_API_URL = "https://console.example.com"

        url = PluginService.get_plugin_icon_url("tenant-1", "icon.svg")

        assert "tenant_id=tenant-1" in url
        assert "filename=icon.svg" in url
        assert "/plugin/icon" in url


class TestGetAsset:
    @patch("services.plugin.plugin_service.PluginAssetManager")
    def test_returns_bytes_and_guessed_mime(self, mock_asset_cls):
        mock_asset_cls.return_value.fetch_asset.return_value = b"<svg/>"

        data, mime = PluginService.get_asset("t1", "icon.svg")

        assert data == b"<svg/>"
        assert "svg" in mime

    @patch("services.plugin.plugin_service.PluginAssetManager")
    def test_fallback_to_octet_stream_for_unknown(self, mock_asset_cls):
        mock_asset_cls.return_value.fetch_asset.return_value = b"\x00"

        _, mime = PluginService.get_asset("t1", "unknown_file")

        assert mime == "application/octet-stream"


class TestIsPluginVerified:
    @patch("services.plugin.plugin_service.PluginInstaller")
    def test_returns_true_when_verified(self, mock_installer_cls):
        mock_installer_cls.return_value.fetch_plugin_manifest.return_value.verified = True

        assert PluginService.is_plugin_verified("t1", "uid-1") is True

    @patch("services.plugin.plugin_service.PluginInstaller")
    def test_returns_false_on_exception(self, mock_installer_cls):
        mock_installer_cls.return_value.fetch_plugin_manifest.side_effect = RuntimeError("not found")

        assert PluginService.is_plugin_verified("t1", "uid-1") is False


class TestUpgradePluginWithMarketplace:
    @patch("services.plugin.plugin_service.dify_config")
    def test_raises_when_marketplace_disabled(self, mock_config):
        mock_config.MARKETPLACE_ENABLED = False

        with pytest.raises(ValueError, match="marketplace is not enabled"):
            PluginService.upgrade_plugin_with_marketplace("t1", "old-uid", "new-uid")

    @patch("services.plugin.plugin_service.dify_config")
    def test_raises_when_same_identifier(self, mock_config):
        mock_config.MARKETPLACE_ENABLED = True

        with pytest.raises(ValueError, match="same plugin"):
            PluginService.upgrade_plugin_with_marketplace("t1", "same-uid", "same-uid")

    @patch("services.plugin.plugin_service.marketplace")
    @patch("services.plugin.plugin_service.FeatureService")
    @patch("services.plugin.plugin_service.PluginInstaller")
    @patch("services.plugin.plugin_service.dify_config")
    def test_skips_download_when_already_installed(self, mock_config, mock_installer_cls, mock_fs, mock_marketplace):
        mock_config.MARKETPLACE_ENABLED = True
        mock_fs.get_system_features.return_value = _make_features()
        installer = mock_installer_cls.return_value
        installer.fetch_plugin_manifest.return_value = MagicMock()
        installer.upgrade_plugin.return_value = MagicMock()

        PluginService.upgrade_plugin_with_marketplace("t1", "old-uid", "new-uid")

        mock_marketplace.record_install_plugin_event.assert_called_once_with("new-uid")
        installer.upgrade_plugin.assert_called_once()

    @patch("services.plugin.plugin_service.download_plugin_pkg")
    @patch("services.plugin.plugin_service.FeatureService")
    @patch("services.plugin.plugin_service.PluginInstaller")
    @patch("services.plugin.plugin_service.dify_config")
    def test_downloads_when_not_installed(self, mock_config, mock_installer_cls, mock_fs, mock_download):
        mock_config.MARKETPLACE_ENABLED = True
        mock_fs.get_system_features.return_value = _make_features()
        installer = mock_installer_cls.return_value
        installer.fetch_plugin_manifest.side_effect = RuntimeError("not found")
        mock_download.return_value = b"pkg-bytes"
        upload_resp = MagicMock()
        upload_resp.verification = None
        installer.upload_pkg.return_value = upload_resp
        installer.upgrade_plugin.return_value = MagicMock()

        PluginService.upgrade_plugin_with_marketplace("t1", "old-uid", "new-uid")

        mock_download.assert_called_once_with("new-uid")
        installer.upload_pkg.assert_called_once()


class TestUpgradePluginWithGithub:
    @patch("services.plugin.plugin_service.FeatureService")
    @patch("services.plugin.plugin_service.PluginInstaller")
    def test_checks_marketplace_permission_and_delegates(self, mock_installer_cls, mock_fs):
        mock_fs.get_system_features.return_value = _make_features()
        installer = mock_installer_cls.return_value
        installer.upgrade_plugin.return_value = MagicMock()

        PluginService.upgrade_plugin_with_github("t1", "old-uid", "new-uid", "org/repo", "v1", "pkg.difypkg")

        installer.upgrade_plugin.assert_called_once()
        call_args = installer.upgrade_plugin.call_args
        assert call_args[0][3] == PluginInstallationSource.Github


class TestUploadPkg:
    @patch("services.plugin.plugin_service.FeatureService")
    @patch("services.plugin.plugin_service.PluginInstaller")
    def test_runs_permission_and_scope_checks(self, mock_installer_cls, mock_fs):
        mock_fs.get_system_features.return_value = _make_features()
        upload_resp = MagicMock()
        upload_resp.verification = None
        mock_installer_cls.return_value.upload_pkg.return_value = upload_resp

        result = PluginService.upload_pkg("t1", b"pkg-bytes")

        assert result is upload_resp


class TestInstallFromMarketplacePkg:
    @patch("services.plugin.plugin_service.dify_config")
    def test_raises_when_marketplace_disabled(self, mock_config):
        mock_config.MARKETPLACE_ENABLED = False

        with pytest.raises(ValueError, match="marketplace is not enabled"):
            PluginService.install_from_marketplace_pkg("t1", ["uid-1"])

    @patch("services.plugin.plugin_service.download_plugin_pkg")
    @patch("services.plugin.plugin_service.FeatureService")
    @patch("services.plugin.plugin_service.PluginInstaller")
    @patch("services.plugin.plugin_service.dify_config")
    def test_downloads_when_not_cached(self, mock_config, mock_installer_cls, mock_fs, mock_download):
        mock_config.MARKETPLACE_ENABLED = True
        mock_fs.get_system_features.return_value = _make_features()
        installer = mock_installer_cls.return_value
        installer.fetch_plugin_manifest.side_effect = RuntimeError("not found")
        mock_download.return_value = b"pkg"
        upload_resp = MagicMock()
        upload_resp.verification = None
        upload_resp.unique_identifier = "resolved-uid"
        installer.upload_pkg.return_value = upload_resp
        installer.install_from_identifiers.return_value = "task-id"

        result = PluginService.install_from_marketplace_pkg("t1", ["uid-1"])

        assert result == "task-id"
        installer.install_from_identifiers.assert_called_once()
        call_args = installer.install_from_identifiers.call_args[0]
        assert call_args[1] == ["resolved-uid"]

    @patch("services.plugin.plugin_service.FeatureService")
    @patch("services.plugin.plugin_service.PluginInstaller")
    @patch("services.plugin.plugin_service.dify_config")
    def test_uses_cached_when_already_downloaded(self, mock_config, mock_installer_cls, mock_fs):
        mock_config.MARKETPLACE_ENABLED = True
        mock_fs.get_system_features.return_value = _make_features()
        installer = mock_installer_cls.return_value
        installer.fetch_plugin_manifest.return_value = MagicMock()
        decode_resp = MagicMock()
        decode_resp.verification = None
        installer.decode_plugin_from_identifier.return_value = decode_resp
        installer.install_from_identifiers.return_value = "task-id"

        PluginService.install_from_marketplace_pkg("t1", ["uid-1"])

        installer.install_from_identifiers.assert_called_once()
        call_args = installer.install_from_identifiers.call_args[0]
        assert call_args[1] == ["uid-1"]


class TestUninstall:
    @patch("services.plugin.plugin_service.PluginInstaller")
    def test_direct_uninstall_when_plugin_not_found(self, mock_installer_cls):
        installer = mock_installer_cls.return_value
        installer.list_plugins.return_value = []
        installer.uninstall.return_value = True

        result = PluginService.uninstall("t1", "install-1")

        assert result is True
        installer.uninstall.assert_called_once_with("t1", "install-1")

    @patch("services.plugin.plugin_service.PluginInstaller")
    def test_cleans_credentials_when_plugin_found(
        self, mock_installer_cls, flask_app_with_containers, db_session_with_containers
    ):
        tenant_id = str(uuid4())
        plugin_id = "org/myplugin"
        provider_name = f"{plugin_id}/model-provider"

        credential = ProviderCredential(
            tenant_id=tenant_id,
            provider_name=provider_name,
            credential_name="default",
            encrypted_config="{}",
        )
        db_session_with_containers.add(credential)
        db_session_with_containers.flush()
        credential_id = credential.id

        provider = Provider(
            tenant_id=tenant_id,
            provider_name=provider_name,
            credential_id=credential_id,
        )
        db_session_with_containers.add(provider)
        db_session_with_containers.flush()
        provider_id = provider.id

        pref = TenantPreferredModelProvider(
            tenant_id=tenant_id,
            provider_name=provider_name,
            preferred_provider_type="custom",
        )
        db_session_with_containers.add(pref)
        db_session_with_containers.commit()

        plugin = MagicMock()
        plugin.installation_id = "install-1"
        plugin.plugin_id = plugin_id
        installer = mock_installer_cls.return_value
        installer.list_plugins.return_value = [plugin]
        installer.uninstall.return_value = True

        with patch("services.plugin.plugin_service.dify_config") as mock_config:
            mock_config.ENTERPRISE_ENABLED = False
            result = PluginService.uninstall(tenant_id, "install-1")

        assert result is True
        installer.uninstall.assert_called_once()

        db_session_with_containers.expire_all()

        remaining_creds = db_session_with_containers.scalars(
            select(ProviderCredential).where(ProviderCredential.id == credential_id)
        ).all()
        assert len(remaining_creds) == 0

        updated_provider = db_session_with_containers.get(Provider, provider_id)
        assert updated_provider is not None
        assert updated_provider.credential_id is None

        remaining_prefs = db_session_with_containers.scalars(
            select(TenantPreferredModelProvider).where(
                TenantPreferredModelProvider.tenant_id == tenant_id,
                TenantPreferredModelProvider.provider_name == provider_name,
            )
        ).all()
        assert len(remaining_prefs) == 0
