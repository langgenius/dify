"""Tenant-scope validator for file refs produced by Agent backend outputs.

Stage 4 §5.3 / Agent Files §4.6: every file output the Agent backend produces
must resolve to a file record owned by the current tenant; cross-tenant file
references must never be plumbed downstream. Agent runtime output files are
canonically ``ToolFile`` (referenced by a minimal ``{id}``), so this validator
checks ``tool_files`` first and falls back to ``upload_files`` for compatibility
with older/manual refs. ``PerOutputTypeChecker`` accepts a ``FileTenantValidator``
Protocol so unit tests can stub the check without hitting Postgres.
"""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.exc import DataError, SQLAlchemyError

from core.db.session_factory import session_factory
from models.model import UploadFile
from models.tools import ToolFile


class AgentOutputFileTenantValidator:
    """Production ``FileTenantValidator`` backed by ``tool_files`` + ``upload_files``.

    Returns ``False`` (rejects the file) on any pathological input: empty
    file_id/tenant_id, non-UUID file_id format, DB errors. The Agent backend
    may produce arbitrary strings inside file refs since the schema only
    asserts ``{type: string}``; treating malformed refs as invalid keeps the
    workflow node from crashing on garbage backend output.
    """

    def is_owned_by_tenant(self, *, file_id: str, tenant_id: str) -> bool:
        if not file_id or not tenant_id:
            return False
        try:
            UUID(file_id)
        except (ValueError, TypeError):
            return False
        try:
            with session_factory.create_session() as session:
                # Agent output files are canonically ToolFile; check it first.
                tool_owner = session.scalar(select(ToolFile.tenant_id).where(ToolFile.id == file_id))
                if tool_owner is not None:
                    return tool_owner == tenant_id
                upload_owner = session.scalar(select(UploadFile.tenant_id).where(UploadFile.id == file_id))
        except (DataError, SQLAlchemyError):
            return False
        return upload_owner == tenant_id


# Back-compat alias for callers/tests that imported the upload-only name.
UploadFileTenantValidator = AgentOutputFileTenantValidator
