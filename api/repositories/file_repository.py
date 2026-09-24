"""Persist and query file metadata without storage, signing or extraction I/O."""

import json
from collections.abc import Sequence
from typing import cast, override

from sqlalchemy import Row, Select, delete, select
from sqlalchemy.orm import Session, sessionmaker

from core.file.uploads import FileUploadData, FileUploadResult
from extensions.storage.storage_type import StorageType
from models.account import Tenant, TenantCustomConfigDict
from models.model import UploadFile
from services.file_service import FileRepository
from services.file_upload_service import FileUploadRepository
from services.upload_file_delivery_service import (
    UploadFileDeliveryNotFoundError,
    UploadFileDeliveryQuery,
    UploadFileDeliveryRecord,
)


class SQLAlchemyFileRepository(FileRepository, FileUploadRepository, UploadFileDeliveryQuery):
    def __init__(self, *, session_factory: sessionmaker[Session]) -> None:
        self._session_factory: sessionmaker[Session] = session_factory

    @override
    def create(self, *, upload: FileUploadData) -> FileUploadResult:
        upload_file = UploadFile(
            tenant_id=upload.tenant_id,
            storage_type=StorageType(upload.storage_type),
            key=upload.key,
            name=upload.name,
            size=upload.size,
            extension=upload.extension,
            mime_type=upload.mime_type,
            created_by_role=upload.created_by_role,
            created_by=upload.created_by,
            created_at=upload.created_at,
            used=upload.used,
            used_by=upload.used_by,
            used_at=upload.used_at,
            hash=upload.hash,
            source_url=upload.source_url,
        )
        with self._session_factory(expire_on_commit=False) as session:
            session.add(upload_file)
            session.commit()

            return _to_result(upload_file)

    @override
    def get(self, *, file_id: str, tenant_id: str | None = None) -> FileUploadResult | None:
        statement = select(UploadFile).where(UploadFile.id == file_id)
        if tenant_id is not None:
            statement = statement.where(UploadFile.tenant_id == tenant_id)
        with self._session_factory() as session:
            upload_file = session.scalar(statement.limit(1))
            return _to_result(upload_file) if upload_file is not None else None

    @override
    def delete(self, *, file: FileUploadResult) -> None:
        with self._session_factory.begin() as session:
            session.execute(
                delete(UploadFile).where(
                    UploadFile.id == file.id,
                    UploadFile.tenant_id == file.tenant_id,
                    UploadFile.key == file.key,
                )
            )

    @staticmethod
    def get_upload_files_by_ids(
        tenant_id: str, upload_file_ids: Sequence[str], *, session: Session
    ) -> dict[str, UploadFile]:
        """Query within an existing document transaction without committing or closing it."""
        if not upload_file_ids:
            return {}
        unique_ids = list({str(file_id) for file_id in upload_file_ids})
        files = session.scalars(
            select(UploadFile).where(UploadFile.tenant_id == tenant_id, UploadFile.id.in_(unique_ids))
        ).all()
        return {str(file.id): file for file in files}

    @override
    def get_by_id(self, *, file_id: str) -> UploadFileDeliveryRecord | None:
        with self._session_factory() as session:
            row = session.execute(self._file_query().where(UploadFile.id == file_id).limit(1)).one_or_none()

        return self._to_record(row)

    @override
    def get_workspace_logo(self, *, workspace_id: str) -> UploadFileDeliveryRecord | None:
        with self._session_factory() as session:
            workspace_row = session.execute(
                select(Tenant.custom_config).where(Tenant.id == workspace_id).limit(1)
            ).one_or_none()
            if workspace_row is None:
                raise UploadFileDeliveryNotFoundError

            custom_config = (
                cast(TenantCustomConfigDict, json.loads(workspace_row.custom_config))
                if workspace_row.custom_config
                else {}
            )
            logo_file_id = custom_config.get("replace_webapp_logo")
            if not logo_file_id:
                raise UploadFileDeliveryNotFoundError("webapp logo is not found")

            file_row = session.execute(
                self._file_query()
                .where(
                    UploadFile.id == logo_file_id,
                    UploadFile.tenant_id == workspace_id,
                )
                .limit(1)
            ).one_or_none()

        return self._to_record(file_row)

    @staticmethod
    def _file_query() -> Select[tuple[str, str, int, str, str | None]]:
        return select(
            UploadFile.key,
            UploadFile.name,
            UploadFile.size,
            UploadFile.extension,
            UploadFile.mime_type,
        )

    @staticmethod
    def _to_record(row: Row[tuple[str, str, int, str, str | None]] | None) -> UploadFileDeliveryRecord | None:
        if row is None:
            return None
        return UploadFileDeliveryRecord(
            key=row.key,
            name=row.name,
            size=row.size,
            extension=row.extension,
            mime_type=row.mime_type,
        )


def _to_result(upload_file: UploadFile) -> FileUploadResult:
    return FileUploadResult(
        id=upload_file.id,
        name=upload_file.name,
        size=upload_file.size,
        extension=upload_file.extension,
        mime_type=upload_file.mime_type,
        created_by=upload_file.created_by,
        created_at=upload_file.created_at,
        tenant_id=upload_file.tenant_id,
        source_url=upload_file.source_url,
        key=upload_file.key,
        storage_type=upload_file.storage_type.value,
        created_by_role=upload_file.created_by_role,
        hash=upload_file.hash,
        used=upload_file.used,
        used_by=upload_file.used_by,
        used_at=upload_file.used_at,
    )
