"""Core builders for workflow file mappings."""

from __future__ import annotations

import mimetypes
import os
import uuid
from collections.abc import Mapping, Sequence
from typing import Any, Literal, NotRequired, TypedDict, assert_never, cast

from sqlalchemy import select

from core.app.file_access import FileAccessControllerProtocol
from core.db.session_factory import session_factory
from core.workflow.file_reference import build_file_reference
from graphon.file import File, FileTransferMethod, FileType, FileUploadConfig, helpers, standardize_file_type
from models import ToolFile, UploadFile

from .common import resolve_mapping_file_id
from .remote import get_remote_file_info
from .validation import is_file_valid_with_config

type FileTypeValue = FileType | Literal["image", "document", "audio", "video", "custom"]

type _LocalFileTransferMethod = Literal["local_file", FileTransferMethod.LOCAL_FILE]
type _RemoteUrlTransferMethod = Literal["remote_url", FileTransferMethod.REMOTE_URL]
type _ToolFileTransferMethod = Literal["tool_file", FileTransferMethod.TOOL_FILE]
type _DatasourceFileTransferMethod = Literal["datasource_file", FileTransferMethod.DATASOURCE_FILE]


class LocalFileMapping(TypedDict):
    transfer_method: _LocalFileTransferMethod
    id: NotRequired[str | None]  # Read as the graph-layer File.file_id.
    type: NotRequired[FileTypeValue | None]  # Read for type override and upload config validation.
    upload_file_id: NotRequired[str | None]  # File id lookup priority 1.
    reference: NotRequired[str | None]  # File id lookup priority 2; may be an opaque file reference.
    related_id: NotRequired[str | None]  # File id lookup priority 3; legacy persisted field.


class RemoteUrlMapping(TypedDict):
    transfer_method: _RemoteUrlTransferMethod
    id: NotRequired[str | None]  # Read as the graph-layer File.file_id.
    type: NotRequired[FileTypeValue | None]  # Read for type override and upload config validation.
    upload_file_id: NotRequired[str | None]  # Persisted UploadFile lookup priority 1.
    reference: NotRequired[str | None]  # Persisted UploadFile lookup priority 2; may be an opaque file reference.
    related_id: NotRequired[str | None]  # Persisted UploadFile lookup priority 3; legacy persisted field.
    url: NotRequired[str | None]  # External URL lookup priority 1 when no UploadFile id is resolved.
    remote_url: NotRequired[str | None]  # External URL lookup priority 2 when no UploadFile id is resolved.


class ToolFileMapping(TypedDict):
    transfer_method: _ToolFileTransferMethod
    id: NotRequired[str | None]  # Read as the graph-layer File.file_id.
    type: NotRequired[FileTypeValue | None]  # Read for type override and upload config validation.
    tool_file_id: NotRequired[str | None]  # ToolFile lookup priority 1.
    reference: NotRequired[str | None]  # ToolFile lookup priority 2; may be an opaque file reference.
    related_id: NotRequired[str | None]  # ToolFile lookup priority 3; legacy persisted field.


class DatasourceFileMapping(TypedDict):
    transfer_method: _DatasourceFileTransferMethod
    type: NotRequired[FileTypeValue | None]  # Read for type override and upload config validation.
    datasource_file_id: NotRequired[str | None]  # UploadFile lookup priority 1 for datasource-backed files.
    reference: NotRequired[str | None]  # UploadFile lookup priority 2; may be an opaque file reference.
    related_id: NotRequired[str | None]  # UploadFile lookup priority 3; legacy persisted field.


type FileMapping = LocalFileMapping | RemoteUrlMapping | ToolFileMapping | DatasourceFileMapping
type FileMappingInput = FileMapping | Mapping[str, Any]


def build_from_mapping(
    *,
    mapping: FileMappingInput,
    tenant_id: str,
    config: FileUploadConfig | None = None,
    strict_type_validation: bool = False,
    access_controller: FileAccessControllerProtocol,
) -> File:
    transfer_method_value = mapping.get("transfer_method")
    if not transfer_method_value:
        raise ValueError("transfer_method is required in file mapping")

    transfer_method = FileTransferMethod.value_of(str(transfer_method_value))
    match transfer_method:
        case FileTransferMethod.LOCAL_FILE:
            file = _build_from_local_file(
                mapping=cast(LocalFileMapping, mapping),
                tenant_id=tenant_id,
                transfer_method=transfer_method,
                strict_type_validation=strict_type_validation,
                access_controller=access_controller,
            )
        case FileTransferMethod.REMOTE_URL:
            file = _build_from_remote_url(
                mapping=cast(RemoteUrlMapping, mapping),
                tenant_id=tenant_id,
                transfer_method=transfer_method,
                strict_type_validation=strict_type_validation,
                access_controller=access_controller,
            )
        case FileTransferMethod.TOOL_FILE:
            file = _build_from_tool_file(
                mapping=cast(ToolFileMapping, mapping),
                tenant_id=tenant_id,
                transfer_method=transfer_method,
                strict_type_validation=strict_type_validation,
                access_controller=access_controller,
            )
        case FileTransferMethod.DATASOURCE_FILE:
            file = _build_from_datasource_file(
                mapping=cast(DatasourceFileMapping, mapping),
                tenant_id=tenant_id,
                transfer_method=transfer_method,
                strict_type_validation=strict_type_validation,
                access_controller=access_controller,
            )
        case _:
            assert_never(transfer_method)

    if config and not is_file_valid_with_config(
        input_file_type=mapping.get("type") or FileType.CUSTOM,
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


def _resolve_file_type(
    *,
    detected_file_type: FileType,
    specified_type: FileTypeValue | str | None,
    strict_type_validation: bool,
) -> FileType:
    """Resolve the graph file type from detected metadata and submitted form type.

    ``custom`` is a configured extension bucket rather than a MIME-derived type,
    so strict validation must leave extension checks to the upload config.
    """
    if not specified_type:
        return detected_file_type

    specified_file_type = FileType(specified_type)
    if specified_file_type == FileType.CUSTOM:
        return FileType.CUSTOM

    if strict_type_validation and detected_file_type != specified_file_type:
        raise ValueError("Detected file type does not match the specified type. Please verify the file.")

    return specified_file_type


def _build_from_local_file(
    *,
    mapping: LocalFileMapping,
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
    with session_factory.create_session() as session:
        row = session.scalar(access_controller.apply_upload_file_filters(stmt))
        if row is None:
            raise ValueError("Invalid upload file")

        detected_file_type = standardize_file_type(extension="." + row.extension, mime_type=row.mime_type)
        file_type = _resolve_file_type(
            detected_file_type=detected_file_type,
            specified_type=mapping.get("type"),
            strict_type_validation=strict_type_validation,
        )

        return File(
            file_id=mapping.get("id"),
            filename=row.name,
            extension="." + row.extension,
            mime_type=row.mime_type,
            file_type=file_type,
            transfer_method=transfer_method,
            remote_url=row.source_url,
            reference=build_file_reference(record_id=str(row.id)),
            size=row.size,
            storage_key=row.key,
        )


def _build_from_remote_url(
    *,
    mapping: RemoteUrlMapping,
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
        with session_factory.create_session() as session:
            upload_file = session.scalar(access_controller.apply_upload_file_filters(stmt))
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
                file_id=mapping.get("id"),
                filename=upload_file.name,
                extension="." + upload_file.extension,
                mime_type=upload_file.mime_type,
                file_type=file_type,
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
    extension = os.path.splitext(filename)[1].lower() or mimetypes.guess_extension(mime_type) or ".bin"
    detected_file_type = standardize_file_type(extension=extension, mime_type=mime_type)
    file_type = _resolve_file_type(
        detected_file_type=detected_file_type,
        specified_type=mapping.get("type"),
        strict_type_validation=strict_type_validation,
    )

    return File(
        file_id=mapping.get("id"),
        filename=filename,
        file_type=file_type,
        transfer_method=transfer_method,
        remote_url=url,
        mime_type=mime_type,
        extension=extension,
        size=file_size,
    )


def _build_from_tool_file(
    *,
    mapping: ToolFileMapping,
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
    with session_factory.create_session() as session:
        tool_file = session.scalar(access_controller.apply_tool_file_filters(stmt))
        if tool_file is None:
            raise ValueError(f"ToolFile {tool_file_id} not found")

        extension = (
            os.path.splitext(tool_file.name)[1].lower()
            or mimetypes.guess_extension(tool_file.mimetype)
            or os.path.splitext(tool_file.file_key)[1].lower()
            or ".bin"
        )
        detected_file_type = standardize_file_type(extension=extension, mime_type=tool_file.mimetype)
        file_type = _resolve_file_type(
            detected_file_type=detected_file_type,
            specified_type=mapping.get("type"),
            strict_type_validation=strict_type_validation,
        )

        return File(
            file_id=mapping.get("id"),
            filename=tool_file.name,
            file_type=file_type,
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
    mapping: DatasourceFileMapping,
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
    with session_factory.create_session() as session:
        datasource_file = session.scalar(access_controller.apply_upload_file_filters(stmt))
        if datasource_file is None:
            raise ValueError(f"DatasourceFile {mapping.get('datasource_file_id')} not found")

        extension = "." + datasource_file.key.split(".")[-1] if "." in datasource_file.key else ".bin"
        detected_file_type = standardize_file_type(extension=extension, mime_type=datasource_file.mime_type)
        file_type = _resolve_file_type(
            detected_file_type=detected_file_type,
            specified_type=mapping.get("type"),
            strict_type_validation=strict_type_validation,
        )

        return File(
            file_id=mapping.get("datasource_file_id"),
            filename=datasource_file.name,
            file_type=file_type,
            transfer_method=transfer_method,
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
