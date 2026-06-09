"""Reback an Agent backend file output (a bare ``ToolFile`` id) into a graphon File.

Agent Files §4.6: an agent run returns output files referenced only by id
(``{"id": "<tool_file_id>"}``). The authoritative ``filename`` / ``mime_type`` /
``extension`` / ``size`` come from the ``ToolFile`` row, never from the
(untrusted) sandbox payload. This module resolves a tenant-owned ToolFile id
into a full graphon ``File`` so downstream workflow consumers get correct,
trustworthy metadata.
"""

from __future__ import annotations

from mimetypes import guess_extension
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.exc import DataError, SQLAlchemyError

from core.db.session_factory import session_factory
from core.workflow.file_reference import build_file_reference
from graphon.file import File, FileTransferMethod, get_file_type_by_mime_type
from models.tools import ToolFile


def reback_tool_file_output(*, tenant_id: str, tool_file_id: str) -> File | None:
    """Build a graphon File from a ToolFile id owned by ``tenant_id``.

    Returns ``None`` when the id is empty/malformed or does not resolve to a
    ToolFile owned by the tenant (the caller then treats the value as a plain
    object rather than fabricating a file with empty metadata).
    """
    if not tool_file_id or not tenant_id:
        return None
    try:
        UUID(tool_file_id)
    except (ValueError, TypeError):
        return None
    try:
        with session_factory.create_session() as session:
            tool_file = session.scalar(
                select(ToolFile).where(ToolFile.id == tool_file_id, ToolFile.tenant_id == tenant_id)
            )
    except (DataError, SQLAlchemyError):
        return None
    if tool_file is None:
        return None

    mime_type = tool_file.mimetype or ""
    extension = guess_extension(mime_type) or ".bin"
    return File(
        type=get_file_type_by_mime_type(mime_type),
        transfer_method=FileTransferMethod.TOOL_FILE,
        remote_url=None,
        reference=build_file_reference(record_id=str(tool_file.id)),
        related_id=tool_file.id,
        filename=tool_file.name,
        extension=extension,
        mime_type=mime_type or None,
        size=tool_file.size,
    )


__all__ = ["reback_tool_file_output"]
