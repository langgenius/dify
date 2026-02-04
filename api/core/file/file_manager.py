import base64
import logging
from collections.abc import Mapping

from configs import dify_config
from core.helper import ssrf_proxy
from core.model_runtime.entities import (
    AudioPromptMessageContent,
    DocumentPromptMessageContent,
    ImagePromptMessageContent,
    TextPromptMessageContent,
    VideoPromptMessageContent,
)
from core.model_runtime.entities.message_entities import (
    MultiModalPromptMessageContent,
    PromptMessageContentUnionTypes,
)
from core.tools.signature import sign_tool_file
from extensions.ext_storage import storage

from . import helpers
from .enums import FileAttribute
from .models import File, FileTransferMethod, FileType

logger = logging.getLogger(__name__)


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
    """
    Convert a file to prompt message content.

    This function converts files to their appropriate prompt message content types.
    For supported file types (IMAGE, AUDIO, VIDEO, DOCUMENT), it creates the
    corresponding message content with proper encoding/URL.

    For unsupported file types, instead of raising an error, it returns a
    TextPromptMessageContent with a descriptive message about the file.

    Args:
        f: The file to convert
        image_detail_config: Optional detail configuration for image files

    Returns:
        PromptMessageContentUnionTypes: The appropriate message content type

    Raises:
        ValueError: If file extension or mime_type is missing
    """
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

    # Check if file type is supported
    if f.type not in prompt_class_map:
        # For unsupported file types, return a text description
        return TextPromptMessageContent(data=f"[Unsupported file type: {f.filename} ({f.type.value})]")

    # Process supported file types
    params = {
        "base64_data": _get_encoded_string(f) if dify_config.MULTIMODAL_SEND_FORMAT == "base64" else "",
        "url": _to_url(f) if dify_config.MULTIMODAL_SEND_FORMAT == "url" else "",
        "format": f.extension.removeprefix("."),
        "mime_type": f.mime_type,
        "filename": f.filename or "",
        # Encoded file reference for context restoration: "transfer_method:related_id" or "remote:url"
        "file_ref": _encode_file_ref(f),
    }
    if f.type == FileType.IMAGE:
        params["detail"] = image_detail_config or ImagePromptMessageContent.DETAIL.LOW

    return prompt_class_map[f.type].model_validate(params)


def _encode_file_ref(f: File) -> str | None:
    """Encode file reference as 'transfer_method:id_or_url' string."""
    if f.transfer_method == FileTransferMethod.REMOTE_URL:
        return f"remote:{f.remote_url}" if f.remote_url else None
    elif f.transfer_method == FileTransferMethod.LOCAL_FILE:
        return f"local:{f.related_id}" if f.related_id else None
    elif f.transfer_method == FileTransferMethod.TOOL_FILE:
        return f"tool:{f.related_id}" if f.related_id else None
    return None


def download(f: File, /):
    if f.transfer_method in (
        FileTransferMethod.TOOL_FILE,
        FileTransferMethod.LOCAL_FILE,
        FileTransferMethod.DATASOURCE_FILE,
    ):
        return _download_file_content(f.storage_key)
    elif f.transfer_method == FileTransferMethod.REMOTE_URL:
        if f.remote_url is None:
            raise ValueError("Missing file remote_url")
        response = ssrf_proxy.get(f.remote_url, follow_redirects=True)
        response.raise_for_status()
        return response.content
    raise ValueError(f"unsupported transfer method: {f.transfer_method}")


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
            if f.remote_url is None:
                raise ValueError("Missing file remote_url")
            response = ssrf_proxy.get(f.remote_url, follow_redirects=True)
            response.raise_for_status()
            data = response.content
        case FileTransferMethod.LOCAL_FILE:
            data = _download_file_content(f.storage_key)
        case FileTransferMethod.TOOL_FILE:
            data = _download_file_content(f.storage_key)
        case FileTransferMethod.DATASOURCE_FILE:
            data = _download_file_content(f.storage_key)

    encoded_string = base64.b64encode(data).decode("utf-8")
    return encoded_string


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
        return sign_tool_file(tool_file_id=f.related_id, extension=f.extension)
    else:
        raise ValueError(f"Unsupported transfer method: {f.transfer_method}")


def restore_multimodal_content(
    content: MultiModalPromptMessageContent,
) -> MultiModalPromptMessageContent:
    """
    Restore base64_data or url for multimodal content from file_ref.

    file_ref format: "transfer_method:id_or_url" (e.g., "local:abc123", "remote:https://...")

    Args:
        content: MultiModalPromptMessageContent with file_ref field

    Returns:
        MultiModalPromptMessageContent with restored base64_data or url
    """
    # Skip if no file reference or content already has data
    if not content.file_ref:
        return content
    if content.base64_data or content.url:
        return content

    try:
        file = _build_file_from_ref(
            file_ref=content.file_ref,
            file_format=content.format,
            mime_type=content.mime_type,
            filename=content.filename,
        )
        if not file:
            return content

        # Restore content based on config
        if dify_config.MULTIMODAL_SEND_FORMAT == "base64":
            restored_base64 = _get_encoded_string(file)
            return content.model_copy(update={"base64_data": restored_base64})
        else:
            restored_url = _to_url(file)
            return content.model_copy(update={"url": restored_url})

    except Exception as e:
        logger.warning("Failed to restore multimodal content: %s", e)
        return content


def _build_file_from_ref(
    file_ref: str,
    file_format: str | None,
    mime_type: str | None,
    filename: str | None,
) -> File | None:
    """
    Build a File object from encoded file_ref string.

    Args:
        file_ref: Encoded reference "transfer_method:id_or_url"
        file_format: The file format/extension (without dot)
        mime_type: The mime type
        filename: The filename

    Returns:
        File object with storage_key loaded, or None if not found
    """
    from sqlalchemy import select
    from sqlalchemy.orm import Session

    from extensions.ext_database import db
    from models.model import UploadFile
    from models.tools import ToolFile

    # Parse file_ref: "method:value"
    if ":" not in file_ref:
        logger.warning("Invalid file_ref format: %s", file_ref)
        return None

    method, value = file_ref.split(":", 1)
    extension = f".{file_format}" if file_format else None

    if method == "remote":
        return File(
            tenant_id="",
            type=FileType.IMAGE,
            transfer_method=FileTransferMethod.REMOTE_URL,
            remote_url=value,
            extension=extension,
            mime_type=mime_type,
            filename=filename,
            storage_key="",
        )

    # Query database for storage_key
    with Session(db.engine) as session:
        if method == "local":
            stmt = select(UploadFile).where(UploadFile.id == value)
            upload_file = session.scalar(stmt)
            if upload_file:
                return File(
                    tenant_id=upload_file.tenant_id,
                    type=FileType(upload_file.extension)
                    if hasattr(FileType, upload_file.extension.upper())
                    else FileType.IMAGE,
                    transfer_method=FileTransferMethod.LOCAL_FILE,
                    related_id=value,
                    extension=extension or ("." + upload_file.extension if upload_file.extension else None),
                    mime_type=mime_type or upload_file.mime_type,
                    filename=filename or upload_file.name,
                    storage_key=upload_file.key,
                )
        elif method == "tool":
            stmt = select(ToolFile).where(ToolFile.id == value)
            tool_file = session.scalar(stmt)
            if tool_file:
                return File(
                    tenant_id=tool_file.tenant_id,
                    type=FileType.IMAGE,
                    transfer_method=FileTransferMethod.TOOL_FILE,
                    related_id=value,
                    extension=extension,
                    mime_type=mime_type or tool_file.mimetype,
                    filename=filename or tool_file.name,
                    storage_key=tool_file.file_key,
                )

    logger.warning("File not found for file_ref: %s", file_ref)
    return None


class FileManager:
    """
    Adapter exposing file manager helpers behind FileManagerProtocol.

    This is intentionally a thin wrapper over the existing module-level functions so callers can inject it
    where a protocol-typed file manager is expected.
    """

    def download(self, f: File, /) -> bytes:
        return download(f)


file_manager = FileManager()
