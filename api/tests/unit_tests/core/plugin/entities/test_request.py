import pytest
from pydantic import ValidationError

from core.workflow.file_reference import build_file_reference
from core.plugin.entities.request import RequestRequestDownloadFile


def test_request_download_file_accepts_tool_file_reference() -> None:
    reference = build_file_reference(record_id="tool-file-1")
    payload = RequestRequestDownloadFile.model_validate(
        {
            "tenant_id": "tenant-1",
            "user_id": "user-1",
            "user_from": "account",
            "invoke_from": "debugger",
            "file": {
                "transfer_method": "tool_file",
                "reference": reference,
            },
        }
    )

    assert payload.file.transfer_method == "tool_file"
    assert payload.file.reference == reference


def test_request_download_file_accepts_remote_url() -> None:
    payload = RequestRequestDownloadFile.model_validate(
        {
            "tenant_id": "tenant-1",
            "user_id": "user-1",
            "user_from": "end-user",
            "invoke_from": "service-api",
            "file": {
                "transfer_method": "remote_url",
                "url": "https://example.com/report.pdf",
            },
        }
    )

    assert payload.file.transfer_method == "remote_url"
    assert payload.file.url == "https://example.com/report.pdf"


def test_request_download_file_rejects_remote_url_without_url() -> None:
    with pytest.raises(ValidationError, match="url is required"):
        _ = RequestRequestDownloadFile.model_validate(
            {
                "tenant_id": "tenant-1",
                "user_id": "user-1",
                "user_from": "account",
                "invoke_from": "debugger",
                "file": {
                    "transfer_method": "remote_url",
                },
            }
        )


def test_request_download_file_rejects_remote_url_with_reference() -> None:
    reference = build_file_reference(record_id="tool-file-1")
    with pytest.raises(ValidationError, match="reference is not allowed"):
        _ = RequestRequestDownloadFile.model_validate(
            {
                "tenant_id": "tenant-1",
                "user_id": "user-1",
                "user_from": "account",
                "invoke_from": "debugger",
                "file": {
                    "transfer_method": "remote_url",
                    "url": "https://example.com/report.pdf",
                    "reference": reference,
                },
            }
        )


@pytest.mark.parametrize("transfer_method", ["tool_file", "local_file"])
def test_request_download_file_rejects_non_remote_without_reference(transfer_method: str) -> None:
    with pytest.raises(ValidationError, match="reference is required"):
        _ = RequestRequestDownloadFile.model_validate(
            {
                "tenant_id": "tenant-1",
                "user_id": "user-1",
                "user_from": "account",
                "invoke_from": "debugger",
                "file": {
                    "transfer_method": transfer_method,
                },
            }
        )


def test_request_download_file_rejects_non_canonical_reference() -> None:
    with pytest.raises(ValidationError, match="canonical Dify file reference"):
        _ = RequestRequestDownloadFile.model_validate(
            {
                "tenant_id": "tenant-1",
                "user_id": "user-1",
                "user_from": "account",
                "invoke_from": "debugger",
                "file": {
                    "transfer_method": "tool_file",
                    "reference": "raw-tool-file-uuid",
                },
            }
        )


@pytest.mark.parametrize("transfer_method", ["tool_file", "local_file", "datasource_file"])
def test_request_download_file_rejects_non_remote_with_url(transfer_method: str) -> None:
    reference = build_file_reference(record_id="tool-file-1")
    with pytest.raises(ValidationError, match="url is not allowed"):
        _ = RequestRequestDownloadFile.model_validate(
            {
                "tenant_id": "tenant-1",
                "user_id": "user-1",
                "user_from": "account",
                "invoke_from": "debugger",
                "file": {
                    "transfer_method": transfer_method,
                    "reference": reference,
                    "url": "https://example.com/report.pdf",
                },
            }
        )
