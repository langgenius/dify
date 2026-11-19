from collections.abc import Callable
from types import SimpleNamespace
from typing import TypedDict, Unpack

import httpx
from pytest_mock import MockerFixture

from core.datasource.entities.datasource_entities import (
    DatasourceProviderType,
    GetOnlineDocumentPageContentRequest,
    OnlineDriveBrowseFilesRequest,
    OnlineDriveDownloadFileRequest,
    OnlineDriveDownloadMessage,
)
from core.plugin.entities.plugin_daemon import PluginDatasourceProviderEntity
from core.plugin.impl import base as plugin_client_module
from core.plugin.impl.datasource import (
    PluginDatasourceListPayload,
    PluginDatasourceManager,
    PluginDatasourceSinglePayload,
)
from core.plugin.plugin_service import PluginService
from tests.helpers.unit.core.datasource.factories import (
    datasource_entity,
)
from tests.helpers.unit.core.datasource.factories import (
    provider_entity as datasource_provider_entity,
)


class PluginDatasourceListRequestKwargs(TypedDict):
    """Keyword arguments accepted by a mocked list request helper."""

    transformer: Callable[[dict[str, object]], PluginDatasourceListPayload]


class PluginDatasourceSingleRequestKwargs(TypedDict):
    """Keyword arguments accepted by a mocked single-provider request helper."""

    transformer: Callable[[dict[str, object]], PluginDatasourceSinglePayload]


class _DatasourceProviderListRequesterFake:
    """Apply the production response transformer to a canned daemon payload."""

    def __init__(self, response: dict[str, object], providers: list[PluginDatasourceProviderEntity]) -> None:
        """Store the raw response and entity result used by each fake request.

        Inputs: ``response`` is a daemon-shaped JSON object and ``providers`` is
        the complete entity list returned after transformation.
        Preconditions: The response is accepted by the manager's transformer.
        Result and side effects: Stores the supplied values and initializes empty
        request and transformed-response records.
        Failure behavior: No runtime validation occurs at construction; the
        transformer may reject the response when ``request`` is called.
        """
        self.response = response
        self.providers = providers
        self.tenant_ids: list[str] = []
        self.transformed_payloads: list[PluginDatasourceListPayload] = []

    def request(
        self,
        *,
        tenant_id: str,
        transformer: Callable[[dict[str, object]], PluginDatasourceListPayload],
    ) -> list[PluginDatasourceProviderEntity]:
        """Record a tenant request, run the production transformer, and return entities.

        Inputs: ``tenant_id`` is the request scope; ``transformer`` validates and
        normalizes a raw daemon JSON object.
        Preconditions: The transformer accepts ``self.response``.
        Result and side effects: Records the tenant and transformed payload, then
        returns deep copies of the complete provider entities supplied at construction
        so manager mutations do not leak between requests.
        Failure behavior: Transformer errors propagate and no provider list is returned.
        """
        self.tenant_ids.append(tenant_id)
        transformed = transformer(self.response)
        self.transformed_payloads.append(transformed)
        return [provider.model_copy(deep=True) for provider in self.providers]


def _plugin_datasource_provider(name: str = "provider") -> PluginDatasourceProviderEntity:
    """Build a complete plugin datasource provider entity for manager tests.

    Inputs: ``name`` is the daemon-declared provider name.
    Preconditions: ``name`` is non-empty.
    Result and side effects: Returns a validated provider entity with one datasource;
    no external requests or shared state are modified.
    Failure behavior: Pydantic validation errors propagate if the constructed entity
    violates its model contract.
    """
    declaration = datasource_provider_entity(DatasourceProviderType.ONLINE_DOCUMENT)
    declaration.identity.name = name
    declaration.datasources = [datasource_entity("documents")]
    return PluginDatasourceProviderEntity(
        provider=name,
        plugin_unique_identifier="org/plugin@1.0.0",
        plugin_id="org/plugin",
        declaration=declaration,
    )


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
        """Exercise local and remote provider reads through the HTTP transport.

        Inputs: The local-file provider ID bypasses transport; the remote provider ID
        receives a valid plugin-daemon response with an output-schema reference.
        Preconditions: The test HTTPX client is configured with an in-memory transport.
        Result and side effects: Returns normalized provider entities and records one
        GET request to the existing single-provider endpoint.
        Failure behavior: HTTP, payload validation, and schema-transform errors fail
        the test through the existing manager boundary.
        """
        manager = PluginDatasourceManager()
        requests: list[httpx.Request] = []

        local = manager.fetch_datasource_provider("tenant-1", "langgenius/file/file")
        assert local.plugin_id == "langgenius/file"

        remote = _plugin_datasource_provider("provider")
        remote.declaration.datasources[0].output_schema = {"$ref": "#/x"}
        daemon_response = {"code": 0, "message": "", "data": remote.model_dump(mode="json")}
        resolver = mocker.patch("core.plugin.impl.datasource.resolve_dify_schema_refs", return_value={"resolved": True})

        def handle(request: httpx.Request) -> httpx.Response:
            requests.append(request)
            return httpx.Response(200, json=daemon_response)

        with httpx.Client(transport=httpx.MockTransport(handle)) as http_client:
            mocker.patch.object(plugin_client_module, "_httpx_client", http_client)
            result = manager.fetch_datasource_provider("tenant-1", "org/plugin/provider")

        assert len(requests) == 1
        assert requests[0].method == "GET"
        assert requests[0].url.path == "/plugin/tenant-1/management/datasource"
        assert dict(requests[0].url.params) == {"provider": "provider", "plugin_id": "org/plugin"}
        assert result.declaration.identity.name == "org/plugin/provider"
        assert result.declaration.datasources[0].identity.provider == "org/plugin/provider"
        assert result.declaration.datasources[0].output_schema == {"resolved": True}
        resolver.assert_called_once_with({"$ref": "#/x"})

    def test_list_transformers_keep_providers_without_declaration_or_identity(self) -> None:
        """Verify the injected requester applies sparse daemon payload normalization.

        Inputs: The fake requester receives raw JSON containing absent declarations,
        absent identities, and providers with or without names.
        Preconditions: The manager's list transformer accepts these sparse shapes.
        Result and side effects: Both list paths return the complete provider entity
        while retaining the existing sparse-field and provider-name assertions; no
        network or global request patch is used.
        Failure behavior: Any transformer or provider-model validation failure fails
        the test directly.
        """

        def get_plugin_icon_url(tenant_id: str, filename: str) -> str:
            """Return a deterministic icon URL for this provider-list test."""
            return f"https://custom-icon-resolver.example/{tenant_id}/{filename}"

        response = {
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
        requester = _DatasourceProviderListRequesterFake(response, [_plugin_datasource_provider("remote")])
        manager = PluginDatasourceManager(
            get_plugin_icon_url=get_plugin_icon_url,
            datasource_provider_list_requester=requester,
        )

        listed_providers = manager.fetch_datasource_providers("tenant-1")
        installed_providers = manager.fetch_installed_datasource_providers("tenant-1")

        assert requester.tenant_ids == ["tenant-1", "tenant-1"]
        assert len(requester.transformed_payloads) == 2
        for transformed in requester.transformed_payloads:
            providers = transformed.data
            assert providers is not None
            assert providers[0].declaration is None
            missing_identity = providers[1].declaration
            assert missing_identity is not None
            assert missing_identity.identity is None
            assert missing_identity.datasources is None
            unnamed = providers[2].declaration
            assert unnamed is not None
            assert unnamed.datasources is not None
            assert unnamed.datasources[0].identity.provider is None
            assert "output_schema" not in unnamed.datasources[0].model_dump(exclude_unset=True)
            named = providers[3].declaration
            assert named is not None
            assert named.datasources is not None
            assert named.datasources[0].identity.provider == "remote"
            assert "output_schema" not in named.datasources[0].model_dump(exclude_unset=True)

        assert len(listed_providers) == 2
        assert listed_providers[1].declaration.identity.name == "org/plugin/remote"
        assert len(installed_providers) == 1
        assert installed_providers[0].declaration.identity.name == "org/plugin/remote"

    def test_list_and_installed_provider_paths_use_custom_icon_resolver(self, mocker: MockerFixture) -> None:
        icon_url_calls: list[tuple[str, str]] = []
        requests: list[httpx.Request] = []

        def get_plugin_icon_url(tenant_id: str, filename: str) -> str:
            icon_url_calls.append((tenant_id, filename))
            return f"https://custom-icon-resolver.example/{tenant_id}/{filename}"

        declaration = datasource_provider_entity(DatasourceProviderType.ONLINE_DOCUMENT)
        declaration.identity.name = "remote"
        declaration.datasources = [datasource_entity("documents")]
        provider = PluginDatasourceProviderEntity(
            provider="remote",
            plugin_unique_identifier="org/plugin@1.0.0",
            plugin_id="org/plugin",
            declaration=declaration,
        )
        daemon_response = {"code": 0, "message": "", "data": [provider.model_dump(mode="json")]}

        def handle(request: httpx.Request) -> httpx.Response:
            requests.append(request)
            return httpx.Response(200, json=daemon_response)

        manager = PluginDatasourceManager(get_plugin_icon_url=get_plugin_icon_url)
        with httpx.Client(transport=httpx.MockTransport(handle)) as http_client:
            mocker.patch.object(plugin_client_module, "_httpx_client", http_client)
            listed_providers = manager.fetch_datasource_providers("tenant-1")
            installed_providers = manager.fetch_installed_datasource_providers("tenant-1")

        expected_icon_url = "https://custom-icon-resolver.example/tenant-1/icon.svg"
        assert len(requests) == 2
        assert [request.url.path for request in requests] == ["/plugin/tenant-1/management/datasources"] * 2
        assert [dict(request.url.params) for request in requests] == [{"page": "1", "page_size": "256"}] * 2
        assert len(listed_providers) == 2
        assert listed_providers[0].plugin_id == "langgenius/file"
        assert listed_providers[1].declaration.identity.name == "org/plugin/remote"
        assert listed_providers[1].declaration.datasources[0].identity.provider == "org/plugin/remote"
        assert len(installed_providers) == 1
        assert installed_providers[0].declaration.identity.name == "org/plugin/remote"
        assert installed_providers[0].declaration.datasources[0].identity.provider == "org/plugin/remote"
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
