import pytest
from pytest_mock import MockerFixture

from core.plugin.impl.exc import PluginDaemonClientSideError
from core.plugin.plugin_service import PluginService


def test_upload_pkg_from_github_maps_download_failure(mocker: MockerFixture) -> None:
    mocker.patch.object(PluginService, "_check_marketplace_only_permission")
    mocker.patch(
        "core.plugin.plugin_service.download_with_size_limit",
        side_effect=ValueError("Failed to download file: HTTP 403"),
    )
    installer = mocker.patch("core.plugin.plugin_service.PluginInstaller")

    with pytest.raises(PluginDaemonClientSideError, match="HTTP 403"):
        PluginService.upload_pkg_from_github("tenant-id", "owner/repo", "v1.0.0", "plugin.difypkg")

    installer.assert_not_called()


def test_download_plugin_pkg_maps_download_failure(mocker: MockerFixture) -> None:
    mocker.patch(
        "core.plugin.plugin_service.download_plugin_pkg",
        side_effect=ValueError("Failed to download file: HTTP 429"),
    )

    with pytest.raises(PluginDaemonClientSideError, match="HTTP 429"):
        PluginService._download_plugin_pkg("langgenius-agent:0.0.1@abcdef")
