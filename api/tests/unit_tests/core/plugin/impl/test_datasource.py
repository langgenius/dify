from collections.abc import Callable, Iterator
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
from core.schemas.resolver import SchemaType
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

    def __init__(self, response: dict[str, object]) -> None:
        """Inputs: ``response`` is daemon JSON accepted by the list transformer.
        Preconditions: The test supplies a supported payload shape.
        Result/effects: Stores the response and empty call records; no entities are fabricated.
        Failure: Transformer/Pydantic errors propagate when the fake is called.
        """
        self.response = response
        self.tenant_ids: list[str] = []
        self.transformed_payloads: list[PluginDatasourceListPayload] = []

    def request(
        self,
        *,
        tenant_id: str,
        transformer: Callable[[dict[str, object]], PluginDatasourceListPayload],
    ) -> list[PluginDatasourceProviderEntity]:
        """Inputs: Tenant scope and the raw-response transformer.
        Preconditions: Transformer accepts the stored JSON and yields complete records.
        Result/effects: Records calls/payloads; sparse records are never fabricated as entities.
        Failure: Transformer and entity-validation errors propagate.
        """
        self.tenant_ids.append(tenant_id)
        transformed = transformer(self.response)
        self.transformed_payloads.append(transformed)
        return [
            PluginDatasourceProviderEntity.model_validate(provider.model_dump(mode="json"))
            for provider in transformed.data or []
        ]


def _plugin_datasource_provider(name: str = "provider") -> PluginDatasourceProviderEntity:
    """Build one validated provider entity with a datasource. Inputs: ``name`` is the non-empty daemon provider name.
    Preconditions: Factory values satisfy the entity model.
    Result/effects: Returns a complete entity without external or shared-state effects.
    Failure: Pydantic validation errors propagate.
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
        """Inputs: Local provider ID and remote daemon payload with one schema reference.
        Preconditions: MockTransport and injected resolver accept the request and schema.
        Result/effects: Returns a normalized entity and records one GET and resolver input.
        Failure: Request, validation, and resolver errors fail the test.
        """
        resolved_schemas: list[SchemaType] = []

        def fake_schema_ref_resolver(schema: SchemaType) -> SchemaType:
            """Record and resolve one schema value. Inputs: A ``SchemaType`` passed by the manager.
            Preconditions: The value is representable by the schema type.
            Result/effects: Records the input and returns a deterministic schema.
            Failure: This fake does not raise for supported values.
            """
            resolved_schemas.append(schema)
            return {"resolved": True}

        manager = PluginDatasourceManager(schema_ref_resolver=fake_schema_ref_resolver)
        requests: list[httpx.Request] = []

        local = manager.fetch_datasource_provider("tenant-1", "langgenius/file/file")
        assert local.plugin_id == "langgenius/file"

        remote = _plugin_datasource_provider("provider")
        remote.declaration.datasources[0].output_schema = {"$ref": "#/x"}
        daemon_response = {"code": 0, "message": "", "data": remote.model_dump(mode="json")}

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
        assert resolved_schemas == [{"$ref": "#/x"}]

    def test_list_paths_use_injected_schema_ref_resolver(self) -> None:
        """Inputs: Complete daemon provider with a truthy output-schema reference.
        Preconditions: Fake requester applies the transformer; resolver accepts the schema.
        Result/effects: Both routes return resolved entities and record resolver calls.
        Failure: Request, transformation, validation, and resolver errors fail assertions.
        """
        resolved_schemas: list[SchemaType] = []

        def fake_schema_ref_resolver(schema: SchemaType) -> SchemaType:
            resolved_schemas.append(schema)
            return {"resolved": True}

        def get_plugin_icon_url(tenant_id: str, filename: str) -> str:
            return f"https://custom-icon-resolver.example/{tenant_id}/{filename}"

        provider = _plugin_datasource_provider("remote")
        provider.declaration.datasources[0].output_schema = {"$ref": "#/x"}
        response: dict[str, object] = {"data": [provider.model_dump(mode="json")]}
        requester = _DatasourceProviderListRequesterFake(response)
        manager = PluginDatasourceManager(
            get_plugin_icon_url=get_plugin_icon_url,
            datasource_provider_list_requester=requester,
            schema_ref_resolver=fake_schema_ref_resolver,
        )

        listed_providers = manager.fetch_datasource_providers("tenant-1")
        installed_providers = manager.fetch_installed_datasource_providers("tenant-1")

        assert requester.tenant_ids == ["tenant-1", "tenant-1"]
        assert len(requester.transformed_payloads) == 2
        assert resolved_schemas == [{"$ref": "#/x"}, {"$ref": "#/x"}]
        assert len(listed_providers) == 2
        listed_remote = listed_providers[1]
        assert listed_remote.declaration.identity.name == "org/plugin/remote"
        assert listed_remote.declaration.datasources[0].output_schema == {"resolved": True}
        assert len(installed_providers) == 1
        installed_remote = installed_providers[0]
        assert installed_remote.declaration.identity.name == "org/plugin/remote"
        assert installed_remote.declaration.datasources[0].output_schema == {"resolved": True}

    def test_list_payload_transformer_normalizes_sparse_optional_fields(self) -> None:
        """Inputs: Daemon list entries omit declarations, identities, and output schemas.
        Preconditions: The response matches the permissive payload model.
        Result/effects: Asserts normalized ``.data`` directly; no entity or network call occurs.
        Failure: Pydantic validation and schema-resolution errors fail the test.
        """
        response: dict[str, object] = {
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
        manager = PluginDatasourceManager()

        normalized = manager._transform_datasource_provider_list_response(response)

        providers = normalized.data
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
        assert "output_schema" not in unnamed.datasources[0].model_fields_set
        named = providers[3].declaration
        assert named is not None
        assert named.datasources is not None
        assert named.datasources[0].identity.provider == "remote"
        assert "output_schema" not in named.datasources[0].model_fields_set

    def test_default_schema_ref_resolver_resolves_builtin_schema(self) -> None:
        """Inputs: Daemon payload with a truthy Q&A ``$ref``.
        Preconditions: The default registry contains the Q&A schema.
        Result/effects: Production transformer returns expanded schema without root ref.
        Failure: Validation and resolver errors fail the test.
        """
        manager = PluginDatasourceManager()
        response: dict[str, object] = {
            "data": [
                {
                    "declaration": {
                        "identity": {"name": "remote"},
                        "datasources": [
                            {
                                "identity": {"provider": "remote"},
                                "output_schema": {"$ref": "https://dify.ai/schemas/v1/qa_structure.json"},
                            }
                        ],
                    }
                }
            ]
        }

        normalized = manager._transform_datasource_provider_list_response(response)

        providers = normalized.data
        assert providers is not None
        declaration = providers[0].declaration
        assert declaration is not None
        assert declaration.datasources is not None
        output_schema = declaration.datasources[0].output_schema
        assert isinstance(output_schema, dict)
        assert "$ref" not in output_schema
        assert output_schema["type"] == "object"
        assert output_schema["title"] == "Q&A Structure"
        properties = output_schema["properties"]
        assert isinstance(properties, dict)
        assert "qa_chunks" in properties

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

    def test_online_drive_download_file_streaming(self) -> None:
        class FakeOnlineDriveDownloadStreamRequester:
            def __init__(self, messages: list[OnlineDriveDownloadMessage]) -> None:
                self.messages = messages
                self.calls: list[
                    tuple[
                        str,
                        str,
                        type[OnlineDriveDownloadMessage],
                        dict[str, str],
                        dict[str, object],
                    ]
                ] = []

            def request_stream(
                self,
                method: str,
                path: str,
                response_model: type[OnlineDriveDownloadMessage],
                *,
                headers: dict[str, str],
                data: dict[str, object],
            ) -> Iterator[OnlineDriveDownloadMessage]:
                self.calls.append((method, path, response_model, headers, data))
                return iter(self.messages)

        download = OnlineDriveDownloadMessage(message=OnlineDriveDownloadMessage.TextMessage(text="download"))
        request = OnlineDriveDownloadFileRequest(id="file-1")
        requester = FakeOnlineDriveDownloadStreamRequester([download])
        manager = PluginDatasourceManager(online_drive_download_stream_requester=requester)

        assert list(
            manager.online_drive_download_file(
                "tenant-1",
                "user-1",
                "org/plugin/provider",
                "drive",
                {"k": "v"},
                request,
                "online_drive",
            )
        ) == [download]

        assert requester.calls == [
            (
                "POST",
                "plugin/tenant-1/dispatch/datasource/online_drive_download_file",
                OnlineDriveDownloadMessage,
                {
                    "X-Plugin-ID": "org/plugin",
                    "Content-Type": "application/json",
                },
                {
                    "user_id": "user-1",
                    "data": {
                        "provider": "provider",
                        "datasource": "drive",
                        "credentials": {"k": "v"},
                        "request": request.model_dump(),
                    },
                },
            )
        ]

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
