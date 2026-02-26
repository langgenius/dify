from __future__ import annotations

import base64
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from core.model_runtime.entities.message_entities import ImagePromptMessageContent, TextPromptMessageContent
from core.workflow.file.enums import FileAttribute, FileTransferMethod, FileType
from core.workflow.file.file_manager import (
    FileManager,
    _download_file_content,
    _get_encoded_string,
    _to_url,
    download,
    get_attr,
    to_prompt_message_content,
)
from core.workflow.file.models import File


def _build_file(
    *,
    file_type: FileType = FileType.IMAGE,
    transfer_method: FileTransferMethod = FileTransferMethod.LOCAL_FILE,
    remote_url: str | None = None,
    related_id: str | None = "related-id",
    extension: str | None = ".png",
    mime_type: str | None = "image/png",
    filename: str | None = "file.png",
    storage_key: str = "storage-key",
) -> File:
    return File(
        tenant_id="tenant",
        type=file_type,
        transfer_method=transfer_method,
        remote_url=remote_url,
        related_id=related_id,
        filename=filename,
        extension=extension,
        mime_type=mime_type,
        size=7,
        storage_key=storage_key,
    )


def test_get_attr_handles_all_supported_attributes(monkeypatch: pytest.MonkeyPatch) -> None:
    f = _build_file()
    monkeypatch.setattr("core.workflow.file.file_manager._to_url", lambda _: "https://signed.example/file")

    assert get_attr(file=f, attr=FileAttribute.TYPE) == "image"
    assert get_attr(file=f, attr=FileAttribute.SIZE) == 7
    assert get_attr(file=f, attr=FileAttribute.NAME) == "file.png"
    assert get_attr(file=f, attr=FileAttribute.MIME_TYPE) == "image/png"
    assert get_attr(file=f, attr=FileAttribute.TRANSFER_METHOD) == "local_file"
    assert get_attr(file=f, attr=FileAttribute.URL) == "https://signed.example/file"
    assert get_attr(file=f, attr=FileAttribute.EXTENSION) == ".png"
    assert get_attr(file=f, attr=FileAttribute.RELATED_ID) == "related-id"


def test_to_prompt_message_content_requires_extension() -> None:
    f = _build_file(extension=None)

    with pytest.raises(ValueError, match="Missing file extension"):
        to_prompt_message_content(f)


def test_to_prompt_message_content_requires_mime_type() -> None:
    f = _build_file(mime_type=None)

    with pytest.raises(ValueError, match="Missing file mime_type"):
        to_prompt_message_content(f)


def test_to_prompt_message_content_returns_text_for_unsupported_file_type() -> None:
    f = _build_file(file_type=FileType.CUSTOM, extension=".bin", mime_type="application/octet-stream")

    result = to_prompt_message_content(f)

    assert isinstance(result, TextPromptMessageContent)
    assert "Unsupported file type" in result.data


def test_to_prompt_message_content_builds_image_payload_with_base64(monkeypatch: pytest.MonkeyPatch) -> None:
    f = _build_file()
    runtime = SimpleNamespace(multimodal_send_format="base64")
    monkeypatch.setattr("core.workflow.file.file_manager.get_workflow_file_runtime", lambda: runtime)
    monkeypatch.setattr("core.workflow.file.file_manager._get_encoded_string", lambda _: "ZW5jb2RlZA==")
    monkeypatch.setattr("core.workflow.file.file_manager._to_url", lambda _: "https://ignored")

    result = to_prompt_message_content(f)

    assert isinstance(result, ImagePromptMessageContent)
    assert result.base64_data == "ZW5jb2RlZA=="
    assert result.url == ""
    assert result.detail == ImagePromptMessageContent.DETAIL.LOW


def test_to_prompt_message_content_builds_image_payload_with_url_and_detail_override(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    f = _build_file()
    runtime = SimpleNamespace(multimodal_send_format="url")
    monkeypatch.setattr("core.workflow.file.file_manager.get_workflow_file_runtime", lambda: runtime)
    monkeypatch.setattr("core.workflow.file.file_manager._get_encoded_string", lambda _: "ignored")
    monkeypatch.setattr("core.workflow.file.file_manager._to_url", lambda _: "https://cdn.example/image.png")

    result = to_prompt_message_content(f, image_detail_config=ImagePromptMessageContent.DETAIL.HIGH)

    assert isinstance(result, ImagePromptMessageContent)
    assert result.base64_data == ""
    assert result.url == "https://cdn.example/image.png"
    assert result.detail == ImagePromptMessageContent.DETAIL.HIGH


@pytest.mark.parametrize(
    "transfer_method",
    [FileTransferMethod.LOCAL_FILE, FileTransferMethod.TOOL_FILE, FileTransferMethod.DATASOURCE_FILE],
)
def test_download_loads_content_from_storage_for_local_like_transfer_methods(
    transfer_method: FileTransferMethod,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    f = _build_file(transfer_method=transfer_method)
    mocked_download = MagicMock(return_value=b"from-storage")
    monkeypatch.setattr("core.workflow.file.file_manager._download_file_content", mocked_download)

    result = download(f)

    assert result == b"from-storage"
    mocked_download.assert_called_once_with("storage-key")


def test_download_fetches_remote_url_content(monkeypatch: pytest.MonkeyPatch) -> None:
    response = MagicMock(content=b"from-remote")
    runtime = SimpleNamespace(http_get=MagicMock(return_value=response))
    monkeypatch.setattr("core.workflow.file.file_manager.get_workflow_file_runtime", lambda: runtime)
    f = _build_file(transfer_method=FileTransferMethod.REMOTE_URL, remote_url="https://remote.example/file")

    result = download(f)

    assert result == b"from-remote"
    runtime.http_get.assert_called_once_with("https://remote.example/file", follow_redirects=True)
    response.raise_for_status.assert_called_once_with()


def test_download_requires_remote_url_for_remote_transfer() -> None:
    f = SimpleNamespace(transfer_method=FileTransferMethod.REMOTE_URL, remote_url=None)

    with pytest.raises(ValueError, match="Missing file remote_url"):
        download(f)


def test_download_rejects_unknown_transfer_method() -> None:
    f = SimpleNamespace(transfer_method="unsupported")

    with pytest.raises(ValueError, match="unsupported transfer method"):
        download(f)


def test_download_file_content_validates_loaded_type(monkeypatch: pytest.MonkeyPatch) -> None:
    runtime = SimpleNamespace(storage_load=MagicMock(return_value="not-bytes"))
    monkeypatch.setattr("core.workflow.file.file_manager.get_workflow_file_runtime", lambda: runtime)

    with pytest.raises(ValueError, match="not a bytes object"):
        _download_file_content("k")

    runtime.storage_load.return_value = b"ok"
    assert _download_file_content("k") == b"ok"
    runtime.storage_load.assert_called_with("k", stream=False)


def test_get_encoded_string_handles_remote_url(monkeypatch: pytest.MonkeyPatch) -> None:
    response = MagicMock(content=b"remote-bytes")
    runtime = SimpleNamespace(http_get=MagicMock(return_value=response))
    monkeypatch.setattr("core.workflow.file.file_manager.get_workflow_file_runtime", lambda: runtime)
    f = _build_file(transfer_method=FileTransferMethod.REMOTE_URL, remote_url="https://remote.example/file")

    encoded = _get_encoded_string(f)

    assert encoded == base64.b64encode(b"remote-bytes").decode("utf-8")
    runtime.http_get.assert_called_once_with("https://remote.example/file", follow_redirects=True)
    response.raise_for_status.assert_called_once_with()


def test_get_encoded_string_requires_remote_url_for_remote_transfer() -> None:
    f = SimpleNamespace(transfer_method=FileTransferMethod.REMOTE_URL, remote_url=None)

    with pytest.raises(ValueError, match="Missing file remote_url"):
        _get_encoded_string(f)


@pytest.mark.parametrize(
    "transfer_method",
    [FileTransferMethod.LOCAL_FILE, FileTransferMethod.TOOL_FILE, FileTransferMethod.DATASOURCE_FILE],
)
def test_get_encoded_string_handles_local_like_transfer_methods(
    transfer_method: FileTransferMethod,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    f = _build_file(transfer_method=transfer_method)
    monkeypatch.setattr("core.workflow.file.file_manager._download_file_content", lambda _: b"abc")

    encoded = _get_encoded_string(f)

    assert encoded == base64.b64encode(b"abc").decode("utf-8")


def test_to_url_for_remote_file_validates_url_presence() -> None:
    assert _to_url(_build_file(transfer_method=FileTransferMethod.REMOTE_URL, remote_url="https://a.example")) == (
        "https://a.example"
    )

    missing_remote = SimpleNamespace(transfer_method=FileTransferMethod.REMOTE_URL, remote_url=None)
    with pytest.raises(ValueError, match="Missing file remote_url"):
        _to_url(missing_remote)


def test_to_url_for_local_file_prefers_existing_remote_url_or_signed_url(monkeypatch: pytest.MonkeyPatch) -> None:
    explicit_url_file = _build_file(
        transfer_method=FileTransferMethod.LOCAL_FILE, remote_url="https://cdn.example/file"
    )
    assert _to_url(explicit_url_file) == "https://cdn.example/file"

    monkeypatch.setattr(
        "core.workflow.file.file_manager.helpers.get_signed_file_url", lambda upload_file_id: f"signed:{upload_file_id}"
    )
    signed_file = _build_file(transfer_method=FileTransferMethod.LOCAL_FILE, remote_url=None, related_id="upload-1")
    assert _to_url(signed_file) == "signed:upload-1"

    with pytest.raises(ValueError, match="Missing file related_id"):
        _to_url(_build_file(transfer_method=FileTransferMethod.LOCAL_FILE, related_id=None))


def test_to_url_for_tool_file_and_unsupported_methods(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "core.workflow.file.file_manager.helpers.get_signed_tool_file_url",
        lambda tool_file_id, extension: f"tool:{tool_file_id}:{extension}",
    )
    tool_file = _build_file(transfer_method=FileTransferMethod.TOOL_FILE, related_id="tool-1", extension=".txt")
    assert _to_url(tool_file) == "tool:tool-1:.txt"

    with pytest.raises(ValueError, match="Missing file related_id or extension"):
        _to_url(SimpleNamespace(transfer_method=FileTransferMethod.TOOL_FILE, related_id=None, extension=".txt"))

    unsupported = SimpleNamespace(transfer_method="invalid")
    with pytest.raises(ValueError, match="Unsupported transfer method"):
        _to_url(unsupported)


def test_file_manager_download_delegates_to_module_function(monkeypatch: pytest.MonkeyPatch) -> None:
    f = _build_file()
    mocked_download = MagicMock(return_value=b"result")
    monkeypatch.setattr("core.workflow.file.file_manager.download", mocked_download)

    result = FileManager().download(f)

    assert result == b"result"
    mocked_download.assert_called_once_with(f)
