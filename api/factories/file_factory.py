import mimetypes
from collections.abc import Mapping, Sequence
from typing import Any

import httpx
from sqlalchemy import select

from constants import AUDIO_EXTENSIONS, DOCUMENT_EXTENSIONS, IMAGE_EXTENSIONS, VIDEO_EXTENSIONS
from core.file import File, FileBelongsTo, FileExtraConfig, FileTransferMethod, FileType
from core.helper import ssrf_proxy
from extensions.ext_database import db
from models import MessageFile, ToolFile, UploadFile
from models.enums import CreatedByRole


def build_from_message_files(
    *,
    message_files: Sequence["MessageFile"],
    tenant_id: str,
    config: FileExtraConfig,
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
    config: FileExtraConfig,
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
        user_id=message_file.created_by,
        role=CreatedByRole(message_file.created_by_role),
        config=config,
    )


def build_from_mapping(
    *,
    mapping: Mapping[str, Any],
    tenant_id: str,
    user_id: str,
    role: "CreatedByRole",
    config: FileExtraConfig,
):
    transfer_method = FileTransferMethod.value_of(mapping.get("transfer_method"))
    match transfer_method:
        case FileTransferMethod.REMOTE_URL:
            file = _build_from_remote_url(
                mapping=mapping,
                tenant_id=tenant_id,
                config=config,
                transfer_method=transfer_method,
            )
        case FileTransferMethod.LOCAL_FILE:
            file = _build_from_local_file(
                mapping=mapping,
                tenant_id=tenant_id,
                user_id=user_id,
                role=role,
                config=config,
                transfer_method=transfer_method,
            )
        case FileTransferMethod.TOOL_FILE:
            file = _build_from_tool_file(
                mapping=mapping,
                tenant_id=tenant_id,
                user_id=user_id,
                config=config,
                transfer_method=transfer_method,
            )
        case _:
            raise ValueError(f"Invalid file transfer method: {transfer_method}")

    return file


def build_from_mappings(
    *,
    mappings: Sequence[Mapping[str, Any]],
    config: FileExtraConfig | None,
    tenant_id: str,
    user_id: str,
    role: "CreatedByRole",
) -> Sequence[File]:
    if not config:
        return []

    files = [
        build_from_mapping(
            mapping=mapping,
            tenant_id=tenant_id,
            user_id=user_id,
            role=role,
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
    user_id: str,
    role: "CreatedByRole",
    config: FileExtraConfig,
    transfer_method: FileTransferMethod,
):
    # check if the upload file exists.
    file_type = FileType.value_of(mapping.get("type"))
    stmt = select(UploadFile).where(
        UploadFile.id == mapping.get("upload_file_id"),
        UploadFile.tenant_id == tenant_id,
        UploadFile.created_by == user_id,
        UploadFile.created_by_role == role,
    )
    if file_type == FileType.IMAGE:
        stmt = stmt.where(UploadFile.extension.in_(IMAGE_EXTENSIONS))
    elif file_type == FileType.VIDEO:
        stmt = stmt.where(UploadFile.extension.in_(VIDEO_EXTENSIONS))
    elif file_type == FileType.AUDIO:
        stmt = stmt.where(UploadFile.extension.in_(AUDIO_EXTENSIONS))
    elif file_type == FileType.DOCUMENT:
        stmt = stmt.where(UploadFile.extension.in_(DOCUMENT_EXTENSIONS))
    row = db.session.scalar(stmt)
    if row is None:
        raise ValueError("Invalid upload file")
    file = File(
        id=mapping.get("id"),
        filename=row.name,
        extension="." + row.extension,
        mime_type=row.mime_type,
        tenant_id=tenant_id,
        type=file_type,
        transfer_method=transfer_method,
        remote_url=None,
        related_id=mapping.get("upload_file_id"),
        _extra_config=config,
        size=row.size,
    )
    return file


def _build_from_remote_url(
    *,
    mapping: Mapping[str, Any],
    tenant_id: str,
    config: FileExtraConfig,
    transfer_method: FileTransferMethod,
):
    url = mapping.get("url")
    if not url:
        raise ValueError("Invalid file url")

    mime_type = mimetypes.guess_type(url)[0] or ""
    file_size = -1
    filename = url.split("/")[-1].split("?")[0] or "unknown_file"

    resp = ssrf_proxy.head(url, follow_redirects=True)
    if resp.status_code == httpx.codes.OK:
        if content_disposition := resp.headers.get("Content-Disposition"):
            filename = content_disposition.split("filename=")[-1].strip('"')
        file_size = int(resp.headers.get("Content-Length", file_size))
        mime_type = mime_type or str(resp.headers.get("Content-Type", ""))

    # Determine file extension
    extension = mimetypes.guess_extension(mime_type) or "." + filename.split(".")[-1] if "." in filename else ".bin"

    if not mime_type:
        mime_type, _ = mimetypes.guess_type(url)
    file = File(
        id=mapping.get("id"),
        filename=filename,
        tenant_id=tenant_id,
        type=FileType.value_of(mapping.get("type")),
        transfer_method=transfer_method,
        remote_url=url,
        _extra_config=config,
        mime_type=mime_type,
        extension=extension,
        size=file_size,
    )
    return file


def _build_from_tool_file(
    *,
    mapping: Mapping[str, Any],
    tenant_id: str,
    user_id: str,
    config: FileExtraConfig,
    transfer_method: FileTransferMethod,
):
    tool_file = (
        db.session.query(ToolFile)
        .filter(
            ToolFile.id == mapping.get("tool_file_id"),
            ToolFile.tenant_id == tenant_id,
            ToolFile.user_id == user_id,
        )
        .first()
    )
    if tool_file is None:
        raise ValueError(f"ToolFile {mapping.get('tool_file_id')} not found")

    path = tool_file.file_key
    if "." in path:
        extension = "." + path.split("/")[-1].split(".")[-1]
    else:
        extension = ".bin"
    file = File(
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
        _extra_config=config,
    )
    return file
