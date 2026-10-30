"""Persistence and row-lock operations owned by the UploadFile aggregate."""

from __future__ import annotations

from collections.abc import Sequence

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from extensions.storage.storage_type import StorageType
from models.model import UploadFile
from services.entities.upload_file import UploadFileRecord
from services.errors.file import UploadFileReferenceNotFoundError


def _to_upload_file_record(file: UploadFile) -> UploadFileRecord:
    return UploadFileRecord(
        id=file.id,
        tenant_id=file.tenant_id,
        storage_type=file.storage_type.value,
        key=file.key,
        name=file.name,
        size=file.size,
        extension=file.extension,
        mime_type=file.mime_type,
        created_by_role=file.created_by_role,
        created_by=file.created_by,
        created_at=file.created_at,
        hash=file.hash,
        source_url=file.source_url,
        used=file.used,
        used_by=file.used_by,
        used_at=file.used_at,
    )


def lock_and_validate_owned_upload_files_in_session(
    session: Session,
    *,
    tenant_id: str,
    upload_file_ids: Sequence[str],
) -> dict[str, UploadFile]:
    """Take shared locks before a business owner attaches tenant files."""

    invalid_ids = {file_id for file_id in upload_file_ids if not file_id}
    if invalid_ids:
        raise UploadFileReferenceNotFoundError(invalid_ids)
    ids = tuple(sorted(set(upload_file_ids)))
    if not ids:
        return {}
    files = session.scalars(
        select(UploadFile)
        .where(UploadFile.tenant_id == tenant_id, UploadFile.id.in_(ids))
        .order_by(UploadFile.id)
        .with_for_update(read=True)
        .execution_options(populate_existing=True)
    ).all()
    files_by_id = {file.id: file for file in files}
    missing_ids = set(ids) - files_by_id.keys()
    if missing_ids:
        raise UploadFileReferenceNotFoundError(missing_ids)
    return files_by_id


def get_upload_files_in_session(
    session: Session, *, tenant_id: str, upload_file_ids: Sequence[str]
) -> dict[str, UploadFile]:
    """Load tenant-scoped rows for an owner transaction that updates file usage."""
    ids = tuple(dict.fromkeys(str(file_id) for file_id in upload_file_ids))
    if not ids:
        return {}
    files = session.scalars(select(UploadFile).where(UploadFile.tenant_id == tenant_id, UploadFile.id.in_(ids))).all()
    return {file.id: file for file in files}


class UploadFileRepository:
    """Short SQLAlchemy transactions used by the file application service."""

    def __init__(self, *, session_factory: sessionmaker[Session]) -> None:
        self._session_factory = session_factory

    def save_created_upload_file(self, *, file: UploadFileRecord) -> None:
        with self._session_factory.begin() as session:
            self.save_created_upload_file_in_session(session, file=file)

    def save_created_upload_file_in_session(
        self,
        session: Session,
        *,
        file: UploadFileRecord,
    ) -> None:
        """Stage a newly created upload in the caller-owned transaction."""
        if file.mime_type is None:
            raise ValueError("A newly uploaded file requires its MIME type")
        upload = UploadFile(
            tenant_id=file.tenant_id,
            storage_type=StorageType(file.storage_type),
            key=file.key,
            name=file.name,
            size=file.size,
            extension=file.extension,
            mime_type=file.mime_type,
            created_by_role=file.created_by_role,
            created_by=file.created_by,
            created_at=file.created_at,
            used=file.used,
            used_by=file.used_by,
            used_at=file.used_at,
            hash=file.hash,
            source_url=file.source_url,
        )
        upload.id = file.id
        session.add(upload)

    def get_file(self, *, tenant_id: str, file_id: str) -> UploadFileRecord | None:
        with self._session_factory() as session:
            file = session.scalar(
                select(UploadFile).where(UploadFile.tenant_id == tenant_id, UploadFile.id == file_id).limit(1)
            )
            return _to_upload_file_record(file) if file is not None else None

    @staticmethod
    def get_by_key_in_session(
        session: Session,
        *,
        tenant_id: str,
        key: str,
    ) -> UploadFileRecord | None:
        """Load a tenant-scoped upload by storage key in the caller's transaction."""
        file = session.scalar(
            select(UploadFile).where(UploadFile.tenant_id == tenant_id, UploadFile.key == key).limit(1)
        )
        return _to_upload_file_record(file) if file is not None else None

    def get_files(self, *, tenant_id: str, file_ids: Sequence[str]) -> dict[str, UploadFileRecord]:
        ids = tuple(dict.fromkeys(file_id for file_id in file_ids if file_id))
        if not ids:
            return {}
        with self._session_factory() as session:
            files = session.scalars(
                select(UploadFile).where(UploadFile.tenant_id == tenant_id, UploadFile.id.in_(ids))
            ).all()
            return {file.id: _to_upload_file_record(file) for file in files}

    def lock_reclamation_candidates_in_session(
        self,
        session: Session,
        *,
        tenant_id: str,
        file_ids: Sequence[str],
    ) -> tuple[UploadFile, ...]:
        ids = tuple(sorted({file_id for file_id in file_ids if file_id}))
        if not ids:
            return ()
        return tuple(
            session.scalars(
                select(UploadFile)
                .where(UploadFile.tenant_id == tenant_id, UploadFile.id.in_(ids))
                .order_by(UploadFile.id)
                .with_for_update()
                .execution_options(populate_existing=True)
            ).all()
        )

    @staticmethod
    def delete_in_session(session: Session, file: UploadFile) -> None:
        session.delete(file)
