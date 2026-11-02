"""Preserved legacy download, verification and invalidation tests at their new owner."""

from collections.abc import Callable
from unittest.mock import MagicMock, patch

import pytest

from core.plugin.entities.plugin import PluginInstallationSource
from core.plugin.entities.plugin_daemon import PluginInstallTaskStartResponse, PluginVerification
from enums import DeploymentEdition
from services.entities.feature_entities import PluginInstallationPermissionModel, PluginInstallationScope
from services.errors.plugin import PluginInstallationForbiddenError
from services.plugin.installation_gateway import LegacyPluginInstallationGateway
from tests.unit_tests.services.errors.test_plugin import _make_permission

MODULE = "core.plugin.plugin_service"


def test_actual_daemon_task_dto_preserves_wire_fields_and_utc_timestamps() -> None:
    from datetime import UTC, datetime

    from core.plugin.entities.plugin_daemon import PluginInstallTask, PluginInstallTaskStatus
    from graphon.model_runtime.utils.encoders import jsonable_encoder
    from services.plugin.installation_gateway import _result

    stamp = datetime(2026, 11, 2, tzinfo=UTC)
    task = PluginInstallTask(
        id="owned-task",
        created_at=stamp,
        updated_at=stamp,
        status=PluginInstallTaskStatus.Success,
        total_plugins=1,
        completed_plugins=1,
        plugins=[],
    )
    response = PluginInstallTaskStartResponse(all_installed=False, task_id="owned-task", task=task)
    assert jsonable_encoder(response) == jsonable_encoder(_result(response))


@pytest.fixture(autouse=True)
def _plugin_config(config_overrides: Callable[..., None]) -> None:
    config_overrides(MARKETPLACE_ENABLED=True, DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY)


class TestGatewayCacheInvalidation:
    def test_upgrade_plugin_with_marketplace_invalidates_model_provider_cache_for_tenant(self) -> None:
        """Marketplace upgrades invalidate only the mutated tenant provider cache."""
        with (
            patch(f"{MODULE}.SystemFeatureService") as feature_service,
            patch("services.plugin.installation_gateway.PluginInstaller") as installer_cls,
            patch("services.plugin.installation_gateway.marketplace") as marketplace,
            patch(f"{MODULE}.PluginService.invalidate_plugin_model_providers_cache") as invalidate_cache,
        ):
            feature_service.get_plugin_installation_permission.return_value = PluginInstallationPermissionModel(
                restrict_to_marketplace_only=False,
                plugin_installation_scope=PluginInstallationScope.ALL,
            )
            installer = installer_cls.return_value
            installer.fetch_plugin_manifest.return_value = MagicMock()
            decode_response = MagicMock()
            decode_response.verification = None
            installer.decode_plugin_from_identifier.return_value = decode_response
            installer.upgrade_plugin.return_value = PluginInstallTaskStartResponse(
                all_installed=False, task_id="task-id"
            )

            result = LegacyPluginInstallationGateway.upgrade_plugin_with_marketplace("tenant-1", "old-uid", "new-uid")

        assert result.task_id == "task-id"
        marketplace.record_install_plugin_event.assert_called_once_with("new-uid")
        invalidate_cache.assert_called_once_with("tenant-1")

    def test_install_from_local_pkg_invalidates_model_provider_cache_for_tenant(self) -> None:
        """Starting a plugin install invalidates only the mutated tenant provider cache."""
        with (
            patch(f"{MODULE}.PluginService._check_marketplace_only_permission"),
            patch(f"{MODULE}.PluginService._check_plugin_installation_scope"),
            patch("services.plugin.installation_gateway.PluginInstaller") as installer_cls,
            patch(f"{MODULE}.PluginService.invalidate_plugin_model_providers_cache") as invalidate_cache,
        ):
            installer = installer_cls.return_value
            decode_response = MagicMock()
            decode_response.verification = None
            installer.decode_plugin_from_identifier.return_value = decode_response
            installer.install_from_identifiers.return_value = PluginInstallTaskStartResponse(
                all_installed=False, task_id="task-id"
            )

            result = LegacyPluginInstallationGateway.install_from_local_pkg(
                "tenant-1",
                [
                    "langgenius/openai:1.0.0",
                    "langgenius/tavily:1.0.0",
                ],
            )

        assert result.task_id == "task-id"
        installer.install_from_identifiers.assert_called_once_with(
            "tenant-1",
            [
                "langgenius/openai:1.0.0",
                "langgenius/tavily:1.0.0",
            ],
            PluginInstallationSource.Package,
            [
                {"plugin_unique_identifier": "langgenius/openai:1.0.0"},
                {"plugin_unique_identifier": "langgenius/tavily:1.0.0"},
            ],
        )
        invalidate_cache.assert_called_once_with("tenant-1")

    def test_upgrade_plugin_with_github_invalidates_model_provider_cache_for_tenant(self) -> None:
        """Starting a plugin upgrade invalidates only the mutated tenant provider cache."""
        with (
            patch(f"{MODULE}.PluginService._check_marketplace_only_permission"),
            patch("services.plugin.installation_gateway.PluginInstaller") as installer_cls,
            patch(f"{MODULE}.PluginService.invalidate_plugin_model_providers_cache") as invalidate_cache,
        ):
            installer = installer_cls.return_value
            installer.upgrade_plugin.return_value = PluginInstallTaskStartResponse(
                all_installed=False, task_id="task-id"
            )

            result = LegacyPluginInstallationGateway.upgrade_plugin_with_github(
                "tenant-1", "old-uid", "new-uid", "langgenius/openai", "1.0.0", "openai.difypkg"
            )

        assert result.task_id == "task-id"
        invalidate_cache.assert_called_once_with("tenant-1")

    def test_install_from_github_invalidates_model_provider_cache_for_tenant(self) -> None:
        """GitHub installs invalidate only the mutated tenant provider cache."""
        with (
            patch(f"{MODULE}.PluginService._check_marketplace_only_permission"),
            patch(f"{MODULE}.PluginService._check_plugin_installation_scope"),
            patch("services.plugin.installation_gateway.PluginInstaller") as installer_cls,
            patch(f"{MODULE}.PluginService.invalidate_plugin_model_providers_cache") as invalidate_cache,
        ):
            installer = installer_cls.return_value
            decode_response = MagicMock()
            decode_response.verification = None
            installer.decode_plugin_from_identifier.return_value = decode_response
            installer.install_from_identifiers.return_value = PluginInstallTaskStartResponse(
                all_installed=False, task_id="task-id"
            )

            result = LegacyPluginInstallationGateway.install_from_github(
                "tenant-1", "langgenius/openai:1.0.0", "langgenius/openai", "1.0.0", "openai.difypkg"
            )

        assert result.task_id == "task-id"
        invalidate_cache.assert_called_once_with("tenant-1")

    def test_install_from_marketplace_pkg_invalidates_model_provider_cache_for_tenant(self) -> None:
        """Marketplace package installs invalidate only the mutated tenant provider cache."""
        with (
            patch(f"{MODULE}.SystemFeatureService") as feature_service,
            patch(f"{MODULE}.PluginService._check_plugin_installation_scope"),
            patch("services.plugin.installation_gateway.PluginInstaller") as installer_cls,
            patch(f"{MODULE}.PluginService.invalidate_plugin_model_providers_cache") as invalidate_cache,
        ):
            feature_service.get_plugin_installation_permission.return_value = PluginInstallationPermissionModel(
                plugin_installation_scope=PluginInstallationScope.ALL, restrict_to_marketplace_only=False
            )
            installer = installer_cls.return_value
            installer.fetch_plugin_manifest.return_value = MagicMock()
            decode_response = MagicMock()
            decode_response.verification = None
            installer.decode_plugin_from_identifier.return_value = decode_response
            installer.install_from_identifiers.return_value = PluginInstallTaskStartResponse(
                all_installed=False, task_id="task-id"
            )

            result = LegacyPluginInstallationGateway.install_from_marketplace_pkg(
                "tenant-1", ["langgenius/openai:1.0.0"]
            )

        assert result.task_id == "task-id"
        invalidate_cache.assert_called_once_with("tenant-1")


class TestUpgradePluginWithMarketplace:
    def test_raises_when_marketplace_disabled(self, config_overrides: Callable[..., None]) -> None:
        config_overrides(MARKETPLACE_ENABLED=False)

        with pytest.raises(ValueError, match="marketplace is not enabled"):
            LegacyPluginInstallationGateway.upgrade_plugin_with_marketplace("t1", "old-uid", "new-uid")

    def test_raises_when_same_identifier(self) -> None:
        with pytest.raises(ValueError, match="same plugin"):
            LegacyPluginInstallationGateway.upgrade_plugin_with_marketplace("t1", "same-uid", "same-uid")

    @patch("services.plugin.installation_gateway.marketplace")
    @patch("core.plugin.plugin_service.SystemFeatureService")
    @patch("services.plugin.installation_gateway.PluginInstaller")
    def test_skips_download_when_already_installed(
        self, mock_mutation_installer_cls: MagicMock, mock_fs: MagicMock, mock_marketplace: MagicMock
    ) -> None:
        mock_fs.get_plugin_installation_permission.return_value = _make_permission()
        installer = mock_mutation_installer_cls.return_value
        installer.fetch_plugin_manifest.return_value = MagicMock()
        installer.upgrade_plugin.return_value = MagicMock()

        LegacyPluginInstallationGateway.upgrade_plugin_with_marketplace("t1", "old-uid", "new-uid")

        mock_marketplace.record_install_plugin_event.assert_called_once_with("new-uid")
        installer.upgrade_plugin.assert_called_once()

    @patch("services.plugin.installation_gateway.download_plugin_pkg")
    @patch("core.plugin.plugin_service.SystemFeatureService")
    @patch("services.plugin.installation_gateway.PluginInstaller")
    def test_downloads_when_not_installed(
        self, mock_mutation_installer_cls: MagicMock, mock_fs: MagicMock, mock_download: MagicMock
    ) -> None:
        mock_fs.get_plugin_installation_permission.return_value = _make_permission()
        installer = mock_mutation_installer_cls.return_value
        installer.fetch_plugin_manifest.side_effect = RuntimeError("not found")
        mock_download.return_value = b"pkg-bytes"
        upload_resp = MagicMock()
        upload_resp.verification = None
        installer.upload_pkg.return_value = upload_resp
        installer.upgrade_plugin.return_value = MagicMock()

        LegacyPluginInstallationGateway.upgrade_plugin_with_marketplace("t1", "old-uid", "new-uid")

        mock_download.assert_called_once_with("new-uid")
        installer.upload_pkg.assert_called_once()

    @pytest.mark.parametrize(
        "scope",
        [PluginInstallationScope.OFFICIAL_ONLY, PluginInstallationScope.OFFICIAL_AND_SPECIFIC_PARTNERS],
    )
    @patch("services.plugin.installation_gateway.download_plugin_pkg")
    @patch("services.plugin.installation_gateway.marketplace")
    @patch("core.plugin.plugin_service.SystemFeatureService")
    @patch("services.plugin.installation_gateway.PluginInstaller")
    def test_rejects_cached_pkg_outside_scope(
        self,
        mock_mutation_installer_cls: MagicMock,
        mock_fs: MagicMock,
        mock_marketplace: MagicMock,
        mock_download: MagicMock,
        scope: PluginInstallationScope,
    ) -> None:
        mock_fs.get_plugin_installation_permission.return_value = _make_permission(scope=scope)
        installer = mock_mutation_installer_cls.return_value
        installer.fetch_plugin_manifest.return_value = MagicMock()
        decode_resp = MagicMock()
        decode_resp.verification.authorized_category = PluginVerification.AuthorizedCategory.Community
        installer.decode_plugin_from_identifier.return_value = decode_resp

        with pytest.raises(PluginInstallationForbiddenError):
            LegacyPluginInstallationGateway.upgrade_plugin_with_marketplace("t1", "old-uid", "new-uid")

        installer.upgrade_plugin.assert_not_called()
        mock_marketplace.record_install_plugin_event.assert_not_called()
        # the rejection must not fall through to the download branch and cache the pkg again
        mock_download.assert_not_called()
        installer.upload_pkg.assert_not_called()

    @patch("core.plugin.plugin_service.SystemFeatureService")
    @patch("services.plugin.installation_gateway.PluginInstaller")
    def test_rejects_before_touching_daemon_when_scope_is_none(
        self, mock_mutation_installer_cls: MagicMock, mock_fs: MagicMock
    ) -> None:
        mock_fs.get_plugin_installation_permission.return_value = _make_permission(scope=PluginInstallationScope.NONE)
        installer = mock_mutation_installer_cls.return_value

        with pytest.raises(PluginInstallationForbiddenError):
            LegacyPluginInstallationGateway.upgrade_plugin_with_marketplace("t1", "old-uid", "new-uid")

        installer.fetch_plugin_manifest.assert_not_called()
        installer.upgrade_plugin.assert_not_called()

    @patch("services.plugin.installation_gateway.marketplace")
    @patch("core.plugin.plugin_service.SystemFeatureService")
    @patch("services.plugin.installation_gateway.PluginInstaller")
    def test_allows_cached_official_pkg_under_official_only(
        self, mock_mutation_installer_cls: MagicMock, mock_fs: MagicMock, mock_marketplace: MagicMock
    ) -> None:
        mock_fs.get_plugin_installation_permission.return_value = _make_permission(
            scope=PluginInstallationScope.OFFICIAL_ONLY
        )
        installer = mock_mutation_installer_cls.return_value
        installer.fetch_plugin_manifest.return_value = MagicMock()
        decode_resp = MagicMock()
        decode_resp.verification.authorized_category = PluginVerification.AuthorizedCategory.Langgenius
        installer.decode_plugin_from_identifier.return_value = decode_resp

        LegacyPluginInstallationGateway.upgrade_plugin_with_marketplace("t1", "old-uid", "new-uid")

        mock_marketplace.record_install_plugin_event.assert_called_once_with("new-uid")
        installer.upgrade_plugin.assert_called_once()


class TestUpgradePluginWithGithub:
    @patch("core.plugin.plugin_service.SystemFeatureService")
    @patch("services.plugin.installation_gateway.PluginInstaller")
    def test_checks_marketplace_permission_and_delegates(
        self, mock_mutation_installer_cls: MagicMock, mock_fs: MagicMock
    ) -> None:
        mock_fs.get_plugin_installation_permission.return_value = _make_permission()
        installer = mock_mutation_installer_cls.return_value
        installer.upgrade_plugin.return_value = MagicMock()

        LegacyPluginInstallationGateway.upgrade_plugin_with_github(
            "t1", "old-uid", "new-uid", "org/repo", "v1", "pkg.difypkg"
        )

        installer.upgrade_plugin.assert_called_once()
        call_args = installer.upgrade_plugin.call_args
        assert call_args[0][3] == PluginInstallationSource.Github


class TestInstallFromMarketplacePkg:
    def test_raises_when_marketplace_disabled(self, config_overrides: Callable[..., None]) -> None:
        config_overrides(MARKETPLACE_ENABLED=False)

        with pytest.raises(ValueError, match="marketplace is not enabled"):
            LegacyPluginInstallationGateway.install_from_marketplace_pkg("t1", ["uid-1"])

    @patch("services.plugin.installation_gateway.download_plugin_pkg")
    @patch("core.plugin.plugin_service.SystemFeatureService")
    @patch("services.plugin.installation_gateway.PluginInstaller")
    def test_downloads_when_not_cached(
        self, mock_mutation_installer_cls: MagicMock, mock_fs: MagicMock, mock_download: MagicMock
    ) -> None:
        mock_fs.get_plugin_installation_permission.return_value = _make_permission()
        installer = mock_mutation_installer_cls.return_value
        installer.fetch_plugin_manifest.side_effect = RuntimeError("not found")
        mock_download.return_value = b"pkg"
        upload_resp = MagicMock()
        upload_resp.verification = None
        upload_resp.unique_identifier = "resolved-uid"
        installer.upload_pkg.return_value = upload_resp
        installer.install_from_identifiers.return_value = PluginInstallTaskStartResponse(
            all_installed=False, task_id="task-id"
        )

        result = LegacyPluginInstallationGateway.install_from_marketplace_pkg("t1", ["uid-1"])

        assert result.task_id == "task-id"
        installer.install_from_identifiers.assert_called_once()
        call_args = installer.install_from_identifiers.call_args[0]
        assert call_args[1] == ["resolved-uid"]

    @patch("core.plugin.plugin_service.SystemFeatureService")
    @patch("services.plugin.installation_gateway.PluginInstaller")
    def test_uses_cached_when_already_downloaded(
        self, mock_mutation_installer_cls: MagicMock, mock_fs: MagicMock
    ) -> None:
        mock_fs.get_plugin_installation_permission.return_value = _make_permission()
        installer = mock_mutation_installer_cls.return_value
        installer.fetch_plugin_manifest.return_value = MagicMock()
        decode_resp = MagicMock()
        decode_resp.verification = None
        installer.decode_plugin_from_identifier.return_value = decode_resp
        installer.install_from_identifiers.return_value = PluginInstallTaskStartResponse(
            all_installed=False, task_id="task-id"
        )

        LegacyPluginInstallationGateway.install_from_marketplace_pkg("t1", ["uid-1"])

        installer.install_from_identifiers.assert_called_once()
        call_args = installer.install_from_identifiers.call_args[0]
        assert call_args[1] == ["uid-1"]

    @patch("services.plugin.installation_gateway.download_plugin_pkg")
    @patch("core.plugin.plugin_service.SystemFeatureService")
    @patch("services.plugin.installation_gateway.PluginInstaller")
    def test_rejects_cached_pkg_outside_scope(
        self, mock_mutation_installer_cls: MagicMock, mock_fs: MagicMock, mock_download: MagicMock
    ) -> None:
        mock_fs.get_plugin_installation_permission.return_value = _make_permission(
            scope=PluginInstallationScope.OFFICIAL_ONLY
        )
        installer = mock_mutation_installer_cls.return_value
        installer.fetch_plugin_manifest.return_value = MagicMock()
        decode_resp = MagicMock()
        decode_resp.verification.authorized_category = PluginVerification.AuthorizedCategory.Community
        installer.decode_plugin_from_identifier.return_value = decode_resp

        with pytest.raises(PluginInstallationForbiddenError):
            LegacyPluginInstallationGateway.install_from_marketplace_pkg("t1", ["uid-1"])

        installer.install_from_identifiers.assert_not_called()
        # the rejection must not fall through to the download branch and cache the pkg again
        mock_download.assert_not_called()
        installer.upload_pkg.assert_not_called()
