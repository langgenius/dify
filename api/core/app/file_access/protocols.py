from __future__ import annotations

from typing import Protocol

from sqlalchemy.orm import Session
from sqlalchemy.sql import Select

from models import ToolFile, UploadFile

from .scope import FileAccessScope


class FileAccessControllerProtocol(Protocol):
    """Contract for applying access rules to file lookups.

    Implementations translate an optional execution scope into query constraints
    and authorized record retrieval. The contract is intentionally limited to
    ownership and tenancy rules for workflow-layer file access.
    """

    def current_scope(self) -> FileAccessScope | None:
        """Return the scope active for the current execution, if one exists.

        Callers use this to decide whether embedded file metadata may be trusted
        or whether a fresh authorized lookup is required.
        """
        ...

    def apply_upload_file_filters(
        self,
        stmt: Select[tuple[UploadFile]],
        *,
        scope: FileAccessScope | None = None,
    ) -> Select[tuple[UploadFile]]:
        """Return an upload-file query constrained by the supplied access scope.

        The returned statement must preserve the caller's existing predicates and
        append only access-control conditions.
        """
        ...

    def apply_tool_file_filters(
        self,
        stmt: Select[tuple[ToolFile]],
        *,
        scope: FileAccessScope | None = None,
    ) -> Select[tuple[ToolFile]]:
        """Return a tool-file query constrained by the supplied access scope.

        The returned statement must preserve the caller's existing predicates and
        append only access-control conditions.
        """
        ...

    def get_upload_file(
        self,
        *,
        session: Session,
        file_id: str,
        scope: FileAccessScope | None = None,
    ) -> UploadFile | None:
        """Load one authorized upload-file record for the given identifier.

        Returns ``None`` when the file does not exist or when the scope does not
        permit access to that record.
        """
        ...

    def get_tool_file(
        self,
        *,
        session: Session,
        file_id: str,
        scope: FileAccessScope | None = None,
    ) -> ToolFile | None:
        """Load one authorized tool-file record for the given identifier.

        Returns ``None`` when the file does not exist or when the scope does not
        permit access to that record.
        """
        ...
