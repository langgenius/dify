"""Tenant-scope validator for file refs produced by Agent backend outputs.

Agent outputs can point at tenant-owned ``upload_files`` or ``tool_files``
records. Sandbox-originated output uploads become ``ToolFile`` rows, so the
validator must accept both storage record families while still rejecting any
cross-tenant or malformed identifier. ``PerOutputTypeChecker`` accepts a
``FileTenantValidator`` Protocol so unit tests can stub the check without
hitting Postgres.
"""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.exc import DataError, SQLAlchemyError

from core.db.session_factory import session_factory
from graphon.file import FileTransferMethod
from models import ToolFile
from models.model import UploadFile


class DatabaseFileTenantValidator:
    """Production ``FileTenantValidator`` backed by file ownership tables.

    Returns ``False`` (rejects the file) on any pathological input: empty
    file_id/tenant_id, non-UUID file_id format, DB errors. The Agent backend
    may produce arbitrary strings inside file refs since the schema only
    asserts ``{type: string}``; treating malformed refs as invalid keeps the
    workflow node from crashing on garbage backend output.
    """

    def is_accessible_file_mapping(
        self,
        *,
        file_id: str,
        tenant_id: str,
        transfer_method: FileTransferMethod,
    ) -> bool:
        if not file_id or not tenant_id:
            return False
        try:
            UUID(file_id)
        except (ValueError, TypeError):
            return False

        try:
            with session_factory.create_session() as session:
                if transfer_method in {FileTransferMethod.LOCAL_FILE, FileTransferMethod.DATASOURCE_FILE}:
                    owner_tenant_id = session.scalar(select(UploadFile.tenant_id).where(UploadFile.id == file_id))
                elif transfer_method == FileTransferMethod.TOOL_FILE:
                    owner_tenant_id = session.scalar(select(ToolFile.tenant_id).where(ToolFile.id == file_id))
                else:
                    return False
        except (DataError, SQLAlchemyError):
            return False
        return owner_tenant_id == tenant_id


AgentOutputFileTenantValidator = DatabaseFileTenantValidator
UploadFileTenantValidator = DatabaseFileTenantValidator
