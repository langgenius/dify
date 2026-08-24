import inspect
from collections.abc import Callable
from typing import cast
from unittest.mock import patch

import pytest
from flask import Flask
from sqlalchemy.orm import Session

from controllers.inner_api.agent.files import (
    AgentFileDownloadRequestApi,
    AgentFileUploadRequestApi,
    AgentFileUploadRequestPayload,
)
from core.workflow.file_reference import build_file_reference
from models.account import Account, Tenant
from services.file_request_service import DownloadFileRequestResult

MODULE = "controllers.inner_api.agent.files"


def _tenant() -> Tenant:
    tenant = Tenant(name="Test Workspace")
    tenant.id = "tenant-1"
    return tenant


def _raw[R](method: Callable[..., R]) -> Callable[..., R]:
    return cast(Callable[..., R], inspect.unwrap(method))


def test_upload_request_returns_origin_free_uri(app: Flask, unbound_session: Session) -> None:
    payload = {
        "tenant_id": "tenant-1",
        "user_id": "execution-user-1",
        "filename": "report.pdf",
        "mimetype": "application/pdf",
        "conversation_id": "conversation-1",
        "max_size": 64 * 1024 * 1024,
    }
    tenant = _tenant()
    user = Account(name="Canonical user", email="canonical@example.com")
    user.id = "canonical-end-user-1"
    session = unbound_session
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
        user_from=None,
        max_size=64 * 1024 * 1024,
    )


def test_upload_request_payload_requires_non_negative_max_size() -> None:
    payload = {
        "tenant_id": "tenant-1",
        "user_id": "user-1",
        "filename": "report.pdf",
        "mimetype": "application/pdf",
    }

    with pytest.raises(ValueError):
        AgentFileUploadRequestPayload.model_validate(payload)
    with pytest.raises(ValueError):
        AgentFileUploadRequestPayload.model_validate({**payload, "max_size": -1})

    assert AgentFileUploadRequestPayload.model_validate({**payload, "max_size": 0}).max_size == 0


def test_download_request_returns_origin_free_uri_for_sandbox(app: Flask, unbound_session: Session) -> None:
    reference = build_file_reference(record_id="tool-file-1")
    payload = {
        "tenant_id": "tenant-1",
        "user_id": "user-1",
        "user_from": "account",
        "invoke_from": "debugger",
        "file": {"transfer_method": "tool_file", "reference": reference},
        "for_frontend": False,
    }
    session = unbound_session
    with app.test_request_context("/", method="POST", json=payload):
        with (
            patch(f"{MODULE}.TenantService") as tenant_service,
            patch(f"{MODULE}.FileRequestService") as service,
        ):
            tenant_service.get_tenant_by_id.return_value = _tenant()
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


def test_download_request_binds_frontend_url(
    app: Flask, monkeypatch: pytest.MonkeyPatch, unbound_session: Session
) -> None:
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
    session = unbound_session
    with app.test_request_context("/", method="POST", json=payload):
        with (
            patch(f"{MODULE}.TenantService") as tenant_service,
            patch(f"{MODULE}.FileRequestService") as service,
        ):
            tenant_service.get_tenant_by_id.return_value = _tenant()
            service.return_value.request_download.return_value = DownloadFileRequestResult(
                filename="report.pdf",
                mime_type="application/pdf",
                size=123,
                download_uri="/files/tools/tool-file-1.pdf?sign=1",
            )
            response = _raw(AgentFileDownloadRequestApi.post)(AgentFileDownloadRequestApi(), session)

    assert response["download_uri"] == "https://files.example.com/files/tools/tool-file-1.pdf?sign=1"
