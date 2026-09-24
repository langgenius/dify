"""SQLAlchemy query adapter for public UploadFile delivery endpoints."""

import json
from typing import cast, override

from sqlalchemy import Row, Select, select
from sqlalchemy.orm import Session, sessionmaker

from models.account import Tenant, TenantCustomConfigDict
from models.model import UploadFile
from services.upload_file_delivery_service import (
    UploadFileDeliveryNotFoundError,
    UploadFileDeliveryQuery,
    UploadFileDeliveryRecord,
)


class UploadFileDeliveryQueryRepository(UploadFileDeliveryQuery):
    def __init__(self, *, session_factory: sessionmaker[Session]) -> None:
        self._session_factory = session_factory

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
