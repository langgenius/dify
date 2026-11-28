from __future__ import annotations

import os
from collections.abc import Sequence

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from models.enums import CreatorUserRole, EndUserType
from models.model import App, EndUser, UploadFile
from models.tools import ToolFile
from services.entities.file_grant_entities import (
    FileContentRecord,
    FileGrantContext,
    FileKind,
    FileRef,
    ResolvedFile,
)


def find_file_row(
    session: Session, *, file_id: str, kind: FileKind, tenant_id: str | None
) -> UploadFile | ToolFile | None:
    """Read the requested file kind in the caller's session and transaction.

    An absent or foreign file returns None. A None tenant is reserved for a
    signed file ID whose authorization has already been verified by the caller.
    """
    model: type[UploadFile] | type[ToolFile]
    match kind:
        case FileKind.UPLOAD:
            model = UploadFile
        case FileKind.TOOL:
            model = ToolFile
        case _:
            return None
    statement = select(model).where(model.id == file_id)
    if tenant_id is not None:
        statement = statement.where(model.tenant_id == tenant_id)
    return session.scalar(statement.limit(1))


class FileGrantRepository:
    def __init__(self, *, session_factory: sessionmaker[Session]) -> None:
        self._session_factory = session_factory

    def get_or_create_subject(
        self,
        *,
        tenant_id: str,
        app_id: str,
        session_id: str,
        external_user_id: str,
        is_anonymous: bool,
    ) -> str | None:
        with self._session_factory() as session:
            end_user = session.scalar(
                self._subject_statement(
                    tenant_id=tenant_id,
                    app_id=app_id,
                    session_id=session_id,
                    require_app=True,
                ).limit(1)
            )
            if end_user is not None:
                return end_user.id

        with self._session_factory.begin() as session:
            app = session.scalar(select(App).where(App.id == app_id, App.tenant_id == tenant_id).with_for_update())
            if app is None:
                return None

            end_user = session.scalar(
                self._subject_statement(
                    tenant_id=tenant_id,
                    app_id=app_id,
                    session_id=session_id,
                    require_app=False,
                ).limit(1)
            )
            if end_user is None:
                end_user = EndUser(
                    tenant_id=tenant_id,
                    app_id=app_id,
                    type=EndUserType.APP_DEPLOY,
                    _is_anonymous=is_anonymous,
                    session_id=session_id,
                    external_user_id=external_user_id,
                )
                session.add(end_user)
                session.flush()
            return end_user.id

    def subject_exists(self, context: FileGrantContext) -> bool:
        with self._session_factory() as session:
            return (
                session.scalar(
                    select(EndUser.id)
                    .where(
                        EndUser.id == context.end_user_id,
                        EndUser.tenant_id == context.tenant_id,
                        EndUser.app_id == context.app_id,
                        EndUser.type == EndUserType.APP_DEPLOY,
                    )
                    .limit(1)
                )
                is not None
            )

    def get_end_user(self, context: FileGrantContext) -> EndUser | None:
        with self._session_factory(expire_on_commit=False) as session:
            return session.scalar(
                select(EndUser)
                .where(
                    EndUser.id == context.end_user_id,
                    EndUser.tenant_id == context.tenant_id,
                    EndUser.app_id == context.app_id,
                    EndUser.type == EndUserType.APP_DEPLOY,
                )
                .limit(1)
            )

    def resolve_owned_files(
        self,
        *,
        context: FileGrantContext,
        refs: Sequence[FileRef],
    ) -> list[ResolvedFile | None]:
        upload_ids = {ref.id for ref in refs if ref.kind == FileKind.UPLOAD}
        tool_ids = {ref.id for ref in refs if ref.kind == FileKind.TOOL}

        with self._session_factory() as session:
            uploads = self._load_uploads(session, context=context, file_ids=upload_ids)
            tool_files = self._load_tool_files(session, context=context, file_ids=tool_ids)

        return [uploads.get(ref.id) if ref.kind == FileKind.UPLOAD else tool_files.get(ref.id) for ref in refs]

    def get_content_record(self, *, file_id: str, kind: FileKind) -> FileContentRecord | None:
        """Return detached metadata once the caller has verified the signed file ID and kind."""
        return self._get_content_record(file_id=file_id, kind=kind, tenant_id=None)

    def get_workspace_content_record(self, *, tenant_id: str, file_id: str, kind: FileKind) -> FileContentRecord | None:
        """Read an admitted workspace file by ID and kind, irrespective of who uploaded it.

        The caller must authorize access to the workspace resource referencing
        the file. Missing, foreign, or different-kind files return None. The
        metadata is detached before the caller can read storage.
        """
        return self._get_content_record(file_id=file_id, kind=kind, tenant_id=tenant_id)

    def _get_content_record(self, *, file_id: str, kind: FileKind, tenant_id: str | None) -> FileContentRecord | None:
        """Read metadata for one kind and close its session, optionally applying the workspace scope."""
        with self._session_factory() as session:
            file = find_file_row(session, file_id=file_id, kind=kind, tenant_id=tenant_id)
            if file is None:
                return None
            if isinstance(file, UploadFile):
                return FileContentRecord(
                    name=file.name,
                    size=file.size,
                    mime_type=file.mime_type,
                    storage_key=file.key,
                )
            return FileContentRecord(
                name=file.name or "",
                size=file.size,
                mime_type=file.mimetype,
                storage_key=file.file_key,
            )

    @staticmethod
    def _subject_statement(*, tenant_id: str, app_id: str, session_id: str, require_app: bool):
        statement = select(EndUser)
        if require_app:
            statement = statement.join(App, App.id == EndUser.app_id)
        predicates = [
            EndUser.tenant_id == tenant_id,
            EndUser.app_id == app_id,
            EndUser.session_id == session_id,
            EndUser.type == EndUserType.APP_DEPLOY,
        ]
        if require_app:
            predicates.append(App.tenant_id == tenant_id)
        return statement.where(*predicates)

    @staticmethod
    def _load_uploads(
        session: Session,
        *,
        context: FileGrantContext,
        file_ids: set[str],
    ) -> dict[str, ResolvedFile]:
        if not file_ids:
            return {}
        rows = session.scalars(
            select(UploadFile).where(
                UploadFile.id.in_(file_ids),
                UploadFile.tenant_id == context.tenant_id,
                UploadFile.created_by_role == CreatorUserRole.END_USER,
                UploadFile.created_by == context.end_user_id,
            )
        ).all()
        return {
            row.id: ResolvedFile(
                id=row.id,
                kind=FileKind.UPLOAD,
                name=row.name,
                size=row.size,
                extension=row.extension,
                mime_type=row.mime_type,
            )
            for row in rows
        }

    @staticmethod
    def _load_tool_files(
        session: Session,
        *,
        context: FileGrantContext,
        file_ids: set[str],
    ) -> dict[str, ResolvedFile]:
        if not file_ids:
            return {}
        rows = session.scalars(
            select(ToolFile).where(
                ToolFile.id.in_(file_ids),
                ToolFile.tenant_id == context.tenant_id,
                ToolFile.user_id == context.end_user_id,
            )
        ).all()
        return {
            row.id: ResolvedFile(
                id=row.id,
                kind=FileKind.TOOL,
                name=row.name or "",
                size=row.size,
                extension=os.path.splitext(row.name or "")[1].lstrip(".").lower(),
                mime_type=row.mimetype,
            )
            for row in rows
        }


__all__ = ["FileGrantRepository", "find_file_row"]
