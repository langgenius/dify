"""SQLAlchemy query adapter for public UploadFile delivery endpoints."""

from typing import override
from uuid import UUID

from pydantic import TypeAdapter
from sqlalchemy import Row, Select, select
from sqlalchemy.orm import Session, sessionmaker

from models.account import Account, Tenant, TenantCustomConfigDict
from models.model import UploadFile
from repositories.account.avatar import owned_avatar_file_conditions
from services.upload_file_delivery_service import (
    UploadFileDeliveryNotFoundError,
    UploadFileDeliveryQuery,
    UploadFileDeliveryRecord,
)

_TENANT_CUSTOM_CONFIG_ADAPTER = TypeAdapter(TenantCustomConfigDict)

type _FileColumns = tuple[str, str, int, str, str | None]
type _AvatarColumns = tuple[*_FileColumns, str | None]


class UploadFileDeliveryQueryRepository(UploadFileDeliveryQuery):
    def __init__(self, *, session_factory: sessionmaker[Session]) -> None:
        self._session_factory = session_factory

    @override
    def get_by_id(self, *, file_id: str) -> UploadFileDeliveryRecord | None:
        with self._session_factory() as session:
            row = session.execute(self._file_query().where(UploadFile.id == file_id).limit(1)).one_or_none()

        return self._to_record(row)

    @override
    def get_current_account_avatar(self, *, file_id: str, account_id: str) -> UploadFileDeliveryRecord | None:
        """Return an owned raster file only if it matches the account's normalized current avatar ID."""
        statement = (
            self._file_query()
            .join(Account, Account.id == UploadFile.created_by)
            .add_columns(Account.avatar)
            .where(*owned_avatar_file_conditions(file_id=file_id, account_id=account_id, allow_legacy=True))
        )
        with self._session_factory() as session:
            row = session.execute(statement).one_or_none()

        if row is None or row.avatar is None:
            return None
        try:
            current_avatar_id = str(UUID(row.avatar))
        except ValueError:
            return None
        return self._to_record(row) if current_avatar_id == file_id else None

    @override
    def get_workspace_logo(self, *, workspace_id: str) -> UploadFileDeliveryRecord | None:
        with self._session_factory() as session:
            workspace_row = session.execute(
                select(Tenant.custom_config).where(Tenant.id == workspace_id).limit(1)
            ).one_or_none()
            if workspace_row is None:
                raise UploadFileDeliveryNotFoundError

            custom_config = (
                _TENANT_CUSTOM_CONFIG_ADAPTER.validate_json(workspace_row.custom_config)
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
    def _file_query() -> Select[_FileColumns]:
        return select(
            UploadFile.key,
            UploadFile.name,
            UploadFile.size,
            UploadFile.extension,
            UploadFile.mime_type,
        )

    @staticmethod
    def _to_record(row: Row[_FileColumns] | Row[_AvatarColumns] | None) -> UploadFileDeliveryRecord | None:
        if row is None:
            return None
        return UploadFileDeliveryRecord(
            key=row.key,
            name=row.name,
            size=row.size,
            extension=row.extension,
            mime_type=row.mime_type,
        )
