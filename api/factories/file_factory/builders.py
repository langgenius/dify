"""Core builders for workflow file mappings."""

from __future__ import annotations

import mimetypes
import uuid
from collections.abc import Mapping, Sequence
from typing import Any

from graphon.file import File, FileTransferMethod, FileType, FileUploadConfig, helpers, standardize_file_type
from sqlalchemy import select

from core.app.file_access import FileAccessControllerProtocol
from core.workflow.file_reference import build_file_reference
from extensions.ext_database import db
from models import ToolFile, UploadFile

from .common import resolve_mapping_file_id
from .remote import get_remote_file_info
from .validation import is_file_valid_with_config


def build_from_mapping(
    *,
    mapping: Mapping[str, Any],
    tenant_id: str,
    config: FileUploadConfig | None = None,
    strict_type_validation: bool = False,
    access_controller: FileAccessControllerProtocol,
) -> File:
    transfer_method_value = mapping.get("transfer_method")
    if not transfer_method_value:
        raise ValueError("transfer_method is required in file mapping")

    transfer_method = FileTransferMethod.value_of(transfer_method_value)
    build_func = _get_build_function(transfer_method)
    file = build_func(
        mapping=mapping,
        tenant_id=tenant_id,
        transfer_method=transfer_method,
        strict_type_validation=strict_type_validation,
        access_controller=access_controller,
    )

    if config and not is_file_valid_with_config(
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
    strict_type_validation: bool = False,
    access_controller: FileAccessControllerProtocol,
) -> Sequence[File]:
    # TODO(QuantumGhost): Performance concern - each mapping triggers a separate database query.
    # Implement batch processing to reduce database load when handling multiple files.
    valid_mappings = [mapping for mapping in mappings if _is_valid_mapping(mapping)]
    files = [
        build_from_mapping(
            mapping=mapping,
            tenant_id=tenant_id,
            config=config,
            strict_type_validation=strict_type_validation,
            access_controller=access_controller,
        )
        for mapping in valid_mappings
    ]

    if (
        config
        and config.image_config
        and sum(1 for file in files if file.type == FileType.IMAGE) > config.image_config.number_limits
    ):
        raise ValueError(f"Number of image files exceeds the maximum limit {config.image_config.number_limits}")
    if config and config.number_limits and len(files) > config.number_limits:
        raise ValueError(f"Number of files exceeds the maximum limit {config.number_limits}")

    return files


def _get_build_function(transfer_method: FileTransferMethod):
    build_functions = {
        FileTransferMethod.LOCAL_FILE: _build_from_local_file,
        FileTransferMethod.REMOTE_URL: _build_from_remote_url,
        FileTransferMethod.TOOL_FILE: _build_from_tool_file,
        FileTransferMethod.DATASOURCE_FILE: _build_from_datasource_file,
    }
    build_func = build_functions.get(transfer_method)
    if build_func is None:
        raise ValueError(f"Invalid file transfer method: {transfer_method}")
    return build_func


def _resolve_file_type(
    *,
    detected_file_type: FileType,
    specified_type: str | None,
    strict_type_validation: bool,
) -> FileType:
    if strict_type_validation and specified_type and detected_file_type.value != specified_type:
        raise ValueError("Detected file type does not match the specified type. Please verify the file.")

    if specified_type and specified_type != "custom":
        return FileType(specified_type)
    return detected_file_type


def _build_from_local_file(
    *,
    mapping: Mapping[str, Any],
    tenant_id: str,
    transfer_method: FileTransferMethod,
    strict_type_validation: bool = False,
    access_controller: FileAccessControllerProtocol,
) -> File:
    upload_file_id = resolve_mapping_file_id(mapping, "upload_file_id")
    if not upload_file_id:
        raise ValueError("Invalid upload file id")

    try:
        uuid.UUID(upload_file_id)
    except ValueError as exc:
        raise ValueError("Invalid upload file id format") from exc

    stmt = select(UploadFile).where(
        UploadFile.id == upload_file_id,
        UploadFile.tenant_id == tenant_id,
    )
    row = db.session.scalar(access_controller.apply_upload_file_filters(stmt))
    if row is None:
        raise ValueError("Invalid upload file")

    detected_file_type = standardize_file_type(extension="." + row.extension, mime_type=row.mime_type)
    file_type = _resolve_file_type(
        detected_file_type=detected_file_type,
        specified_type=mapping.get("type", "custom"),
        strict_type_validation=strict_type_validation,
    )

    return File(
        id=mapping.get("id"),
        filename=row.name,
        extension="." + row.extension,
        mime_type=row.mime_type,
        type=file_type,
        transfer_method=transfer_method,
        remote_url=row.source_url,
        reference=build_file_reference(record_id=str(row.id)),
        size=row.size,
        storage_key=row.key,
    )


def _build_from_remote_url(
    *,
    mapping: Mapping[str, Any],
    tenant_id: str,
    transfer_method: FileTransferMethod,
    strict_type_validation: bool = False,
    access_controller: FileAccessControllerProtocol,
) -> File:
    upload_file_id = resolve_mapping_file_id(mapping, "upload_file_id")
    if upload_file_id:
        try:
            uuid.UUID(upload_file_id)
        except ValueError as exc:
            raise ValueError("Invalid upload file id format") from exc

        stmt = select(UploadFile).where(
            UploadFile.id == upload_file_id,
            UploadFile.tenant_id == tenant_id,
        )
        upload_file = db.session.scalar(access_controller.apply_upload_file_filters(stmt))
        if upload_file is None:
            raise ValueError("Invalid upload file")

        detected_file_type = standardize_file_type(
            extension="." + upload_file.extension,
            mime_type=upload_file.mime_type,
        )
        file_type = _resolve_file_type(
            detected_file_type=detected_file_type,
            specified_type=mapping.get("type"),
            strict_type_validation=strict_type_validation,
        )

        return File(
            id=mapping.get("id"),
            filename=upload_file.name,
            extension="." + upload_file.extension,
            mime_type=upload_file.mime_type,
            type=file_type,
            transfer_method=transfer_method,
            remote_url=helpers.get_signed_file_url(upload_file_id=str(upload_file_id)),
            reference=build_file_reference(record_id=str(upload_file.id)),
            size=upload_file.size,
            storage_key=upload_file.key,
        )

    url = mapping.get("url") or mapping.get("remote_url")
    if not url:
        raise ValueError("Invalid file url")

    mime_type, filename, file_size = get_remote_file_info(url)
    extension = mimetypes.guess_extension(mime_type) or ("." + filename.split(".")[-1] if "." in filename else ".bin")
    detected_file_type = standardize_file_type(extension=extension, mime_type=mime_type)
    file_type = _resolve_file_type(
        detected_file_type=detected_file_type,
        specified_type=mapping.get("type"),
        strict_type_validation=strict_type_validation,
    )

    return File(
        id=mapping.get("id"),
        filename=filename,
        type=file_type,
        transfer_method=transfer_method,
        remote_url=url,
        mime_type=mime_type,
        extension=extension,
        size=file_size,
    )


def _build_from_tool_file(
    *,
    mapping: Mapping[str, Any],
    tenant_id: str,
    transfer_method: FileTransferMethod,
    strict_type_validation: bool = False,
    access_controller: FileAccessControllerProtocol,
) -> File:
    tool_file_id = resolve_mapping_file_id(mapping, "tool_file_id")
    if not tool_file_id:
        raise ValueError(f"ToolFile {tool_file_id} not found")

    stmt = select(ToolFile).where(
        ToolFile.id == tool_file_id,
        ToolFile.tenant_id == tenant_id,
    )
    tool_file = db.session.scalar(access_controller.apply_tool_file_filters(stmt))
    if tool_file is None:
        raise ValueError(f"ToolFile {tool_file_id} not found")

    extension = "." + tool_file.file_key.split(".")[-1] if "." in tool_file.file_key else ".bin"
    detected_file_type = standardize_file_type(extension=extension, mime_type=tool_file.mimetype)
    file_type = _resolve_file_type(
        detected_file_type=detected_file_type,
        specified_type=mapping.get("type"),
        strict_type_validation=strict_type_validation,
    )

    return File(
        id=mapping.get("id"),
        filename=tool_file.name,
        type=file_type,
        transfer_method=transfer_method,
        remote_url=tool_file.original_url,
        reference=build_file_reference(record_id=str(tool_file.id)),
        extension=extension,
        mime_type=tool_file.mimetype,
        size=tool_file.size,
        storage_key=tool_file.file_key,
    )


def _build_from_datasource_file(
    *,
    mapping: Mapping[str, Any],
    tenant_id: str,
    transfer_method: FileTransferMethod,
    strict_type_validation: bool = False,
    access_controller: FileAccessControllerProtocol,
) -> File:
    datasource_file_id = resolve_mapping_file_id(mapping, "datasource_file_id")
    if not datasource_file_id:
        raise ValueError(f"DatasourceFile {datasource_file_id} not found")

    stmt = select(UploadFile).where(
        UploadFile.id == datasource_file_id,
        UploadFile.tenant_id == tenant_id,
    )
    datasource_file = db.session.scalar(access_controller.apply_upload_file_filters(stmt))
    if datasource_file is None:
        raise ValueError(f"DatasourceFile {mapping.get('datasource_file_id')} not found")

    extension = "." + datasource_file.key.split(".")[-1] if "." in datasource_file.key else ".bin"
    detected_file_type = standardize_file_type(extension="." + extension, mime_type=datasource_file.mime_type)
    file_type = _resolve_file_type(
        detected_file_type=detected_file_type,
        specified_type=mapping.get("type"),
        strict_type_validation=strict_type_validation,
    )

    return File(
        id=mapping.get("datasource_file_id"),
        filename=datasource_file.name,
        type=file_type,
        transfer_method=FileTransferMethod.TOOL_FILE,
        remote_url=datasource_file.source_url,
        reference=build_file_reference(record_id=str(datasource_file.id)),
        extension=extension,
        mime_type=datasource_file.mime_type,
        size=datasource_file.size,
        storage_key=datasource_file.key,
        url=datasource_file.source_url,
    )


def _is_valid_mapping(mapping: Mapping[str, Any]) -> bool:
    if not mapping or not mapping.get("transfer_method"):
        return False

    if mapping.get("transfer_method") == FileTransferMethod.REMOTE_URL:
        url = mapping.get("url") or mapping.get("remote_url")
        if not url:
            return False

    return True
