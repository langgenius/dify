"""Identity, storage, and file-ownership behind the AppDeploy file grant.

An AppDeploy subject is asserted exactly once, when the enterprise control
plane mints a grant. Everything downstream verifies the grant's signature and
reads by primary key, so this module owns the only stateful step in the flow.

Invariant: this module is the sole writer of ``EndUserType.APP_DEPLOY`` rows.
``end_users`` has no unique constraint, so a second writer would silently split
one AppDeploy subject across two identities and strand its files. New code that
needs such an end user must call :meth:`FileGrantService.get_or_create_end_user`.
"""

from __future__ import annotations

import base64
import hashlib
import os
from collections.abc import Generator, Sequence
from dataclasses import dataclass
from typing import IO

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from core.tools.tool_file_manager import ToolFileManager, resolve_extension
from extensions.ext_database import db
from extensions.ext_storage import storage
from libs.file_grant import FileKind
from models.enums import CreatorUserRole, EndUserType
from models.model import App, EndUser, UploadFile
from models.tools import ToolFile
from services.errors.file import FileTooLargeError
from services.file_service import FileService

SESSION_ID_PREFIX = "adp2:"


class AppNotFoundError(Exception):
    """The app named by a mint request does not exist in the given tenant."""


class EndUserNotFoundError(Exception):
    """The grant points at an AppDeploy end user that no longer exists."""


@dataclass(frozen=True, slots=True)
class FileRef:
    id: str
    kind: FileKind


@dataclass(frozen=True, slots=True)
class ResolvedFile:
    id: str
    kind: FileKind
    name: str
    size: int
    extension: str
    mime_type: str | None


@dataclass(frozen=True, slots=True)
class FileContent:
    name: str
    size: int
    mime_type: str | None
    stream: Generator


class FileGrantService:
    """Resolve AppDeploy identities and the files they own."""

    @staticmethod
    def session_id_for_subject(subject: str) -> str:
        """Fold an opaque subject into the 255-char ``end_users.session_id`` column."""

        digest = hashlib.sha256(subject.encode()).digest()
        return SESSION_ID_PREFIX + base64.urlsafe_b64encode(digest).decode().rstrip("=")

    @classmethod
    def get_or_create_end_user(
        cls,
        *,
        tenant_id: str,
        app_id: str,
        subject: str,
        is_anonymous: bool,
    ) -> EndUser:
        """Return the AppDeploy end user for a subject, creating it at most once.

        The common path is an unlocked read. Only a miss takes the app row lock
        and re-reads under it, which is what makes concurrent first mints of the
        same subject converge on a single row despite the missing constraint.
        """

        session_id = cls.session_id_for_subject(subject)
        session_maker = sessionmaker(bind=db.engine, expire_on_commit=False)

        with session_maker() as session:
            end_user = cls._select_end_user(session, tenant_id=tenant_id, app_id=app_id, session_id=session_id)
            if end_user is not None:
                return end_user

        with session_maker.begin() as session:
            app = session.scalar(select(App).where(App.id == app_id, App.tenant_id == tenant_id).with_for_update())
            if app is None:
                raise AppNotFoundError(app_id)

            end_user = cls._select_end_user(session, tenant_id=tenant_id, app_id=app_id, session_id=session_id)
            if end_user is None:
                end_user = EndUser(
                    tenant_id=tenant_id,
                    app_id=app_id,
                    type=EndUserType.APP_DEPLOY,
                    is_anonymous=is_anonymous,
                    session_id=session_id,
                    external_user_id=subject[:255],
                )
                session.add(end_user)

        return end_user

    @classmethod
    def _load_end_user(cls, *, end_user_id: str, tenant_id: str) -> EndUser | None:
        """Load the end user a grant points at, refusing a tenant mismatch."""

        with sessionmaker(bind=db.engine, expire_on_commit=False)() as session:
            return session.scalar(
                select(EndUser)
                .where(
                    EndUser.id == end_user_id,
                    EndUser.tenant_id == tenant_id,
                    EndUser.type == EndUserType.APP_DEPLOY,
                )
                .limit(1)
            )

    @classmethod
    def store_upload(
        cls,
        *,
        tenant_id: str,
        end_user_id: str,
        filename: str,
        content: bytes,
        mimetype: str,
        source_url: str = "",
    ) -> UploadFile:
        """Store bytes as an ``upload_files`` row owned by the grant's end user."""

        end_user = cls._load_end_user(end_user_id=end_user_id, tenant_id=tenant_id)
        if end_user is None:
            raise EndUserNotFoundError(end_user_id)

        return FileService(db.engine).upload_file(
            filename=filename,
            content=content,
            mimetype=mimetype,
            user=end_user,
            source_url=source_url,
        )

    @staticmethod
    def store_produced(
        *,
        tenant_id: str,
        end_user_id: str,
        filename: str | None,
        stream: IO[bytes],
        mimetype: str,
    ) -> ToolFile:
        """Store bytes a workflow node produced as a ``tool_files`` row.

        Takes the body as a stream rather than bytes because the caller is a
        worker running third-party plugin code that reaches this process
        directly, with no proxy body limit in front of it. Buffering the body in
        order to measure it would be the denial of service, so the read stops one
        byte past the largest size any extension could be allowed, and the exact
        per-extension limit is applied after, once the extension is known.
        ``create_file_by_raw`` enforces no size limit of its own.
        """

        cap = FileService.largest_file_size_limit()
        content = stream.read(cap + 1)
        if len(content) > cap:
            raise FileTooLargeError(f"File size exceeded. The limit is {cap} bytes.")

        extension = resolve_extension(filename=filename, mimetype=mimetype).lstrip(".").lower()
        if not FileService.is_file_size_within_limit(extension=extension, file_size=len(content)):
            raise FileTooLargeError(f"File size exceeded. {len(content)} bytes is too large.")

        return ToolFileManager().create_file_by_raw(
            user_id=end_user_id,
            tenant_id=tenant_id,
            conversation_id=None,
            file_binary=content,
            mimetype=mimetype,
            filename=filename,
        )

    @classmethod
    def resolve_files(
        cls,
        *,
        tenant_id: str,
        end_user_id: str,
        refs: Sequence[FileRef],
    ) -> list[ResolvedFile | None]:
        """Resolve file references owned by one end user, ``None`` per miss.

        A file that exists but belongs to another owner or tenant resolves to
        ``None`` exactly like a file that does not exist, so callers cannot use
        this to probe for existence.
        """

        with sessionmaker(bind=db.engine, expire_on_commit=False)() as session:
            return [cls._resolve_file(session, tenant_id=tenant_id, end_user_id=end_user_id, ref=ref) for ref in refs]

    @classmethod
    def load_content(cls, *, file_id: str, kind: FileKind) -> FileContent | None:
        """Open the stored bytes of one file addressed by a content token."""

        with sessionmaker(bind=db.engine, expire_on_commit=False)() as session:
            match kind:
                case FileKind.UPLOAD:
                    upload_file = session.scalar(select(UploadFile).where(UploadFile.id == file_id).limit(1))
                    if upload_file is None:
                        return None
                    return FileContent(
                        name=upload_file.name,
                        size=upload_file.size,
                        mime_type=upload_file.mime_type,
                        stream=storage.load(upload_file.key, stream=True),
                    )
                case FileKind.TOOL:
                    tool_file = session.scalar(select(ToolFile).where(ToolFile.id == file_id).limit(1))
                    if tool_file is None:
                        return None
                    return FileContent(
                        name=tool_file.name,
                        size=tool_file.size,
                        mime_type=tool_file.mimetype,
                        stream=storage.load(tool_file.file_key, stream=True),
                    )

    @staticmethod
    def _select_end_user(session: Session, *, tenant_id: str, app_id: str, session_id: str) -> EndUser | None:
        return session.scalar(
            select(EndUser)
            .where(
                EndUser.tenant_id == tenant_id,
                EndUser.app_id == app_id,
                EndUser.session_id == session_id,
                EndUser.type == EndUserType.APP_DEPLOY,
            )
            .limit(1)
        )

    @classmethod
    def _resolve_file(
        cls,
        session: Session,
        *,
        tenant_id: str,
        end_user_id: str,
        ref: FileRef,
    ) -> ResolvedFile | None:
        match ref.kind:
            case FileKind.UPLOAD:
                upload_file = session.scalar(
                    select(UploadFile)
                    .where(
                        UploadFile.id == ref.id,
                        UploadFile.tenant_id == tenant_id,
                        UploadFile.created_by_role == CreatorUserRole.END_USER,
                        UploadFile.created_by == end_user_id,
                    )
                    .limit(1)
                )
                if upload_file is None:
                    return None
                return ResolvedFile(
                    id=upload_file.id,
                    kind=FileKind.UPLOAD,
                    name=upload_file.name,
                    size=upload_file.size,
                    extension=upload_file.extension,
                    mime_type=upload_file.mime_type,
                )
            case FileKind.TOOL:
                tool_file = session.scalar(
                    select(ToolFile)
                    .where(
                        ToolFile.id == ref.id,
                        ToolFile.tenant_id == tenant_id,
                        ToolFile.user_id == end_user_id,
                    )
                    .limit(1)
                )
                if tool_file is None:
                    return None
                return ResolvedFile(
                    id=tool_file.id,
                    kind=FileKind.TOOL,
                    name=tool_file.name,
                    size=tool_file.size,
                    extension=_extension_of(tool_file.name),
                    mime_type=tool_file.mimetype,
                )


def _extension_of(filename: str | None) -> str:
    """Normalize a filename suffix to the dotless lowercase ``upload_files`` form."""

    if not filename:
        return ""
    return os.path.splitext(filename)[1].lstrip(".").lower()


__all__ = [
    "AppNotFoundError",
    "EndUserNotFoundError",
    "FileContent",
    "FileGrantService",
    "FileRef",
    "ResolvedFile",
]
