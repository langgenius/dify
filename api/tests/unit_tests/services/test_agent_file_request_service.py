from contextlib import nullcontext
from unittest.mock import MagicMock, patch

import pytest

from core.app.entities.app_invoke_entities import InvokeFrom, UserFrom
from core.app.file_access import FileAccessScope
from services.agent_file_request_service import AgentFileRequestError, AgentFileRequestService


def test_request_upload_uri_returns_origin_free_signed_uri() -> None:
    service = AgentFileRequestService(access_controller=MagicMock())
    with patch(
        "services.agent_file_request_service.get_signed_file_uri_for_plugin",
        return_value="/files/upload/for-plugin?sign=1",
    ) as sign:
        uri = service.request_upload_uri(
            filename="report.pdf",
            mimetype="application/pdf",
            tenant_id="tenant-1",
            user_id="user-1",
            conversation_id="conversation-1",
        )

    assert uri == "/files/upload/for-plugin?sign=1"
    sign.assert_called_once_with(
        filename="report.pdf",
        mimetype="application/pdf",
        tenant_id="tenant-1",
        user_id="user-1",
        conversation_id="conversation-1",
    )


def test_request_download_uri_uses_origin_free_uri_for_sandbox_transfer() -> None:
    file = MagicMock(filename="report.pdf", mime_type="application/pdf", size=123)
    service = AgentFileRequestService(access_controller=MagicMock())
    with (
        patch("services.agent_file_request_service.bind_file_access_scope", return_value=nullcontext()) as bind_scope,
        patch.object(service, "_build_file", return_value=file),
        patch.object(service._runtime, "resolve_file_uri", return_value="/files/tools/report.pdf?sign=1") as resolve,
    ):
        result = service.request_download_uri(
            tenant_id="tenant-1",
            user_id="user-1",
            user_from="account",
            invoke_from="debugger",
            file_mapping={"transfer_method": "tool_file", "reference": "dify-file-ref:value"},
            for_external=False,
        )

    scope = bind_scope.call_args.args[0]
    assert scope == FileAccessScope(
        tenant_id="tenant-1",
        user_id="user-1",
        user_from=UserFrom.ACCOUNT,
        invoke_from=InvokeFrom.DEBUGGER,
    )
    resolve.assert_called_once_with(file=file)
    assert result.download_uri == "/files/tools/report.pdf?sign=1"


def test_request_download_uri_preserves_frontend_display_url() -> None:
    file = MagicMock(filename="report.pdf", mime_type="application/pdf", size=123)
    service = AgentFileRequestService(access_controller=MagicMock())
    with (
        patch("services.agent_file_request_service.bind_file_access_scope", return_value=nullcontext()),
        patch.object(service, "_build_file", return_value=file),
        patch.object(
            service._runtime,
            "resolve_file_url",
            return_value="https://dify.example.com/files/tools/report.pdf?sign=1",
        ) as resolve,
    ):
        result = service.request_download_uri(
            tenant_id="tenant-1",
            user_id="user-1",
            user_from="end-user",
            invoke_from="web-app",
            file_mapping={"transfer_method": "tool_file", "reference": "dify-file-ref:value"},
            for_external=True,
        )

    resolve.assert_called_once_with(file=file, for_external=True)
    assert result.download_uri == "https://dify.example.com/files/tools/report.pdf?sign=1"


def test_request_download_uri_maps_inaccessible_file_to_404() -> None:
    service = AgentFileRequestService(access_controller=MagicMock())
    with (
        patch("services.agent_file_request_service.bind_file_access_scope", return_value=nullcontext()),
        patch.object(service, "_build_file", side_effect=ValueError("ToolFile missing")),
        pytest.raises(AgentFileRequestError) as exc_info,
    ):
        service.request_download_uri(
            tenant_id="tenant-1",
            user_id="user-1",
            user_from="account",
            invoke_from="debugger",
            file_mapping={"transfer_method": "tool_file", "reference": "dify-file-ref:value"},
            for_external=False,
        )

    assert exc_info.value.code == "file_not_accessible"
    assert exc_info.value.status_code == 404
