import base64
from unittest.mock import MagicMock

import pytest

from core.workflow.file_reference import build_file_reference
from graphon.file import File, FileTransferMethod, FileType
from graphon.file.file_manager import download, to_prompt_message_content
from graphon.file.runtime import get_workflow_file_runtime, set_workflow_file_runtime
from graphon.model_runtime.entities import (
    DocumentPromptMessageContent,
    ImagePromptMessageContent,
    TextPromptMessageContent,
)


def _build_file(
    *,
    transfer_method: FileTransferMethod,
    file_type: FileType = FileType.IMAGE,
    reference: str | None = None,
    remote_url: str | None = None,
    filename: str = "image.png",
    extension: str = ".png",
    mime_type: str = "image/png",
) -> File:
    return File(
        id="file-id",
        type=file_type,
        transfer_method=transfer_method,
        reference=reference,
        remote_url=remote_url,
        filename=filename,
        extension=extension,
        mime_type=mime_type,
        size=128,
    )


@pytest.fixture
def workflow_file_runtime():
    previous_runtime = get_workflow_file_runtime()
    runtime = MagicMock()
    set_workflow_file_runtime(runtime)
    try:
        yield runtime
    finally:
        set_workflow_file_runtime(previous_runtime)


@pytest.mark.parametrize(
    "transfer_method",
    [
        FileTransferMethod.LOCAL_FILE,
        FileTransferMethod.TOOL_FILE,
        FileTransferMethod.DATASOURCE_FILE,
    ],
)
def test_download_delegates_storage_backed_files_to_runtime_loader(workflow_file_runtime, transfer_method) -> None:
    workflow_file_runtime.load_file_bytes.return_value = b"payload"
    file = _build_file(
        transfer_method=transfer_method,
        reference=build_file_reference(record_id="file-id", storage_key="files/payload.bin"),
    )

    assert download(file) == b"payload"
    workflow_file_runtime.load_file_bytes.assert_called_once_with(file=file)


def test_download_remote_url_uses_runtime_http_get(workflow_file_runtime) -> None:
    response = MagicMock()
    response.content = b"remote-payload"
    workflow_file_runtime.http_get.return_value = response
    file = _build_file(
        transfer_method=FileTransferMethod.REMOTE_URL,
        remote_url="https://example.com/image.png",
    )

    assert download(file) == b"remote-payload"
    workflow_file_runtime.http_get.assert_called_once_with("https://example.com/image.png", follow_redirects=True)
    response.raise_for_status.assert_called_once_with()


def test_to_prompt_message_content_uses_runtime_url_resolution_for_images(workflow_file_runtime) -> None:
    workflow_file_runtime.multimodal_send_format = "url"
    workflow_file_runtime.resolve_file_url.return_value = "https://cdn.example.com/image.png"
    file = _build_file(
        transfer_method=FileTransferMethod.LOCAL_FILE,
        reference=build_file_reference(record_id="upload-file-id", storage_key="files/image.png"),
    )

    content = to_prompt_message_content(file, image_detail_config=ImagePromptMessageContent.DETAIL.HIGH)

    assert isinstance(content, ImagePromptMessageContent)
    assert content.url == "https://cdn.example.com/image.png"
    assert content.base64_data == ""
    assert content.detail == ImagePromptMessageContent.DETAIL.HIGH


def test_to_prompt_message_content_uses_runtime_file_loader_for_base64_documents(workflow_file_runtime) -> None:
    workflow_file_runtime.multimodal_send_format = "base64"
    workflow_file_runtime.load_file_bytes.return_value = b"document-bytes"
    file = _build_file(
        transfer_method=FileTransferMethod.TOOL_FILE,
        file_type=FileType.DOCUMENT,
        reference=build_file_reference(record_id="tool-file-id", storage_key="docs/report.pdf"),
        filename="report.pdf",
        extension=".pdf",
        mime_type="application/pdf",
    )

    content = to_prompt_message_content(file)

    assert isinstance(content, DocumentPromptMessageContent)
    assert content.base64_data == base64.b64encode(b"document-bytes").decode("utf-8")
    assert content.url == ""
    workflow_file_runtime.load_file_bytes.assert_called_once_with(file=file)


def test_to_prompt_message_content_returns_text_placeholder_for_custom_files() -> None:
    file = _build_file(
        transfer_method=FileTransferMethod.REMOTE_URL,
        file_type=FileType.CUSTOM,
        remote_url="https://example.com/archive.bin",
        filename="archive.bin",
        extension=".bin",
        mime_type="application/octet-stream",
    )

    content = to_prompt_message_content(file)

    assert isinstance(content, TextPromptMessageContent)
    assert content.data == "[Unsupported file type: archive.bin (custom)]"
