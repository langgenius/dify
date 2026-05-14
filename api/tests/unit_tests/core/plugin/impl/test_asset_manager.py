from unittest.mock import MagicMock

import pytest
from pytest_mock import MockerFixture

from core.plugin.impl.asset import PluginAssetManager


class TestPluginAssetManager:
    def test_fetch_asset_success(self, mocker: MockerFixture):
        manager = PluginAssetManager()
        response = MagicMock(status_code=200, content=b"asset-bytes")
        request_mock = mocker.patch.object(manager, "_request", return_value=response)

        result = manager.fetch_asset("tenant-1", "asset-1")

        assert result == b"asset-bytes"
        request_mock.assert_called_once_with(method="GET", path="plugin/tenant-1/asset/asset-1")

    def test_fetch_asset_not_found_raises(self, mocker: MockerFixture):
        manager = PluginAssetManager()
        mocker.patch.object(manager, "_request", return_value=MagicMock(status_code=404, content=b""))

        with pytest.raises(ValueError, match="can not found asset asset-1"):
            manager.fetch_asset("tenant-1", "asset-1")

    def test_extract_asset_success(self, mocker: MockerFixture):
        manager = PluginAssetManager()
        response = MagicMock(status_code=200, content=b"file-content")
        request_mock = mocker.patch.object(manager, "_request", return_value=response)

        result = manager.extract_asset("tenant-1", "org/plugin:1", "README.md")

        assert result == b"file-content"
        request_mock.assert_called_once_with(
            method="GET",
            path="plugin/tenant-1/extract-asset/",
            params={"plugin_unique_identifier": "org/plugin:1", "file_path": "README.md"},
        )

    def test_extract_asset_not_found_raises(self, mocker: MockerFixture):
        manager = PluginAssetManager()
        mocker.patch.object(manager, "_request", return_value=MagicMock(status_code=404, content=b""))

        with pytest.raises(ValueError, match="can not found asset org/plugin:1, 404"):
            manager.extract_asset("tenant-1", "org/plugin:1", "README.md")
