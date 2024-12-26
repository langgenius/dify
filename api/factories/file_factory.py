import mimetypes
import uuid
from collections.abc import Callable, Mapping, Sequence
from typing import Any, cast

import httpx
from sqlalchemy import select

from constants import AUDIO_EXTENSIONS, DOCUMENT_EXTENSIONS, IMAGE_EXTENSIONS, VIDEO_EXTENSIONS
from core.file import File, FileBelongsTo, FileTransferMethod, FileType, FileUploadConfig
from core.helper import ssrf_proxy
from extensions.ext_database import db
from models import MessageFile, ToolFile, UploadFile


def build_from_message_files(
    *,
    message_files: Sequence["MessageFile"],
    tenant_id: str,
    config: FileUploadConfig,
) -> Sequence[File]:
    results = [
        build_from_message_file(message_file=file, tenant_id=tenant_id, config=config)
        for file in message_files
        if file.belongs_to != FileBelongsTo.ASSISTANT
    ]
    return results


def build_from_message_file(
    *,
    message_file: "MessageFile",
    tenant_id: str,
    config: FileUploadConfig,
):
    mapping = {
        "transfer_method": message_file.transfer_method,
        "url": message_file.url,
        "id": message_file.id,
        "type": message_file.type,
        "upload_file_id": message_file.upload_file_id,
    }
    return build_from_mapping(
        mapping=mapping,
        tenant_id=tenant_id,
        config=config,
    )


def build_from_mapping(
    *,
    mapping: Mapping[str, Any],
    tenant_id: str,
    config: FileUploadConfig | None = None,
) -> File:
    transfer_method = FileTransferMethod.value_of(mapping.get("transfer_method"))

    build_functions: dict[FileTransferMethod, Callable] = {
        FileTransferMethod.LOCAL_FILE: _build_from_local_file,
        FileTransferMethod.REMOTE_URL: _build_from_remote_url,
        FileTransferMethod.TOOL_FILE: _build_from_tool_file,
    }

    build_func = build_functions.get(transfer_method)
    if not build_func:
        raise ValueError(f"Invalid file transfer method: {transfer_method}")

    file: File = build_func(
        mapping=mapping,
        tenant_id=tenant_id,
        transfer_method=transfer_method,
    )

    if config and not _is_file_valid_with_config(
        input_file_type=mapping.get("type", FileType.CUSTOM),
        file_extension=file.extension or "",
        file_transfer_method=file.transfer_method,
        config=config,
    ):
        raise ValueError(f"File validation failed for file: {file.filename}")

    return file


def build_from_mappings(
    *,
    mappings: Sequence[Mapping[str, Any]],
    config: FileUploadConfig | None = None,
    tenant_id: str,
) -> Sequence[File]:
    files = [
        build_from_mapping(
            mapping=mapping,
            tenant_id=tenant_id,
            config=config,
        )
        for mapping in mappings
    ]

    if (
        config
        # If image config is set.
        and config.image_config
        # And the number of image files exceeds the maximum limit
        and sum(1 for _ in (filter(lambda x: x.type == FileType.IMAGE, files))) > config.image_config.number_limits
    ):
        raise ValueError(f"Number of image files exceeds the maximum limit {config.image_config.number_limits}")
    if config and config.number_limits and len(files) > config.number_limits:
        raise ValueError(f"Number of files exceeds the maximum limit {config.number_limits}")

    return files


def _build_from_local_file(
    *,
    mapping: Mapping[str, Any],
    tenant_id: str,
    transfer_method: FileTransferMethod,
) -> File:
    upload_file_id = mapping.get("upload_file_id")
    if not upload_file_id:
        raise ValueError("Invalid upload file id")
    # check if upload_file_id is a valid uuid
    try:
        uuid.UUID(upload_file_id)
    except ValueError:
        raise ValueError("Invalid upload file id format")
    stmt = select(UploadFile).where(
        UploadFile.id == upload_file_id,
        UploadFile.tenant_id == tenant_id,
    )

    row = db.session.scalar(stmt)
    if row is None:
        raise ValueError("Invalid upload file")

    file_type = FileType(mapping.get("type", "custom"))
    file_type = _standardize_file_type(file_type, extension="." + row.extension, mime_type=row.mime_type)

    return File(
        id=mapping.get("id"),
        filename=row.name,
        extension="." + row.extension,
        mime_type=row.mime_type,
        tenant_id=tenant_id,
        type=file_type,
        transfer_method=transfer_method,
        remote_url=row.source_url,
        related_id=mapping.get("upload_file_id"),
        size=row.size,
        storage_key=row.key,
    )


def _build_from_remote_url(
    *,
    mapping: Mapping[str, Any],
    tenant_id: str,
    transfer_method: FileTransferMethod,
) -> File:
    url = mapping.get("url")
    if not url:
        raise ValueError("Invalid file url")

    mime_type, filename, file_size = _get_remote_file_info(url)
    extension = mimetypes.guess_extension(mime_type) or "." + filename.split(".")[-1] if "." in filename else ".bin"

    file_type = FileType(mapping.get("type", "custom"))
    file_type = _standardize_file_type(file_type, extension=extension, mime_type=mime_type)

    return File(
        id=mapping.get("id"),
        filename=filename,
        tenant_id=tenant_id,
        type=file_type,
        transfer_method=transfer_method,
        remote_url=url,
        mime_type=mime_type,
        extension=extension,
        size=file_size,
        storage_key="",
    )


def _get_remote_file_info(url: str):
    file_size = -1
    filename = url.split("/")[-1].split("?")[0] or "unknown_file"
    mime_type = mimetypes.guess_type(filename)[0] or ""

    resp = ssrf_proxy.head(url, follow_redirects=True)
    resp = cast(httpx.Response, resp)
    if resp.status_code == httpx.codes.OK:
        if content_disposition := resp.headers.get("Content-Disposition"):
            filename = str(content_disposition.split("filename=")[-1].strip('"'))
        file_size = int(resp.headers.get("Content-Length", file_size))
        mime_type = mime_type or str(resp.headers.get("Content-Type", ""))

    return mime_type, filename, file_size


def _build_from_tool_file(
    *,
    mapping: Mapping[str, Any],
    tenant_id: str,
    transfer_method: FileTransferMethod,
) -> File:
    tool_file = (
        db.session.query(ToolFile)
        .filter(
            ToolFile.id == mapping.get("tool_file_id"),
            ToolFile.tenant_id == tenant_id,
        )
        .first()
    )

    if tool_file is None:
        raise ValueError(f"ToolFile {mapping.get('tool_file_id')} not found")

    extension = "." + tool_file.file_key.split(".")[-1] if "." in tool_file.file_key else ".bin"
    file_type = FileType(mapping.get("type", "custom"))
    file_type = _standardize_file_type(file_type, extension=extension, mime_type=tool_file.mimetype)

    return File(
        id=mapping.get("id"),
        tenant_id=tenant_id,
        filename=tool_file.name,
        type=file_type,
        transfer_method=transfer_method,
        remote_url=tool_file.original_url,
        related_id=tool_file.id,
        extension=extension,
        mime_type=tool_file.mimetype,
        size=tool_file.size,
        storage_key=tool_file.file_key,
    )


def _is_file_valid_with_config(
    *,
    input_file_type: str,
    file_extension: str,
    file_transfer_method: FileTransferMethod,
    config: FileUploadConfig,
) -> bool:
    if (
        config.allowed_file_types
        and input_file_type not in config.allowed_file_types
        and input_file_type != FileType.CUSTOM
    ):
        return False

    if (
        input_file_type == FileType.CUSTOM
        and config.allowed_file_extensions is not None
        and file_extension not in config.allowed_file_extensions
    ):
        return False

    if input_file_type == FileType.IMAGE and config.image_config:
        if config.image_config.transfer_methods and file_transfer_method not in config.image_config.transfer_methods:
            return False

    return True


def _standardize_file_type(file_type: FileType, /, *, extension: str = "", mime_type: str = "") -> FileType:
    """
    If custom type, try to guess the file type by extension and mime_type.
    """
    if file_type != FileType.CUSTOM:
        return FileType(file_type)
    guessed_type = None
    if extension:
        guessed_type = _get_file_type_by_extension(extension)
    if guessed_type is None and mime_type:
        guessed_type = _get_file_type_by_mimetype(mime_type)
    return guessed_type or FileType.CUSTOM


def _get_file_type_by_extension(extension: str) -> FileType | None:
    extension = extension.lstrip(".")
    if extension in IMAGE_EXTENSIONS:
        return FileType.IMAGE
    elif extension in VIDEO_EXTENSIONS:
        return FileType.VIDEO
    elif extension in AUDIO_EXTENSIONS:
        return FileType.AUDIO
    elif extension in DOCUMENT_EXTENSIONS:
        return FileType.DOCUMENT
    return None


def _get_file_type_by_mimetype(mime_type: str) -> FileType | None:
    if "image" in mime_type:
        file_type = FileType.IMAGE
    elif "video" in mime_type:
        file_type = FileType.VIDEO
    elif "audio" in mime_type:
        file_type = FileType.AUDIO
    elif "text" in mime_type or "pdf" in mime_type:
        file_type = FileType.DOCUMENT
    else:
        file_type = FileType.CUSTOM
    return file_type
