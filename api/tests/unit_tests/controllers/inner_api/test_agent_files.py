import inspect
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from flask import Flask

from controllers.inner_api.agent.files import AgentFileDownloadRequestApi, AgentFileUploadRequestApi
from core.workflow.file_reference import build_file_reference
from services.agent_file_request_service import AgentFileDownloadRequestResult

MODULE = "controllers.inner_api.agent.files"


def _raw(method):
    return inspect.unwrap(method)


def test_upload_request_uses_agent_owned_service_and_returns_uri(app: Flask) -> None:
    payload = {
        "tenant_id": "tenant-1",
        "user_id": "execution-user-1",
        "filename": "report.pdf",
        "mimetype": "application/pdf",
        "conversation_id": "conversation-1",
    }
    tenant = SimpleNamespace(id="tenant-1")
    user = SimpleNamespace(id="canonical-end-user-1")
    with app.test_request_context("/", method="POST", json=payload):
        with (
            patch(f"{MODULE}.db") as db,
            patch(f"{MODULE}.get_user", return_value=user),
            patch(f"{MODULE}.AgentFileRequestService") as service,
        ):
            db.session.get.return_value = tenant
            service.return_value.request_upload_uri.return_value = "/files/upload/for-plugin?sign=1"
            response = _raw(AgentFileUploadRequestApi.post)(AgentFileUploadRequestApi())

    assert response == {"upload_uri": "/files/upload/for-plugin?sign=1"}
    service.return_value.request_upload_uri.assert_called_once_with(
        filename="report.pdf",
        mimetype="application/pdf",
        tenant_id="tenant-1",
        user_id="canonical-end-user-1",
        conversation_id="conversation-1",
    )


def test_download_request_forwards_audience_and_returns_uri(app: Flask) -> None:
    reference = build_file_reference(record_id="tool-file-1")
    payload = {
        "tenant_id": "tenant-1",
        "user_id": "user-1",
        "user_from": "account",
        "invoke_from": "debugger",
        "file": {"transfer_method": "tool_file", "reference": reference},
        "for_external": False,
    }
    with app.test_request_context("/", method="POST", json=payload):
        with (
            patch(f"{MODULE}.db") as db,
            patch(f"{MODULE}.AgentFileRequestService") as service,
        ):
            db.session.get.return_value = MagicMock()
            service.return_value.request_download_uri.return_value = AgentFileDownloadRequestResult(
                filename="report.pdf",
                mime_type="application/pdf",
                size=123,
                download_uri="/files/tools/tool-file-1.pdf?sign=1",
            )
            response = _raw(AgentFileDownloadRequestApi.post)(AgentFileDownloadRequestApi())

    assert response == {
        "filename": "report.pdf",
        "mime_type": "application/pdf",
        "size": 123,
        "download_uri": "/files/tools/tool-file-1.pdf?sign=1",
    }
    service.return_value.request_download_uri.assert_called_once_with(
        tenant_id="tenant-1",
        user_id="user-1",
        user_from="account",
        invoke_from="debugger",
        file_mapping={"transfer_method": "tool_file", "reference": reference},
        for_external=False,
    )
