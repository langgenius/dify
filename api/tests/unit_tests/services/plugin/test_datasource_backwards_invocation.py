import json
from collections.abc import Generator, Iterator
from dataclasses import dataclass, field
from unittest.mock import patch

import pytest
from pydantic import ValidationError

from core.datasource.entities.datasource_entities import (
    DatasourceProviderType,
    GetOnlineDocumentPageContentRequest,
    OnlineDocumentPagesMessage,
    OnlineDriveBrowseFilesRequest,
    OnlineDriveBrowseFilesResponse,
    OnlineDriveDownloadFileRequest,
    OnlineDriveDownloadMessage,
)
from core.plugin.entities.request import RequestInvokeDatasource
from models.account import Tenant
from services.plugin.datasource_backwards_invocation import PluginDatasourceBackwardsInvocation
from tests.unit_tests.knowledge_fs_core_fakes import Marker


def _tenant() -> Tenant:
    tenant = Tenant(name="Test workspace")
    tenant.id = "tenant-1"
    return tenant


@dataclass
class _RuntimeState:
    credentials: dict[str, object] = field(default_factory=dict)


@dataclass
class _FakeDatasource:
    """Bound datasource plugin double that records each operation call and yields canned messages."""

    provider_type: DatasourceProviderType
    messages: list[object] = field(default_factory=list)
    runtime: _RuntimeState = field(default_factory=_RuntimeState)
    calls: list[tuple[str, dict[str, object]]] = field(default_factory=list)

    def datasource_provider_type(self) -> DatasourceProviderType:
        return self.provider_type

    def _record(self, operation: str, kwargs: dict[str, object]) -> Iterator[object]:
        self.calls.append((operation, kwargs))
        return iter(self.messages)

    def get_website_crawl(self, **kwargs: object) -> Iterator[object]:
        return self._record("get_website_crawl", kwargs)

    def get_online_document_pages(self, **kwargs: object) -> Iterator[object]:
        return self._record("get_online_document_pages", kwargs)

    def get_online_document_page_content(self, **kwargs: object) -> Iterator[object]:
        return self._record("get_online_document_page_content", kwargs)

    def online_drive_browse_files(self, **kwargs: object) -> Iterator[object]:
        return self._record("online_drive_browse_files", kwargs)

    def online_drive_download_file(self, **kwargs: object) -> Iterator[object]:
        return self._record("online_drive_download_file", kwargs)


@dataclass(frozen=True)
class _ProviderEntity:
    provider_type: DatasourceProviderType


@dataclass
class _FakeController:
    entity: _ProviderEntity
    datasource: _FakeDatasource | None = None
    need_credentials: bool = True
    requested_datasources: list[str] = field(default_factory=list)
    validations: list[dict[str, object]] = field(default_factory=list)

    def get_datasource(self, datasource_name: str) -> _FakeDatasource:
        self.requested_datasources.append(datasource_name)
        assert self.datasource is not None
        return self.datasource

    def validate_credentials(self, **kwargs: object) -> None:
        self.validations.append(kwargs)


def _controller(datasource: _FakeDatasource) -> _FakeController:
    return _FakeController(entity=_ProviderEntity(datasource.provider_type), datasource=datasource)


def datasource_payload(**overrides: object) -> RequestInvokeDatasource:
    values: dict[str, object] = {
        "credential_id": "credential-1",
        "datasource": "notion_datasource",
        "datasource_parameters": {"cursor": "next"},
        "datasource_type": DatasourceProviderType.ONLINE_DOCUMENT,
        "operation": "get_online_document_pages",
        "provider": "langgenius/notion_datasource/notion_datasource",
        "tenant_id": "tenant-1",
        "user_id": "knowledge-fs",
    }
    values.update(overrides)
    return RequestInvokeDatasource.model_validate(values)


def test_request_rejects_raw_credentials() -> None:
    with pytest.raises(ValidationError):
        datasource_payload(credentials={"token": "must-not-cross-inner-api"})


def test_request_rejects_operation_and_datasource_type_mismatch() -> None:
    with pytest.raises(ValidationError, match="requires datasource_type"):
        datasource_payload(datasource_type=DatasourceProviderType.ONLINE_DRIVE)


def test_invoke_online_document_uses_dify_bound_runtime_and_credential() -> None:
    payload = datasource_payload()
    message = OnlineDocumentPagesMessage(result=[])
    runtime = _FakeDatasource(DatasourceProviderType.ONLINE_DOCUMENT, messages=[message])
    controller = _controller(runtime)

    with (
        patch(
            "services.plugin.datasource_backwards_invocation.DatasourceManager.get_datasource_plugin_provider",
            return_value=controller,
        ) as get_provider,
        patch(
            "services.data_source.provider_service.DatasourceProviderService.get_datasource_credentials",
            return_value={"token": "resolved-by-dify"},
        ) as get_credentials,
    ):
        result = list(
            PluginDatasourceBackwardsInvocation.invoke(
                user_id="user-1",
                tenant=_tenant(),
                payload=payload,
            )
        )

    assert result == [message]
    get_provider.assert_called_once_with(
        provider_id="langgenius/notion_datasource/notion_datasource",
        tenant_id="tenant-1",
        datasource_type=DatasourceProviderType.ONLINE_DOCUMENT,
    )
    get_credentials.assert_called_once_with(
        tenant_id="tenant-1",
        provider="notion_datasource",
        plugin_id="langgenius/notion_datasource",
        credential_id="credential-1",
    )
    assert runtime.runtime.credentials == {"token": "resolved-by-dify"}
    assert controller.requested_datasources == ["notion_datasource"]
    assert runtime.calls == [
        (
            "get_online_document_pages",
            {
                "user_id": "user-1",
                "datasource_parameters": {"cursor": "next"},
                "provider_type": DatasourceProviderType.ONLINE_DOCUMENT,
            },
        )
    ]


def test_validate_credentials_uses_resolved_provider_controller() -> None:
    payload = datasource_payload(
        datasource_parameters={},
        operation="validate_credentials",
    )
    runtime = _FakeDatasource(DatasourceProviderType.ONLINE_DOCUMENT)
    controller = _controller(runtime)

    with (
        patch(
            "services.plugin.datasource_backwards_invocation.DatasourceManager.get_datasource_plugin_provider",
            return_value=controller,
        ),
        patch(
            "services.data_source.provider_service.DatasourceProviderService.get_datasource_credentials",
            return_value={"token": "resolved-by-dify"},
        ),
    ):
        result = list(
            PluginDatasourceBackwardsInvocation.invoke(
                user_id="user-1",
                tenant=_tenant(),
                payload=payload,
            )
        )

    assert result == [{"result": True}]
    assert controller.validations == [{"user_id": "user-1", "credentials": {"token": "resolved-by-dify"}}]
    assert runtime.calls == []


def test_invoke_website_crawl_uses_the_bound_datasource_plugin() -> None:
    payload = datasource_payload(
        datasource="crawl",
        datasource_parameters={"url": "https://example.com"},
        datasource_type=DatasourceProviderType.WEBSITE_CRAWL,
        operation="get_website_crawl",
        provider="langgenius/firecrawl_datasource/firecrawl",
    )
    message = Marker("datasource-message")
    runtime = _FakeDatasource(DatasourceProviderType.WEBSITE_CRAWL, messages=[message])
    controller = _controller(runtime)

    with (
        patch(
            "services.plugin.datasource_backwards_invocation.DatasourceManager.get_datasource_plugin_provider",
            return_value=controller,
        ),
        patch(
            "services.data_source.provider_service.DatasourceProviderService.get_datasource_credentials",
            return_value={"api_key": "resolved-by-dify"},
        ),
    ):
        result = list(
            PluginDatasourceBackwardsInvocation.invoke(
                user_id="user-1",
                tenant=_tenant(),
                payload=payload,
            )
        )

    assert result == [message]
    assert runtime.runtime.credentials == {"api_key": "resolved-by-dify"}
    assert runtime.calls == [
        (
            "get_website_crawl",
            {
                "user_id": "user-1",
                "datasource_parameters": {"url": "https://example.com"},
                "provider_type": DatasourceProviderType.WEBSITE_CRAWL,
            },
        )
    ]


def test_invoke_online_document_content_builds_the_dify_request_entity() -> None:
    page = GetOnlineDocumentPageContentRequest(workspace_id="workspace-1", page_id="page-1", type="page")
    payload = datasource_payload(
        datasource_parameters={},
        operation="get_online_document_page_content",
        page=page,
    )
    message = Marker("datasource-message")
    runtime = _FakeDatasource(DatasourceProviderType.ONLINE_DOCUMENT, messages=[message])
    controller = _controller(runtime)

    with (
        patch(
            "services.plugin.datasource_backwards_invocation.DatasourceManager.get_datasource_plugin_provider",
            return_value=controller,
        ),
        patch(
            "services.data_source.provider_service.DatasourceProviderService.get_datasource_credentials",
            return_value={"token": "resolved-by-dify"},
        ),
    ):
        result = list(
            PluginDatasourceBackwardsInvocation.invoke(
                user_id="user-1",
                tenant=_tenant(),
                payload=payload,
            )
        )

    assert result == [message]
    assert runtime.calls == [
        (
            "get_online_document_page_content",
            {
                "user_id": "user-1",
                "datasource_parameters": page,
                "provider_type": DatasourceProviderType.ONLINE_DOCUMENT,
            },
        )
    ]


@pytest.mark.parametrize(
    ("operation", "request_data", "request_type", "method_name"),
    [
        (
            "online_drive_browse_files",
            {"bucket": "bucket-1", "max_keys": 20, "next_page_parameters": {"page": "2"}, "prefix": "docs/"},
            OnlineDriveBrowseFilesRequest,
            "online_drive_browse_files",
        ),
        (
            "online_drive_download_file",
            {"bucket": "bucket-1", "id": "file-1"},
            OnlineDriveDownloadFileRequest,
            "online_drive_download_file",
        ),
    ],
)
def test_invoke_online_drive_builds_typed_dify_requests(
    operation: str,
    request_data: dict[str, object],
    request_type: type[OnlineDriveBrowseFilesRequest] | type[OnlineDriveDownloadFileRequest],
    method_name: str,
) -> None:
    payload = datasource_payload(
        datasource="drive",
        datasource_parameters={},
        datasource_type=DatasourceProviderType.ONLINE_DRIVE,
        operation=operation,
        provider="langgenius/google_drive/google_drive",
        request=request_data,
    )
    message = Marker("datasource-message")
    runtime = _FakeDatasource(DatasourceProviderType.ONLINE_DRIVE, messages=[message])
    controller = _controller(runtime)

    with (
        patch(
            "services.plugin.datasource_backwards_invocation.DatasourceManager.get_datasource_plugin_provider",
            return_value=controller,
        ),
        patch(
            "services.data_source.provider_service.DatasourceProviderService.get_datasource_credentials",
            return_value={"token": "resolved-by-dify"},
        ),
    ):
        result = list(
            PluginDatasourceBackwardsInvocation.invoke(
                user_id="user-1",
                tenant=_tenant(),
                payload=payload,
            )
        )

    assert result == [message]
    assert len(runtime.calls) == 1
    called_operation, call_kwargs = runtime.calls[0]
    assert called_operation == method_name
    assert call_kwargs["user_id"] == "user-1"
    assert call_kwargs["provider_type"] == DatasourceProviderType.ONLINE_DRIVE
    assert call_kwargs["request"] == request_type.model_validate(request_data)


def test_online_drive_metadata_and_binary_survive_the_inner_event_stream() -> None:
    browse = OnlineDriveBrowseFilesResponse.model_validate(
        {
            "result": [
                {
                    "bucket": "bucket-1",
                    "files": [
                        {
                            "id": "file-1",
                            "name": "report.bin",
                            "size": 3,
                            "type": "file",
                            "remote_metadata": {
                                "version_id": "browse-v2",
                                "etag": '"browse-etag"',
                                "checksum": {"algorithm": "sha256", "value": "A" * 64},
                                "modified_time": "2026-09-09T00:00:00Z",
                                "credentials": "must-not-cross",
                            },
                        }
                    ],
                }
            ]
        }
    )
    blob = OnlineDriveDownloadMessage.model_validate(
        {
            "type": "blob",
            "message": {"blob": "AP+A"},
            "meta": {"remote_metadata": {"version_id": "download-v2"}},
        }
    )
    chunk = OnlineDriveDownloadMessage.model_validate(
        {
            "type": "blob_chunk",
            "message": {
                "id": "download-1",
                "sequence": 0,
                "total_length": 3,
                "blob": "AP+A",
                "end": True,
            },
            "meta": {
                "remote_metadata": {
                    "version_id": "download-v2",
                    "etag": '"download-etag"',
                    "checksum": {"algorithm": "md5", "value": "B" * 32},
                    "modified_time": "2026-09-09T00:01:00Z",
                    "credentials": "must-not-cross",
                }
            },
        }
    )

    def responses() -> Generator[OnlineDriveBrowseFilesResponse | OnlineDriveDownloadMessage]:
        yield browse
        yield blob
        yield chunk

    events = [
        json.loads(event.decode()) for event in PluginDatasourceBackwardsInvocation.convert_to_event_stream(responses())
    ]

    assert events[0]["data"]["result"][0]["files"][0]["remote_metadata"] == {
        "version_id": "browse-v2",
        "etag": '"browse-etag"',
        "checksum": {"algorithm": "sha256", "value": "a" * 64},
        "modified_time": "2026-09-09T00:00:00Z",
    }
    assert events[1]["data"] == {
        "type": "blob",
        "message": {"blob": "AP+A"},
        "meta": {"remote_metadata": {"version_id": "download-v2"}},
    }
    assert events[2]["data"] == {
        "type": "blob_chunk",
        "message": {
            "id": "download-1",
            "sequence": 0,
            "total_length": 3,
            "blob": "AP+A",
            "end": True,
        },
        "meta": {
            "remote_metadata": {
                "version_id": "download-v2",
                "etag": '"download-etag"',
                "checksum": {"algorithm": "md5", "value": "b" * 32},
                "modified_time": "2026-09-09T00:01:00Z",
            }
        },
    }


def test_invoke_rejects_missing_required_credential() -> None:
    payload = datasource_payload()
    controller = _controller(_FakeDatasource(DatasourceProviderType.ONLINE_DOCUMENT))

    with (
        patch(
            "services.plugin.datasource_backwards_invocation.DatasourceManager.get_datasource_plugin_provider",
            return_value=controller,
        ),
        patch(
            "services.data_source.provider_service.DatasourceProviderService.get_datasource_credentials",
            return_value={},
        ),
        pytest.raises(ValueError, match="Datasource credential not found"),
    ):
        list(
            PluginDatasourceBackwardsInvocation.invoke(
                user_id="user-1",
                tenant=_tenant(),
                payload=payload,
            )
        )


def test_invoke_rejects_provider_declaration_type_mismatch() -> None:
    payload = datasource_payload()
    controller = _FakeController(entity=_ProviderEntity(DatasourceProviderType.ONLINE_DRIVE))

    with (
        patch(
            "services.plugin.datasource_backwards_invocation.DatasourceManager.get_datasource_plugin_provider",
            return_value=controller,
        ),
        pytest.raises(ValueError, match="Datasource provider type mismatch"),
    ):
        list(
            PluginDatasourceBackwardsInvocation.invoke(
                user_id="user-1",
                tenant=_tenant(),
                payload=payload,
            )
        )
