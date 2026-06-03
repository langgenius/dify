from types import SimpleNamespace

from pytest_mock import MockerFixture

from core.datasource.entities.datasource_entities import (
    GetOnlineDocumentPageContentRequest,
    OnlineDriveBrowseFilesRequest,
    OnlineDriveDownloadFileRequest,
)
from core.plugin.impl.datasource import PluginDatasourceManager


def _datasource_provider(name: str = "provider") -> SimpleNamespace:
    return SimpleNamespace(
        plugin_id="org/plugin",
        declaration=SimpleNamespace(
            identity=SimpleNamespace(name=name),
            datasources=[SimpleNamespace(identity=SimpleNamespace(provider=""))],
        ),
    )


class TestPluginDatasourceManager:
    def test_fetch_datasource_providers(self, mocker: MockerFixture):
        manager = PluginDatasourceManager()
        provider = _datasource_provider("remote")
        repack = mocker.patch("core.plugin.impl.datasource.ToolTransformService.repack_provider")
        mocker.patch("core.plugin.impl.datasource.resolve_dify_schema_refs", return_value={"resolved": True})

        def fake_request(method, path, type_, **kwargs):
            transformer = kwargs["transformer"]
            payload = {
                "data": [
                    {
                        "declaration": {
                            "identity": {"name": "remote"},
                            "datasources": [{"identity": {"provider": "old"}, "output_schema": {"$ref": "#/doc"}}],
                        }
                    }
                ]
            }
            transformed = transformer(payload)
            assert transformed["data"][0]["declaration"]["datasources"][0]["output_schema"] == {"resolved": True}
            return [provider]

        request_mock = mocker.patch.object(manager, "_request_with_plugin_daemon_response", side_effect=fake_request)

        result = manager.fetch_datasource_providers("tenant-1")

        assert request_mock.call_count == 1
        assert len(result) == 2
        assert result[0].plugin_id == "langgenius/file"
        assert result[1].declaration.identity.name == "org/plugin/remote"
        assert result[1].declaration.datasources[0].identity.provider == "org/plugin/remote"
        repack.assert_called_once_with(tenant_id="tenant-1", provider=provider)

    def test_fetch_installed_datasource_providers(self, mocker: MockerFixture):
        manager = PluginDatasourceManager()
        provider = _datasource_provider("remote")
        repack = mocker.patch("core.plugin.impl.datasource.ToolTransformService.repack_provider")
        mocker.patch("core.plugin.impl.datasource.resolve_dify_schema_refs", return_value={"resolved": True})

        def fake_request(method, path, type_, **kwargs):
            transformer = kwargs["transformer"]
            payload = {
                "data": [
                    {
                        "declaration": {
                            "identity": {"name": "remote"},
                            "datasources": [{"identity": {"provider": "old"}, "output_schema": {"$ref": "#/doc"}}],
                        }
                    }
                ]
            }
            transformer(payload)
            return [provider]

        request_mock = mocker.patch.object(manager, "_request_with_plugin_daemon_response", side_effect=fake_request)

        result = manager.fetch_installed_datasource_providers("tenant-1")

        assert request_mock.call_count == 1
        assert len(result) == 1
        assert result[0].declaration.identity.name == "org/plugin/remote"
        assert result[0].declaration.datasources[0].identity.provider == "org/plugin/remote"
        repack.assert_called_once_with(tenant_id="tenant-1", provider=provider)

    def test_fetch_datasource_provider_local_and_remote(self, mocker: MockerFixture):
        manager = PluginDatasourceManager()

        local = manager.fetch_datasource_provider("tenant-1", "langgenius/file/file")
        assert local.plugin_id == "langgenius/file"

        remote = _datasource_provider("provider")
        mocker.patch("core.plugin.impl.datasource.resolve_dify_schema_refs", return_value={"resolved": True})

        def fake_request(method, path, type_, **kwargs):
            transformer = kwargs["transformer"]
            payload = {
                "data": {
                    "declaration": {
                        "datasources": [{"identity": {"provider": "old"}, "output_schema": {"$ref": "#/x"}}]
                    }
                }
            }
            transformed = transformer(payload)
            assert transformed["data"]["declaration"]["datasources"][0]["output_schema"] == {"resolved": True}
            return remote

        request_mock = mocker.patch.object(manager, "_request_with_plugin_daemon_response", side_effect=fake_request)

        result = manager.fetch_datasource_provider("tenant-1", "org/plugin/provider")

        assert request_mock.call_count == 1
        assert result.declaration.identity.name == "org/plugin/provider"
        assert result.declaration.datasources[0].identity.provider == "org/plugin/provider"

    def test_get_website_crawl_streaming(self, mocker: MockerFixture):
        manager = PluginDatasourceManager()
        stream_mock = mocker.patch.object(manager, "_request_with_plugin_daemon_response_stream")
        stream_mock.return_value = iter(["crawl"])

        assert list(
            manager.get_website_crawl(
                "tenant-1",
                "user-1",
                "org/plugin/provider",
                "crawl",
                {"k": "v"},
                {"url": "https://example.com"},
                "website",
            )
        ) == ["crawl"]

        assert stream_mock.call_count == 1

    def test_get_online_document_pages_streaming(self, mocker: MockerFixture):
        manager = PluginDatasourceManager()
        stream_mock = mocker.patch.object(manager, "_request_with_plugin_daemon_response_stream")
        stream_mock.return_value = iter(["pages"])

        assert list(
            manager.get_online_document_pages(
                "tenant-1",
                "user-1",
                "org/plugin/provider",
                "docs",
                {"k": "v"},
                {"workspace": "w1"},
                "online_document",
            )
        ) == ["pages"]

        assert stream_mock.call_count == 1

    def test_get_online_document_page_content_streaming(self, mocker: MockerFixture):
        manager = PluginDatasourceManager()
        stream_mock = mocker.patch.object(manager, "_request_with_plugin_daemon_response_stream")
        stream_mock.return_value = iter(["content"])

        assert list(
            manager.get_online_document_page_content(
                "tenant-1",
                "user-1",
                "org/plugin/provider",
                "docs",
                {"k": "v"},
                GetOnlineDocumentPageContentRequest(workspace_id="w", page_id="p", type="doc"),
                "online_document",
            )
        ) == ["content"]

        assert stream_mock.call_count == 1

    def test_online_drive_browse_files_streaming(self, mocker: MockerFixture):
        manager = PluginDatasourceManager()
        stream_mock = mocker.patch.object(manager, "_request_with_plugin_daemon_response_stream")
        stream_mock.return_value = iter(["browse"])

        assert list(
            manager.online_drive_browse_files(
                "tenant-1",
                "user-1",
                "org/plugin/provider",
                "drive",
                {"k": "v"},
                OnlineDriveBrowseFilesRequest(prefix="/"),
                "online_drive",
            )
        ) == ["browse"]

        assert stream_mock.call_count == 1

    def test_online_drive_download_file_streaming(self, mocker: MockerFixture):
        manager = PluginDatasourceManager()
        stream_mock = mocker.patch.object(manager, "_request_with_plugin_daemon_response_stream")
        stream_mock.return_value = iter(["download"])

        assert list(
            manager.online_drive_download_file(
                "tenant-1",
                "user-1",
                "org/plugin/provider",
                "drive",
                {"k": "v"},
                OnlineDriveDownloadFileRequest(id="file-1"),
                "online_drive",
            )
        ) == ["download"]

        assert stream_mock.call_count == 1

    def test_validate_provider_credentials_returns_true_when_stream_yields_result(self, mocker: MockerFixture):
        manager = PluginDatasourceManager()
        stream_mock = mocker.patch.object(manager, "_request_with_plugin_daemon_response_stream")
        stream_mock.return_value = iter([SimpleNamespace(result=True)])

        assert manager.validate_provider_credentials("tenant-1", "user-1", "provider", "org/plugin", {"k": "v"}) is True

    def test_validate_provider_credentials_returns_false_when_stream_empty(self, mocker: MockerFixture):
        manager = PluginDatasourceManager()
        stream_mock = mocker.patch.object(manager, "_request_with_plugin_daemon_response_stream")
        stream_mock.return_value = iter([])

        assert (
            manager.validate_provider_credentials("tenant-1", "user-1", "provider", "org/plugin", {"k": "v"}) is False
        )

    def test_local_file_provider_template(self):
        manager = PluginDatasourceManager()

        payload = manager._get_local_file_datasource_provider()

        assert payload["plugin_id"] == "langgenius/file"
        assert payload["provider"] == "file"
        assert payload["declaration"]["provider_type"] == "local_file"
