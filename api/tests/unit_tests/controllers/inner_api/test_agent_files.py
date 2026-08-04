import inspect
from collections.abc import Callable
from types import SimpleNamespace
from typing import cast
from unittest.mock import MagicMock, patch

import pytest
from flask import Flask

from controllers.inner_api.agent.files import AgentFileDownloadRequestApi, AgentFileUploadRequestApi
from core.workflow.file_reference import build_file_reference
from services.file_request_service import DownloadFileRequestResult

MODULE = "controllers.inner_api.agent.files"


def _raw[R](method: Callable[..., R]) -> Callable[..., R]:
    return cast(Callable[..., R], inspect.unwrap(method))


def test_upload_request_returns_origin_free_uri(app: Flask) -> None:
    payload = {
        "tenant_id": "tenant-1",
        "user_id": "execution-user-1",
        "filename": "report.pdf",
        "mimetype": "application/pdf",
        "conversation_id": "conversation-1",
    }
    tenant = SimpleNamespace(id="tenant-1")
    user = SimpleNamespace(id="canonical-end-user-1")
    session = MagicMock()
    with app.test_request_context("/", method="POST", json=payload):
        with (
            patch(f"{MODULE}.TenantService") as tenant_service,
            patch(f"{MODULE}.get_user", return_value=user),
            patch(f"{MODULE}.get_signed_file_uri_for_plugin", return_value="/files/upload/for-plugin?sign=1") as sign,
        ):
            tenant_service.get_tenant_by_id.return_value = tenant
            response = _raw(AgentFileUploadRequestApi.post)(AgentFileUploadRequestApi(), session)

    assert response == {"upload_uri": "/files/upload/for-plugin?sign=1"}
    tenant_service.get_tenant_by_id.assert_called_once_with("tenant-1", session=session)
    sign.assert_called_once_with(
        filename="report.pdf",
        mimetype="application/pdf",
        tenant_id="tenant-1",
        user_id="canonical-end-user-1",
        conversation_id="conversation-1",
    )


def test_download_request_returns_origin_free_uri_for_sandbox(app: Flask) -> None:
    reference = build_file_reference(record_id="tool-file-1")
    payload = {
        "tenant_id": "tenant-1",
        "user_id": "user-1",
        "user_from": "account",
        "invoke_from": "debugger",
        "file": {"transfer_method": "tool_file", "reference": reference},
        "for_frontend": False,
    }
    session = MagicMock()
    with app.test_request_context("/", method="POST", json=payload):
        with (
            patch(f"{MODULE}.TenantService") as tenant_service,
            patch(f"{MODULE}.FileRequestService") as service,
        ):
            tenant_service.get_tenant_by_id.return_value = MagicMock()
            service.return_value.request_download.return_value = DownloadFileRequestResult(
                filename="report.pdf",
                mime_type="application/pdf",
                size=123,
                download_uri="/files/tools/tool-file-1.pdf?sign=1",
            )
            response = _raw(AgentFileDownloadRequestApi.post)(AgentFileDownloadRequestApi(), session)

    assert response == {
        "filename": "report.pdf",
        "mime_type": "application/pdf",
        "size": 123,
        "download_uri": "/files/tools/tool-file-1.pdf?sign=1",
    }
    service.return_value.request_download.assert_called_once_with(
        tenant_id="tenant-1",
        user_id="user-1",
        user_from="account",
        invoke_from="debugger",
        file_mapping={"transfer_method": "tool_file", "reference": reference},
    )


def test_download_request_binds_frontend_url(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    reference = build_file_reference(record_id="tool-file-1")
    payload = {
        "tenant_id": "tenant-1",
        "user_id": "user-1",
        "user_from": "account",
        "invoke_from": "debugger",
        "file": {"transfer_method": "tool_file", "reference": reference},
        "for_frontend": True,
    }
    monkeypatch.setattr(f"{MODULE}.dify_config.FILES_URL", "https://files.example.com")
    session = MagicMock()
    with app.test_request_context("/", method="POST", json=payload):
        with (
            patch(f"{MODULE}.TenantService") as tenant_service,
            patch(f"{MODULE}.FileRequestService") as service,
        ):
            tenant_service.get_tenant_by_id.return_value = MagicMock()
            service.return_value.request_download.return_value = DownloadFileRequestResult(
                filename="report.pdf",
                mime_type="application/pdf",
                size=123,
                download_uri="/files/tools/tool-file-1.pdf?sign=1",
            )
            response = _raw(AgentFileDownloadRequestApi.post)(AgentFileDownloadRequestApi(), session)

    assert response["download_uri"] == "https://files.example.com/files/tools/tool-file-1.pdf?sign=1"
