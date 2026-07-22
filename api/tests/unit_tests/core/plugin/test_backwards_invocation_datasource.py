from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from pydantic import ValidationError

from core.datasource.entities.datasource_entities import (
    DatasourceProviderType,
    GetOnlineDocumentPageContentRequest,
    OnlineDocumentPagesMessage,
    OnlineDriveBrowseFilesRequest,
    OnlineDriveDownloadFileRequest,
)
from core.plugin.backwards_invocation.datasource import PluginDatasourceBackwardsInvocation
from core.plugin.entities.request import RequestInvokeDatasource


def datasource_payload(**overrides) -> RequestInvokeDatasource:
    values = {
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
    runtime = MagicMock()
    runtime.runtime.credentials = {}
    runtime.datasource_provider_type.return_value = DatasourceProviderType.ONLINE_DOCUMENT
    runtime.get_online_document_pages.return_value = iter([message])
    controller = MagicMock()
    controller.entity.provider_type = DatasourceProviderType.ONLINE_DOCUMENT
    controller.need_credentials = True
    controller.get_datasource.return_value = runtime

    with (
        patch(
            "core.plugin.backwards_invocation.datasource.DatasourceManager.get_datasource_plugin_provider",
            return_value=controller,
        ) as get_provider,
        patch(
            "core.plugin.backwards_invocation.datasource.DatasourceProviderService.get_datasource_credentials",
            return_value={"token": "resolved-by-dify"},
        ) as get_credentials,
    ):
        result = list(
            PluginDatasourceBackwardsInvocation.invoke(
                user_id="user-1",
                tenant=SimpleNamespace(id="tenant-1"),
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
    runtime.get_online_document_pages.assert_called_once_with(
        user_id="user-1",
        datasource_parameters={"cursor": "next"},
        provider_type=DatasourceProviderType.ONLINE_DOCUMENT,
    )


def test_validate_credentials_uses_resolved_provider_controller() -> None:
    payload = datasource_payload(
        datasource_parameters={},
        operation="validate_credentials",
    )
    runtime = MagicMock()
    controller = MagicMock()
    controller.entity.provider_type = DatasourceProviderType.ONLINE_DOCUMENT
    controller.need_credentials = True
    controller.get_datasource.return_value = runtime

    with (
        patch(
            "core.plugin.backwards_invocation.datasource.DatasourceManager.get_datasource_plugin_provider",
            return_value=controller,
        ),
        patch(
            "core.plugin.backwards_invocation.datasource.DatasourceProviderService.get_datasource_credentials",
            return_value={"token": "resolved-by-dify"},
        ),
    ):
        result = list(
            PluginDatasourceBackwardsInvocation.invoke(
                user_id="user-1",
                tenant=SimpleNamespace(id="tenant-1"),
                payload=payload,
            )
        )

    assert result == [{"result": True}]
    controller.validate_credentials.assert_called_once_with(
        user_id="user-1",
        credentials={"token": "resolved-by-dify"},
    )


def test_invoke_website_crawl_uses_the_bound_datasource_plugin() -> None:
    payload = datasource_payload(
        datasource="crawl",
        datasource_parameters={"url": "https://example.com"},
        datasource_type=DatasourceProviderType.WEBSITE_CRAWL,
        operation="get_website_crawl",
        provider="langgenius/firecrawl_datasource/firecrawl",
    )
    message = MagicMock()
    runtime = MagicMock()
    runtime.runtime.credentials = {}
    runtime.datasource_provider_type.return_value = DatasourceProviderType.WEBSITE_CRAWL
    runtime.get_website_crawl.return_value = iter([message])
    controller = MagicMock()
    controller.entity.provider_type = DatasourceProviderType.WEBSITE_CRAWL
    controller.need_credentials = True
    controller.get_datasource.return_value = runtime

    with (
        patch(
            "core.plugin.backwards_invocation.datasource.DatasourceManager.get_datasource_plugin_provider",
            return_value=controller,
        ),
        patch(
            "core.plugin.backwards_invocation.datasource.DatasourceProviderService.get_datasource_credentials",
            return_value={"api_key": "resolved-by-dify"},
        ),
    ):
        result = list(
            PluginDatasourceBackwardsInvocation.invoke(
                user_id="user-1",
                tenant=SimpleNamespace(id="tenant-1"),
                payload=payload,
            )
        )

    assert result == [message]
    assert runtime.runtime.credentials == {"api_key": "resolved-by-dify"}
    runtime.get_website_crawl.assert_called_once_with(
        user_id="user-1",
        datasource_parameters={"url": "https://example.com"},
        provider_type=DatasourceProviderType.WEBSITE_CRAWL,
    )


def test_invoke_online_document_content_builds_the_dify_request_entity() -> None:
    page = GetOnlineDocumentPageContentRequest(workspace_id="workspace-1", page_id="page-1", type="page")
    payload = datasource_payload(
        datasource_parameters={},
        operation="get_online_document_page_content",
        page=page,
    )
    message = MagicMock()
    runtime = MagicMock()
    runtime.runtime.credentials = {}
    runtime.datasource_provider_type.return_value = DatasourceProviderType.ONLINE_DOCUMENT
    runtime.get_online_document_page_content.return_value = iter([message])
    controller = MagicMock()
    controller.entity.provider_type = DatasourceProviderType.ONLINE_DOCUMENT
    controller.need_credentials = True
    controller.get_datasource.return_value = runtime

    with (
        patch(
            "core.plugin.backwards_invocation.datasource.DatasourceManager.get_datasource_plugin_provider",
            return_value=controller,
        ),
        patch(
            "core.plugin.backwards_invocation.datasource.DatasourceProviderService.get_datasource_credentials",
            return_value={"token": "resolved-by-dify"},
        ),
    ):
        result = list(
            PluginDatasourceBackwardsInvocation.invoke(
                user_id="user-1",
                tenant=SimpleNamespace(id="tenant-1"),
                payload=payload,
            )
        )

    assert result == [message]
    runtime.get_online_document_page_content.assert_called_once_with(
        user_id="user-1",
        datasource_parameters=page,
        provider_type=DatasourceProviderType.ONLINE_DOCUMENT,
    )


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
    message = MagicMock()
    runtime = MagicMock()
    runtime.runtime.credentials = {}
    runtime.datasource_provider_type.return_value = DatasourceProviderType.ONLINE_DRIVE
    getattr(runtime, method_name).return_value = iter([message])
    controller = MagicMock()
    controller.entity.provider_type = DatasourceProviderType.ONLINE_DRIVE
    controller.need_credentials = True
    controller.get_datasource.return_value = runtime

    with (
        patch(
            "core.plugin.backwards_invocation.datasource.DatasourceManager.get_datasource_plugin_provider",
            return_value=controller,
        ),
        patch(
            "core.plugin.backwards_invocation.datasource.DatasourceProviderService.get_datasource_credentials",
            return_value={"token": "resolved-by-dify"},
        ),
    ):
        result = list(
            PluginDatasourceBackwardsInvocation.invoke(
                user_id="user-1",
                tenant=SimpleNamespace(id="tenant-1"),
                payload=payload,
            )
        )

    assert result == [message]
    call = getattr(runtime, method_name).call_args
    assert call.kwargs["user_id"] == "user-1"
    assert call.kwargs["provider_type"] == DatasourceProviderType.ONLINE_DRIVE
    assert call.kwargs["request"] == request_type.model_validate(request_data)


def test_invoke_rejects_missing_required_credential() -> None:
    payload = datasource_payload()
    controller = MagicMock()
    controller.entity.provider_type = DatasourceProviderType.ONLINE_DOCUMENT
    controller.need_credentials = True
    controller.get_datasource.return_value = MagicMock()

    with (
        patch(
            "core.plugin.backwards_invocation.datasource.DatasourceManager.get_datasource_plugin_provider",
            return_value=controller,
        ),
        patch(
            "core.plugin.backwards_invocation.datasource.DatasourceProviderService.get_datasource_credentials",
            return_value={},
        ),
        pytest.raises(ValueError, match="Datasource credential not found"),
    ):
        list(
            PluginDatasourceBackwardsInvocation.invoke(
                user_id="user-1",
                tenant=SimpleNamespace(id="tenant-1"),
                payload=payload,
            )
        )


def test_invoke_rejects_provider_declaration_type_mismatch() -> None:
    payload = datasource_payload()
    controller = MagicMock()
    controller.entity.provider_type = DatasourceProviderType.ONLINE_DRIVE

    with (
        patch(
            "core.plugin.backwards_invocation.datasource.DatasourceManager.get_datasource_plugin_provider",
            return_value=controller,
        ),
        pytest.raises(ValueError, match="Datasource provider type mismatch"),
    ):
        list(
            PluginDatasourceBackwardsInvocation.invoke(
                user_id="user-1",
                tenant=SimpleNamespace(id="tenant-1"),
                payload=payload,
            )
        )
