"""Adapters from persisted message files to graph-layer file values."""

from __future__ import annotations

from collections.abc import Sequence

from graphon.file import File, FileBelongsTo, FileTransferMethod, FileUploadConfig

from core.app.file_access import FileAccessControllerProtocol
from models import MessageFile

from .builders import build_from_mapping


def build_from_message_files(
    *,
    message_files: Sequence[MessageFile],
    tenant_id: str,
    config: FileUploadConfig | None = None,
    access_controller: FileAccessControllerProtocol,
) -> Sequence[File]:
    return [
        build_from_message_file(
            message_file=message_file,
            tenant_id=tenant_id,
            config=config,
            access_controller=access_controller,
        )
        for message_file in message_files
        if message_file.belongs_to != FileBelongsTo.ASSISTANT
    ]


def build_from_message_file(
    *,
    message_file: MessageFile,
    tenant_id: str,
    config: FileUploadConfig | None,
    access_controller: FileAccessControllerProtocol,
) -> File:
    mapping = {
        "transfer_method": message_file.transfer_method,
        "url": message_file.url,
        "type": message_file.type,
    }

    if message_file.id:
        mapping["id"] = message_file.id

    if message_file.transfer_method == FileTransferMethod.TOOL_FILE:
        mapping["tool_file_id"] = message_file.upload_file_id
    else:
        mapping["upload_file_id"] = message_file.upload_file_id

    return build_from_mapping(
        mapping=mapping,
        tenant_id=tenant_id,
        config=config,
        access_controller=access_controller,
    )
