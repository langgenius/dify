import mimetypes
from collections.abc import Callable, Mapping, Sequence
from typing import Any

import httpx
from sqlalchemy import select

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
    config = config or FileUploadConfig()

    transfer_method = FileTransferMethod.value_of(mapping.get("transfer_method"))

    build_functions: dict[FileTransferMethod, Callable] = {
        FileTransferMethod.LOCAL_FILE: _build_from_local_file,
        FileTransferMethod.REMOTE_URL: _build_from_remote_url,
        FileTransferMethod.TOOL_FILE: _build_from_tool_file,
    }

    build_func = build_functions.get(transfer_method)
    if not build_func:
        raise ValueError(f"Invalid file transfer method: {transfer_method}")

    file = build_func(
        mapping=mapping,
        tenant_id=tenant_id,
        transfer_method=transfer_method,
    )

    if not _is_file_valid_with_config(file=file, config=config):
        raise ValueError(f"File validation failed for file: {file.filename}")

    return file


def build_from_mappings(
    *,
    mappings: Sequence[Mapping[str, Any]],
    config: FileUploadConfig | None,
    tenant_id: str,
) -> Sequence[File]:
    if not config:
        return []

    files = [
        build_from_mapping(
            mapping=mapping,
            tenant_id=tenant_id,
            config=config,
        )
        for mapping in mappings
    ]

    if (
        # If image config is set.
        config.image_config
        # And the number of image files exceeds the maximum limit
        and sum(1 for _ in (filter(lambda x: x.type == FileType.IMAGE, files))) > config.image_config.number_limits
    ):
        raise ValueError(f"Number of image files exceeds the maximum limit {config.image_config.number_limits}")
    if config.number_limits and len(files) > config.number_limits:
        raise ValueError(f"Number of files exceeds the maximum limit {config.number_limits}")

    return files


def _build_from_local_file(
    *,
    mapping: Mapping[str, Any],
    tenant_id: str,
    transfer_method: FileTransferMethod,
) -> File:
    file_type = FileType.value_of(mapping.get("type"))
    stmt = select(UploadFile).where(
        UploadFile.id == mapping.get("upload_file_id"),
        UploadFile.tenant_id == tenant_id,
    )

    row = db.session.scalar(stmt)

    if row is None:
        raise ValueError("Invalid upload file")

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

    return File(
        id=mapping.get("id"),
        filename=filename,
        tenant_id=tenant_id,
        type=FileType.value_of(mapping.get("type")),
        transfer_method=transfer_method,
        remote_url=url,
        mime_type=mime_type,
        extension=extension,
        size=file_size,
    )


def _get_remote_file_info(url: str):
    mime_type = mimetypes.guess_type(url)[0] or ""
    file_size = -1
    filename = url.split("/")[-1].split("?")[0] or "unknown_file"

    resp = ssrf_proxy.head(url, follow_redirects=True)
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

    return File(
        id=mapping.get("id"),
        tenant_id=tenant_id,
        filename=tool_file.name,
        type=FileType.value_of(mapping.get("type")),
        transfer_method=transfer_method,
        remote_url=tool_file.original_url,
        related_id=tool_file.id,
        extension=extension,
        mime_type=tool_file.mimetype,
        size=tool_file.size,
    )


def _is_file_valid_with_config(*, file: File, config: FileUploadConfig) -> bool:
    if config.allowed_file_types and file.type not in config.allowed_file_types and file.type != FileType.CUSTOM:
        return False

    if config.allowed_extensions and file.extension not in config.allowed_extensions:
        return False

    if config.allowed_upload_methods and file.transfer_method not in config.allowed_upload_methods:
        return False

    if file.type == FileType.IMAGE and config.image_config:
        if config.image_config.transfer_methods and file.transfer_method not in config.image_config.transfer_methods:
            return False

    return True
