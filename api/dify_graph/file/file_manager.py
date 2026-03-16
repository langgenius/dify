from __future__ import annotations

import base64
from collections.abc import Mapping

from dify_graph.model_runtime.entities import (
    AudioPromptMessageContent,
    DocumentPromptMessageContent,
    ImagePromptMessageContent,
    TextPromptMessageContent,
    VideoPromptMessageContent,
)
from dify_graph.model_runtime.entities.message_entities import PromptMessageContentUnionTypes

from .enums import FileAttribute
from .models import File, FileTransferMethod, FileType
from .runtime import get_workflow_file_runtime


def get_attr(*, file: File, attr: FileAttribute):
    match attr:
        case FileAttribute.TYPE:
            return file.type.value
        case FileAttribute.SIZE:
            return file.size
        case FileAttribute.NAME:
            return file.filename
        case FileAttribute.MIME_TYPE:
            return file.mime_type
        case FileAttribute.TRANSFER_METHOD:
            return file.transfer_method.value
        case FileAttribute.URL:
            return _to_url(file)
        case FileAttribute.EXTENSION:
            return file.extension
        case FileAttribute.RELATED_ID:
            return file.related_id


def to_prompt_message_content(
    f: File,
    /,
    *,
    image_detail_config: ImagePromptMessageContent.DETAIL | None = None,
) -> PromptMessageContentUnionTypes:
    """Convert a file to prompt message content."""
    if f.extension is None:
        raise ValueError("Missing file extension")
    if f.mime_type is None:
        raise ValueError("Missing file mime_type")

    prompt_class_map: Mapping[FileType, type[PromptMessageContentUnionTypes]] = {
        FileType.IMAGE: ImagePromptMessageContent,
        FileType.AUDIO: AudioPromptMessageContent,
        FileType.VIDEO: VideoPromptMessageContent,
        FileType.DOCUMENT: DocumentPromptMessageContent,
    }

    if f.type not in prompt_class_map:
        return TextPromptMessageContent(data=f"[Unsupported file type: {f.filename} ({f.type.value})]")

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

    return prompt_class_map[f.type].model_validate(params)


def download(f: File, /) -> bytes:
    if f.transfer_method in (
        FileTransferMethod.TOOL_FILE,
        FileTransferMethod.LOCAL_FILE,
        FileTransferMethod.DATASOURCE_FILE,
    ):
        return _download_file_content(f)
    elif f.transfer_method == FileTransferMethod.REMOTE_URL:
        if f.remote_url is None:
            raise ValueError("Missing file remote_url")
        response = get_workflow_file_runtime().http_get(f.remote_url, follow_redirects=True)
        response.raise_for_status()
        return response.content
    raise ValueError(f"unsupported transfer method: {f.transfer_method}")


def _download_file_content(file: File, /) -> bytes:
    """Download and return a file from storage as bytes."""
    return get_workflow_file_runtime().load_file_bytes(file=file)


def _get_encoded_string(f: File, /) -> str:
    match f.transfer_method:
        case FileTransferMethod.REMOTE_URL:
            if f.remote_url is None:
                raise ValueError("Missing file remote_url")
            response = get_workflow_file_runtime().http_get(f.remote_url, follow_redirects=True)
            response.raise_for_status()
            data = response.content
        case FileTransferMethod.LOCAL_FILE:
            data = _download_file_content(f)
        case FileTransferMethod.TOOL_FILE:
            data = _download_file_content(f)
        case FileTransferMethod.DATASOURCE_FILE:
            data = _download_file_content(f)

    return base64.b64encode(data).decode("utf-8")


def _to_url(f: File, /):
    url = f.generate_url()
    if url is None:
        raise ValueError(f"Unsupported transfer method: {f.transfer_method}")
    return url


class FileManager:
    """Adapter exposing file manager helpers behind FileManagerProtocol."""

    def download(self, f: File, /) -> bytes:
        return download(f)


file_manager = FileManager()
