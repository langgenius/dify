"""Adapters from persisted message files to graph-layer file values.

Replay paths only: files in conversation history were validated at upload time,
so these helpers deliberately do not accept (or forward) a ``FileUploadConfig`` —
re-validation here would break replays whenever workflow ``file_upload`` config
drifts between rounds. Mirrors ``build_file_from_stored_mapping`` in
``models/utils/file_input_compat.py``.
"""

from __future__ import annotations

from collections.abc import Sequence

from core.app.file_access import FileAccessControllerProtocol
from graphon.file import File, FileBelongsTo, FileTransferMethod
from models import MessageFile

from .builders import build_from_mapping


def build_from_message_files(
    *,
    message_files: Sequence[MessageFile],
    tenant_id: str,
    access_controller: FileAccessControllerProtocol,
) -> Sequence[File]:
    return [
        build_from_message_file(
            message_file=message_file,
            tenant_id=tenant_id,
            access_controller=access_controller,
        )
        for message_file in message_files
        if message_file.belongs_to != FileBelongsTo.ASSISTANT
    ]


def build_from_message_file(
    *,
    message_file: MessageFile,
    tenant_id: str,
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
        access_controller=access_controller,
    )
