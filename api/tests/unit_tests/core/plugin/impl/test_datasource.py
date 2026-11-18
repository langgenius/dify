from collections.abc import Callable
from types import SimpleNamespace
from typing import TypedDict, Unpack

from pytest_mock import MockerFixture

from core.datasource.entities.datasource_entities import (
    DatasourceProviderType,
    GetOnlineDocumentPageContentRequest,
    OnlineDriveBrowseFilesRequest,
    OnlineDriveDownloadFileRequest,
    OnlineDriveDownloadMessage,
)
from core.plugin.entities.plugin_daemon import PluginDatasourceProviderEntity
from core.plugin.impl.datasource import (
    PluginDatasourceListPayload,
    PluginDatasourceManager,
    PluginDatasourceSinglePayload,
)
from core.plugin.plugin_service import PluginService
from tests.helpers.unit.core.datasource.factories import provider_entity as datasource_provider_entity


class PluginDatasourceListRequestKwargs(TypedDict):
    """Keyword arguments the manager passes when listing providers."""

    transformer: Callable[[dict[str, object]], PluginDatasourceListPayload]


class PluginDatasourceSingleRequestKwargs(TypedDict):
    """Keyword arguments the manager passes when resolving one provider."""

    transformer: Callable[[dict[str, object]], PluginDatasourceSinglePayload]


def _datasource_provider(name: str = "provider") -> SimpleNamespace:
    return SimpleNamespace(
        plugin_id="org/plugin",
        declaration=SimpleNamespace(
            identity=SimpleNamespace(name=name),
            datasources=[SimpleNamespace(identity=SimpleNamespace(provider=""))],
        ),
    )


class TestPluginDatasourceManager:
    def test_fetch_datasource_providers(self, mocker: MockerFixture) -> None:
        manager = PluginDatasourceManager()
        provider = _datasource_provider("remote")
        repack = mocker.patch("core.plugin.impl.datasource.ToolTransformService.repack_provider")
        mocker.patch("core.plugin.impl.datasource.resolve_dify_schema_refs", return_value={"resolved": True})

        def fake_request(
            method: str, path: str, type_: object, **kwargs: Unpack[PluginDatasourceListRequestKwargs]
        ) -> list[SimpleNamespace]:
            transformer = kwargs["transformer"]
            transformed = transformer(
                {
                    "data": [
                        {
                            "declaration": {
                                "identity": {"name": "remote"},
                                "datasources": [{"identity": {"provider": "old"}, "output_schema": {"$ref": "#/doc"}}],
                            }
                        }
                    ]
                }
            )
            assert transformed.data is not None
            declaration = transformed.data[0].declaration
            assert declaration is not None
            datasources = declaration.datasources
            assert datasources is not None
            assert datasources[0].output_schema == {"resolved": True}
            return [provider]

        request_mock = mocker.patch.object(manager, "_request_with_plugin_daemon_response", side_effect=fake_request)

        result = manager.fetch_datasource_providers("tenant-1")

        assert request_mock.call_count == 1
        assert len(result) == 2
        assert result[0].plugin_id == "langgenius/file"
        assert result[1].declaration.identity.name == "org/plugin/remote"
        assert result[1].declaration.datasources[0].identity.provider == "org/plugin/remote"
        repack.assert_called_once_with(
            tenant_id="tenant-1", provider=provider, get_plugin_icon_url=PluginService.get_plugin_icon_url
        )

    def test_fetch_installed_datasource_providers(self, mocker: MockerFixture) -> None:
        manager = PluginDatasourceManager()
        provider = _datasource_provider("remote")
        repack = mocker.patch("core.plugin.impl.datasource.ToolTransformService.repack_provider")
        mocker.patch("core.plugin.impl.datasource.resolve_dify_schema_refs", return_value={"resolved": True})

        def fake_request(
            method: str, path: str, type_: object, **kwargs: Unpack[PluginDatasourceListRequestKwargs]
        ) -> list[SimpleNamespace]:
            transformer = kwargs["transformer"]
            transformer(
                {
                    "data": [
                        {
                            "declaration": {
                                "identity": {"name": "remote"},
                                "datasources": [{"identity": {"provider": "old"}, "output_schema": {"$ref": "#/doc"}}],
                            }
                        }
                    ]
                }
            )
            return [provider]

        request_mock = mocker.patch.object(manager, "_request_with_plugin_daemon_response", side_effect=fake_request)

        result = manager.fetch_installed_datasource_providers("tenant-1")

        assert request_mock.call_count == 1
        assert len(result) == 1
        assert result[0].declaration.identity.name == "org/plugin/remote"
        assert result[0].declaration.datasources[0].identity.provider == "org/plugin/remote"
        repack.assert_called_once_with(
            tenant_id="tenant-1", provider=provider, get_plugin_icon_url=PluginService.get_plugin_icon_url
        )

    def test_fetch_datasource_provider_local_and_remote(self, mocker: MockerFixture) -> None:
        manager = PluginDatasourceManager()

        local = manager.fetch_datasource_provider("tenant-1", "langgenius/file/file")
        assert local.plugin_id == "langgenius/file"

        remote = _datasource_provider("provider")
        mocker.patch("core.plugin.impl.datasource.resolve_dify_schema_refs", return_value={"resolved": True})

        def fake_request(
            method: str, path: str, type_: object, **kwargs: Unpack[PluginDatasourceSingleRequestKwargs]
        ) -> SimpleNamespace:
            transformer = kwargs["transformer"]
            transformed = transformer(
                {
                    "data": {
                        "declaration": {
                            "datasources": [{"identity": {"provider": "old"}, "output_schema": {"$ref": "#/x"}}]
                        }
                    }
                }
            )
            assert transformed.data is not None
            declaration = transformed.data.declaration
            assert declaration is not None
            datasources = declaration.datasources
            assert datasources is not None
            assert datasources[0].output_schema == {"resolved": True}
            return remote

        request_mock = mocker.patch.object(manager, "_request_with_plugin_daemon_response", side_effect=fake_request)

        result = manager.fetch_datasource_provider("tenant-1", "org/plugin/provider")

        assert request_mock.call_count == 1
        assert result.declaration.identity.name == "org/plugin/provider"
        assert result.declaration.datasources[0].identity.provider == "org/plugin/provider"

    def test_list_transformer_keeps_providers_without_declaration_or_identity(self, mocker: MockerFixture) -> None:
        icon_url_calls: list[tuple[str, str]] = []

        def get_plugin_icon_url(tenant_id: str, filename: str) -> str:
            icon_url_calls.append((tenant_id, filename))
            return f"https://custom-icon-resolver.example/{tenant_id}/{filename}"

        manager = PluginDatasourceManager(get_plugin_icon_url=get_plugin_icon_url)
        providers: list[PluginDatasourceProviderEntity] = []

        def fake_request(
            method: str, path: str, type_: object, **kwargs: Unpack[PluginDatasourceListRequestKwargs]
        ) -> list[PluginDatasourceProviderEntity]:
            transformer = kwargs["transformer"]
            transformed = transformer(
                {
                    "data": [
                        {},
                        {"declaration": {}},
                        {"declaration": {"identity": {}, "datasources": [{"identity": {"provider": "old"}}]}},
                        {
                            "declaration": {
                                "identity": {"name": "remote"},
                                "datasources": [{"identity": {"provider": "old"}}],
                            }
                        },
                    ]
                }
            )
            data = transformed.data
            assert data is not None
            assert data[0].declaration is None
            declaration = data[1].declaration
            assert declaration is not None
            assert declaration.datasources is None
            unnamed = data[2].declaration
            assert unnamed is not None
            assert unnamed.datasources is not None
            assert unnamed.datasources[0].identity.provider is None
            named = data[3].declaration
            assert named is not None
            assert named.datasources is not None
            assert named.datasources[0].identity.provider == "remote"
            assert "output_schema" not in named.datasources[0].model_dump(exclude_unset=True)
            provider = PluginDatasourceProviderEntity(
                provider="remote",
                plugin_unique_identifier="org/plugin@1.0.0",
                plugin_id="org/plugin",
                declaration=datasource_provider_entity(DatasourceProviderType.ONLINE_DOCUMENT),
            )
            providers.append(provider)
            return [provider]

        mocker.patch.object(manager, "_request_with_plugin_daemon_response", side_effect=fake_request)

        listed_providers = manager.fetch_datasource_providers("tenant-1")
        installed_providers = manager.fetch_installed_datasource_providers("tenant-1")

        expected_icon_url = "https://custom-icon-resolver.example/tenant-1/icon.svg"
        assert len(providers) == 2
        assert icon_url_calls == [("tenant-1", "icon.svg"), ("tenant-1", "icon.svg")]
        assert listed_providers[1].declaration.identity.icon == expected_icon_url
        assert installed_providers[0].declaration.identity.icon == expected_icon_url

    def test_single_transformer_tolerates_missing_data_and_declaration(self, mocker: MockerFixture) -> None:
        manager = PluginDatasourceManager()
        resolver = mocker.patch("core.plugin.impl.datasource.resolve_dify_schema_refs")
        remote = _datasource_provider("provider")
        seen: list[PluginDatasourceSinglePayload] = []

        def fake_request(
            method: str, path: str, type_: object, **kwargs: Unpack[PluginDatasourceSingleRequestKwargs]
        ) -> SimpleNamespace:
            transformer = kwargs["transformer"]
            seen.append(transformer({}))
            seen.append(transformer({"data": {}}))
            seen.append(transformer({"data": {"declaration": {"datasources": [{"identity": {"provider": "old"}}]}}}))
            return remote

        mocker.patch.object(manager, "_request_with_plugin_daemon_response", side_effect=fake_request)

        manager.fetch_datasource_provider("tenant-1", "org/plugin/provider")

        assert seen[0].data is None
        assert seen[1].data is not None
        assert seen[1].data.declaration is None
        populated = seen[2].data
        assert populated is not None
        declaration = populated.declaration
        assert declaration is not None
        assert declaration.datasources is not None
        assert declaration.datasources[0].identity.provider == "provider"
        resolver.assert_not_called()

    def test_get_website_crawl_streaming(self, mocker: MockerFixture) -> None:
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

    def test_get_online_document_pages_streaming(self, mocker: MockerFixture) -> None:
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

    def test_get_online_document_page_content_streaming(self, mocker: MockerFixture) -> None:
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

    def test_online_drive_browse_files_streaming(self, mocker: MockerFixture) -> None:
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

    def test_online_drive_download_file_streaming(self, mocker: MockerFixture) -> None:
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

        stream_mock.assert_called_once()
        assert stream_mock.call_args.args[2] is OnlineDriveDownloadMessage

    def test_validate_provider_credentials_returns_true_when_stream_yields_result(self, mocker: MockerFixture) -> None:
        manager = PluginDatasourceManager()
        stream_mock = mocker.patch.object(manager, "_request_with_plugin_daemon_response_stream")
        stream_mock.return_value = iter([SimpleNamespace(result=True)])

        assert manager.validate_provider_credentials("tenant-1", "user-1", "provider", "org/plugin", {"k": "v"}) is True

    def test_validate_provider_credentials_returns_false_when_stream_empty(self, mocker: MockerFixture) -> None:
        manager = PluginDatasourceManager()
        stream_mock = mocker.patch.object(manager, "_request_with_plugin_daemon_response_stream")
        stream_mock.return_value = iter([])

        assert (
            manager.validate_provider_credentials("tenant-1", "user-1", "provider", "org/plugin", {"k": "v"}) is False
        )

    def test_local_file_provider_template(self) -> None:
        manager = PluginDatasourceManager()

        payload = manager._get_local_file_datasource_provider()

        assert payload["plugin_id"] == "langgenius/file"
        assert payload["provider"] == "file"
        assert payload["declaration"]["provider_type"] == "local_file"
