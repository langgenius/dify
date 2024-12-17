import base64

from configs import dify_config
from core.file import file_repository
from core.helper import ssrf_proxy
from core.model_runtime.entities import (
    AudioPromptMessageContent,
    DocumentPromptMessageContent,
    ImagePromptMessageContent,
    VideoPromptMessageContent,
)
from extensions.ext_database import db
from extensions.ext_storage import storage

from . import helpers
from .enums import FileAttribute
from .models import File, FileTransferMethod, FileType
from .tool_file_parser import ToolFileParser


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
            return file.remote_url
        case FileAttribute.EXTENSION:
            return file.extension


def to_prompt_message_content(
    f: File,
    /,
    *,
    image_detail_config: ImagePromptMessageContent.DETAIL | None = None,
):
    match f.type:
        case FileType.IMAGE:
            image_detail_config = image_detail_config or ImagePromptMessageContent.DETAIL.LOW
            if dify_config.MULTIMODAL_SEND_IMAGE_FORMAT == "url":
                data = _to_url(f)
            else:
                data = _to_base64_data_string(f)

            return ImagePromptMessageContent(data=data, detail=image_detail_config)
        case FileType.AUDIO:
            encoded_string = _get_encoded_string(f)
            if f.extension is None:
                raise ValueError("Missing file extension")
            return AudioPromptMessageContent(data=encoded_string, format=f.extension.lstrip("."))
        case FileType.VIDEO:
            if dify_config.MULTIMODAL_SEND_VIDEO_FORMAT == "url":
                data = _to_url(f)
            else:
                data = _to_base64_data_string(f)
            if f.extension is None:
                raise ValueError("Missing file extension")
            return VideoPromptMessageContent(data=data, format=f.extension.lstrip("."))
        case FileType.DOCUMENT:
            data = _get_encoded_string(f)
            if f.mime_type is None:
                raise ValueError("Missing file mime_type")
            return DocumentPromptMessageContent(
                encode_format="base64",
                mime_type=f.mime_type,
                data=data,
            )
        case _:
            raise ValueError(f"file type {f.type} is not supported")


def download(f: File, /):
    if f.transfer_method == FileTransferMethod.TOOL_FILE:
        tool_file = file_repository.get_tool_file(session=db.session(), file=f)
        return _download_file_content(tool_file.file_key)
    elif f.transfer_method == FileTransferMethod.LOCAL_FILE:
        upload_file = file_repository.get_upload_file(session=db.session(), file=f)
        return _download_file_content(upload_file.key)
    # remote file
    response = ssrf_proxy.get(f.remote_url, follow_redirects=True)
    response.raise_for_status()
    return response.content


def _download_file_content(path: str, /):
    """
    Download and return the contents of a file as bytes.

    This function loads the file from storage and ensures it's in bytes format.

    Args:
        path (str): The path to the file in storage.

    Returns:
        bytes: The contents of the file as a bytes object.

    Raises:
        ValueError: If the loaded file is not a bytes object.
    """
    data = storage.load(path, stream=False)
    if not isinstance(data, bytes):
        raise ValueError(f"file {path} is not a bytes object")
    return data


def _get_encoded_string(f: File, /):
    match f.transfer_method:
        case FileTransferMethod.REMOTE_URL:
            response = ssrf_proxy.get(f.remote_url, follow_redirects=True)
            response.raise_for_status()
            data = response.content
        case FileTransferMethod.LOCAL_FILE:
            upload_file = file_repository.get_upload_file(session=db.session(), file=f)
            data = _download_file_content(upload_file.key)
        case FileTransferMethod.TOOL_FILE:
            tool_file = file_repository.get_tool_file(session=db.session(), file=f)
            data = _download_file_content(tool_file.file_key)

    encoded_string = base64.b64encode(data).decode("utf-8")
    return encoded_string


def _to_base64_data_string(f: File, /):
    encoded_string = _get_encoded_string(f)
    return f"data:{f.mime_type};base64,{encoded_string}"


def _to_url(f: File, /):
    if f.transfer_method == FileTransferMethod.REMOTE_URL:
        if f.remote_url is None:
            raise ValueError("Missing file remote_url")
        return f.remote_url
    elif f.transfer_method == FileTransferMethod.LOCAL_FILE:
        if f.related_id is None:
            raise ValueError("Missing file related_id")
        return f.remote_url or helpers.get_signed_file_url(upload_file_id=f.related_id)
    elif f.transfer_method == FileTransferMethod.TOOL_FILE:
        # add sign url
        if f.related_id is None or f.extension is None:
            raise ValueError("Missing file related_id or extension")
        return ToolFileParser.get_tool_file_manager().sign_file(tool_file_id=f.related_id, extension=f.extension)
    else:
        raise ValueError(f"Unsupported transfer method: {f.transfer_method}")
