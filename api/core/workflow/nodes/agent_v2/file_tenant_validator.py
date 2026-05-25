"""Tenant-scope validator for file refs produced by Agent backend outputs.

Stage 4 §5.3: every file output the Agent backend produces must resolve to an
``upload_files`` row that belongs to the current tenant; cross-tenant file
references must never be plumbed downstream. ``PerOutputTypeChecker`` accepts a
``FileTenantValidator`` Protocol so unit tests can stub the check without
hitting Postgres.

This module supplies the production implementation that queries the
``upload_files`` table via SQLAlchemy.
"""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.exc import DataError, SQLAlchemyError

from core.db.session_factory import session_factory
from models.model import UploadFile


class UploadFileTenantValidator:
    """Production ``FileTenantValidator`` backed by the ``upload_files`` table.

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
                owner_tenant_id = session.scalar(select(UploadFile.tenant_id).where(UploadFile.id == file_id))
        except (DataError, SQLAlchemyError):
            return False
        return owner_tenant_id == tenant_id
