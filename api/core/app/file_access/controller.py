from __future__ import annotations

from collections.abc import Callable

from sqlalchemy import and_, or_, select
from sqlalchemy.orm import Session
from sqlalchemy.sql import Select

from models import ToolFile, UploadFile
from models.enums import CreatorUserRole

from .protocols import FileAccessControllerProtocol
from .scope import FileAccessScope, get_current_file_access_scope


class DatabaseFileAccessController(FileAccessControllerProtocol):
    """Workflow-layer authorization helper for database-backed file lookups.

    Tenant scoping remains mandatory. When the current execution belongs to an
    end user, the lookup is additionally constrained to that end user's file
    ownership markers, plus upload files explicitly granted by the current
    execution context.
    """

    _scope_getter: Callable[[], FileAccessScope | None]

    def __init__(
        self,
        *,
        scope_getter: Callable[[], FileAccessScope | None] = get_current_file_access_scope,
    ) -> None:
        self._scope_getter = scope_getter

    def current_scope(self) -> FileAccessScope | None:
        return self._scope_getter()

    def apply_upload_file_filters(
        self,
        stmt: Select[tuple[UploadFile]],
        *,
        scope: FileAccessScope | None = None,
    ) -> Select[tuple[UploadFile]]:
        resolved_scope = scope or self.current_scope()
        if resolved_scope is None:
            return stmt

        scoped_stmt = stmt.where(UploadFile.tenant_id == resolved_scope.tenant_id)
        if not resolved_scope.requires_user_ownership:
            return scoped_stmt

        user_owned_filter = and_(
            UploadFile.created_by_role == CreatorUserRole.END_USER,
            UploadFile.created_by == resolved_scope.user_id,
        )
        if not resolved_scope.granted_upload_file_ids:
            return scoped_stmt.where(user_owned_filter)

        return scoped_stmt.where(
            or_(
                user_owned_filter,
                UploadFile.id.in_(resolved_scope.granted_upload_file_ids),
            )
        )

    def apply_tool_file_filters(
        self,
        stmt: Select[tuple[ToolFile]],
        *,
        scope: FileAccessScope | None = None,
    ) -> Select[tuple[ToolFile]]:
        resolved_scope = scope or self.current_scope()
        if resolved_scope is None:
            return stmt

        scoped_stmt = stmt.where(ToolFile.tenant_id == resolved_scope.tenant_id)
        if not resolved_scope.requires_user_ownership:
            return scoped_stmt

        return scoped_stmt.where(ToolFile.user_id == resolved_scope.user_id)

    def get_upload_file(
        self,
        *,
        session: Session,
        file_id: str,
        scope: FileAccessScope | None = None,
    ) -> UploadFile | None:
        resolved_scope = scope or self.current_scope()
        if resolved_scope is None:
            return session.get(UploadFile, file_id)

        stmt = self.apply_upload_file_filters(
            select(UploadFile).where(UploadFile.id == file_id),
            scope=resolved_scope,
        )
        return session.scalar(stmt)

    def get_tool_file(
        self,
        *,
        session: Session,
        file_id: str,
        scope: FileAccessScope | None = None,
    ) -> ToolFile | None:
        resolved_scope = scope or self.current_scope()
        if resolved_scope is None:
            return session.get(ToolFile, file_id)

        stmt = self.apply_tool_file_filters(
            select(ToolFile).where(ToolFile.id == file_id),
            scope=resolved_scope,
        )
        return session.scalar(stmt)
