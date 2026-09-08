"""Persistence queries for signed plugin file upload owners."""

from typing import override

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from models.account import TenantAccountJoin
from models.model import EndUser
from services.plugin_file_upload_service import PluginFileUploadOwnerQuery, PluginUploadUserFrom


class SQLAlchemyPluginFileUploadOwnerRepository(PluginFileUploadOwnerQuery):
    def __init__(self, *, session_factory: sessionmaker[Session]) -> None:
        self._session_factory = session_factory

    @override
    def owner_exists(
        self,
        *,
        tenant_id: str,
        user_id: str,
        user_from: PluginUploadUserFrom,
    ) -> bool:
        if user_from == "account":
            statement = (
                select(TenantAccountJoin.id)
                .where(
                    TenantAccountJoin.tenant_id == tenant_id,
                    TenantAccountJoin.account_id == user_id,
                )
                .limit(1)
            )
        else:
            statement = (
                select(EndUser.id)
                .where(
                    EndUser.tenant_id == tenant_id,
                    EndUser.id == user_id,
                )
                .limit(1)
            )

        with self._session_factory() as session:
            return session.scalar(statement) is not None
