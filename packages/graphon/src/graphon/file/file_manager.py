from __future__ import annotations

import base64
from collections.abc import Callable, Mapping
from typing import assert_never

from graphon.model_runtime.entities.message_entities import (
    AudioPromptMessageContent,
    DocumentPromptMessageContent,
    ImagePromptMessageContent,
    PromptMessageContentUnionTypes,
    TextPromptMessageContent,
    VideoPromptMessageContent,
)

from .enums import FileAttribute, FileTransferMethod, FileType
from .models import File
from .runtime import get_workflow_file_runtime

_DOWNLOAD_TRANSFER_METHODS = frozenset((
    FileTransferMethod.TOOL_FILE,
    FileTransferMethod.LOCAL_FILE,
    FileTransferMethod.DATASOURCE_FILE,
))


def _to_url(f: File, /) -> str:
    url = f.generate_url()
    if url is None:
        msg = f"Unsupported transfer method: {f.transfer_method}"
        raise ValueError(msg)
    return url


def _get_file_type_value(file: File) -> str:
    return file.type.value


def _get_file_transfer_method_value(file: File) -> str:
    return file.transfer_method.value


def _get_file_size(file: File) -> int:
    return file.size


def _get_file_name(file: File) -> str | None:
    return file.filename


def _get_file_mime_type(file: File) -> str | None:
    return file.mime_type


def _get_file_extension(file: File) -> str | None:
    return file.extension


def _get_file_related_id(file: File) -> str | None:
    return file.related_id


_FILE_ATTRIBUTE_GETTERS: Mapping[FileAttribute, Callable[[File], str | int | None]] = {
    FileAttribute.TYPE: _get_file_type_value,
    FileAttribute.SIZE: _get_file_size,
    FileAttribute.NAME: _get_file_name,
    FileAttribute.MIME_TYPE: _get_file_mime_type,
    FileAttribute.TRANSFER_METHOD: _get_file_transfer_method_value,
    FileAttribute.URL: _to_url,
    FileAttribute.EXTENSION: _get_file_extension,
    FileAttribute.RELATED_ID: _get_file_related_id,
}
_PROMPT_CONTENT_CLASS_BY_FILE_TYPE: Mapping[
    FileType,
    type[PromptMessageContentUnionTypes],
] = {
    FileType.IMAGE: ImagePromptMessageContent,
    FileType.AUDIO: AudioPromptMessageContent,
    FileType.VIDEO: VideoPromptMessageContent,
    FileType.DOCUMENT: DocumentPromptMessageContent,
}


def get_attr(*, file: File, attr: FileAttribute) -> str | int | None:
    return _FILE_ATTRIBUTE_GETTERS[attr](file)


def to_prompt_message_content(
    f: File,
    /,
    *,
    image_detail_config: ImagePromptMessageContent.DETAIL | None = None,
) -> PromptMessageContentUnionTypes:
    """Convert a file to prompt message content."""
    if f.extension is None:
        msg = "Missing file extension"
        raise ValueError(msg)
    if f.mime_type is None:
        msg = "Missing file mime_type"
        raise ValueError(msg)

    if f.type not in _PROMPT_CONTENT_CLASS_BY_FILE_TYPE:
        return TextPromptMessageContent(
            data=f"[Unsupported file type: {f.filename} ({f.type.value})]",
        )

    send_format = get_workflow_file_runtime().multimodal_send_format
    params = {
        "base64_data": _get_encoded_string(f) if send_format == "base64" else "",
        "url": _to_url(f) if send_format == "url" else "",
        "format": f.extension.removeprefix("."),
        "mime_type": f.mime_type,
        "filename": f.filename or "",
    }
    if f.type == FileType.IMAGE:
        params["detail"] = image_detail_config or ImagePromptMessageContent.DETAIL.LOW

    return _PROMPT_CONTENT_CLASS_BY_FILE_TYPE[f.type].model_validate(params)


def download(f: File, /) -> bytes:
    if f.transfer_method in _DOWNLOAD_TRANSFER_METHODS:
        return _download_file_content(f)
    if f.transfer_method == FileTransferMethod.REMOTE_URL:
        if f.remote_url is None:
            msg = "Missing file remote_url"
            raise ValueError(msg)
        response = get_workflow_file_runtime().http_get(
            f.remote_url,
            follow_redirects=True,
        )
        response.raise_for_status()
        return response.content
    msg = f"unsupported transfer method: {f.transfer_method}"
    raise ValueError(msg)


def _download_file_content(file: File, /) -> bytes:
    """Download and return a file from storage as bytes."""
    return get_workflow_file_runtime().load_file_bytes(file=file)


def _get_encoded_string(f: File, /) -> str:
    transfer_method = f.transfer_method
    match transfer_method:
        case FileTransferMethod.REMOTE_URL:
            if f.remote_url is None:
                msg = "Missing file remote_url"
                raise ValueError(msg)
            response = get_workflow_file_runtime().http_get(
                f.remote_url,
                follow_redirects=True,
            )
            response.raise_for_status()
            data = response.content
        case FileTransferMethod.LOCAL_FILE:
            data = _download_file_content(f)
        case FileTransferMethod.TOOL_FILE:
            data = _download_file_content(f)
        case FileTransferMethod.DATASOURCE_FILE:
            data = _download_file_content(f)
        case _:
            assert_never(transfer_method)

    return base64.b64encode(data).decode("utf-8")


class FileManager:
    """Adapter exposing file manager helpers behind FileManagerProtocol."""

    def download(self, f: File, /) -> bytes:
        return download(f)


file_manager = FileManager()
