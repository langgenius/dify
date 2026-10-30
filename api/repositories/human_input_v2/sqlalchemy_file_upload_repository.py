"""Caller-session queries for the original workflow or delivery-test creator."""

from sqlalchemy import select
from sqlalchemy.orm import Session

from models.account import Account, TenantAccountJoin
from models.enums import CreatorUserRole
from models.model import App, EndUser
from repositories.human_input_v2.file_upload_repository import FileUploadOwner, FileUploadRepository


class SQLAlchemyFileUploadRepository(FileUploadRepository):
    def __init__(self, session: Session) -> None:
        self._session = session

    def get_owner(
        self, *, tenant_id: str, app_id: str, owner_id: str, owner_role: CreatorUserRole
    ) -> FileUploadOwner | None:
        if owner_role == CreatorUserRole.END_USER:
            identity = self._session.scalar(
                select(EndUser.id).where(
                    EndUser.id == owner_id, EndUser.tenant_id == tenant_id, EndUser.app_id == app_id
                )
            )
        elif owner_role == CreatorUserRole.ACCOUNT:
            identity = self._session.scalar(
                select(Account.id)
                .join(TenantAccountJoin, TenantAccountJoin.account_id == Account.id)
                .where(Account.id == owner_id, TenantAccountJoin.tenant_id == tenant_id)
            )
        else:
            return None
        return FileUploadOwner(id=identity, creator_role=owner_role) if identity is not None else None

    def get_delivery_test_owner(self, *, tenant_id: str, app_id: str) -> FileUploadOwner | None:
        creator_id = self._session.scalar(select(App.created_by).where(App.id == app_id, App.tenant_id == tenant_id))
        if creator_id is None:
            return None
        return self.get_owner(
            tenant_id=tenant_id, app_id=app_id, owner_id=creator_id, owner_role=CreatorUserRole.ACCOUNT
        )
