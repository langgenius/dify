"""Unit tests for the Agent Files download-request service (ENG-592)."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import patch

import pytest

from services.agent_file_request_service import AgentFileDownloadRequestService, FileDownloadRequestError

_MOD = "services.agent_file_request_service"


def _fake_file() -> SimpleNamespace:
    return SimpleNamespace(filename="report.pdf", mime_type="application/pdf", size=12)


def test_resolve_returns_metadata_and_internal_url():
    with (
        patch(f"{_MOD}.file_factory.build_from_mapping", return_value=_fake_file()) as build,
        patch(f"{_MOD}.DifyWorkflowFileRuntime") as runtime_cls,
    ):
        runtime_cls.return_value.resolve_file_url.return_value = "http://internal/files/x?sign=1"
        data = AgentFileDownloadRequestService.resolve(
            tenant_id="tenant-1",
            user_id="user-1",
            user_from="account",
            invoke_from="service-api",
            file_mapping={"transfer_method": "tool_file", "reference": "tool-file-1"},
        )

    assert data == {
        "filename": "report.pdf",
        "mime_type": "application/pdf",
        "size": 12,
        "download_url": "http://internal/files/x?sign=1",
    }
    assert build.call_args.kwargs["tenant_id"] == "tenant-1"
    # Sandbox/agent backend consumes the URL -> must be internal, not external.
    assert runtime_cls.return_value.resolve_file_url.call_args.kwargs["for_external"] is False


@pytest.mark.parametrize(
    ("user_from", "invoke_from", "code"),
    [
        ("bogus", "service-api", "invalid_access_context"),
        ("account", "not-a-source", "invalid_access_context"),
    ],
)
def test_invalid_access_context_rejected(user_from: str, invoke_from: str, code: str):
    with pytest.raises(FileDownloadRequestError) as exc_info:
        AgentFileDownloadRequestService.resolve(
            tenant_id="t",
            user_id="u",
            user_from=user_from,
            invoke_from=invoke_from,
            file_mapping={"transfer_method": "tool_file", "reference": "x"},
        )
    assert exc_info.value.status_code == 400
    assert exc_info.value.code == code


def test_missing_transfer_method_rejected():
    with pytest.raises(FileDownloadRequestError) as exc_info:
        AgentFileDownloadRequestService.resolve(
            tenant_id="t",
            user_id="u",
            user_from="account",
            invoke_from="service-api",
            file_mapping={},
        )
    assert exc_info.value.status_code == 400
    assert exc_info.value.code == "invalid_file_mapping"


def test_inaccessible_file_maps_to_404():
    with patch(f"{_MOD}.file_factory.build_from_mapping", side_effect=ValueError("ToolFile x not found")):
        with pytest.raises(FileDownloadRequestError) as exc_info:
            AgentFileDownloadRequestService.resolve(
                tenant_id="t",
                user_id="u",
                user_from="end-user",
                invoke_from="web-app",
                file_mapping={"transfer_method": "tool_file", "reference": "x"},
            )
    assert exc_info.value.status_code == 404
    assert exc_info.value.code == "file_not_accessible"


def test_unresolved_url_maps_to_502():
    with (
        patch(f"{_MOD}.file_factory.build_from_mapping", return_value=_fake_file()),
        patch(f"{_MOD}.DifyWorkflowFileRuntime") as runtime_cls,
    ):
        runtime_cls.return_value.resolve_file_url.return_value = None
        with pytest.raises(FileDownloadRequestError) as exc_info:
            AgentFileDownloadRequestService.resolve(
                tenant_id="t",
                user_id="u",
                user_from="account",
                invoke_from="service-api",
                file_mapping={"transfer_method": "tool_file", "reference": "x"},
            )
    assert exc_info.value.status_code == 502
