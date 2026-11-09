"""Persistence adapter for installation setup and tenant-existence state."""

from datetime import datetime
from uuid import uuid4

from sqlalchemy import delete, exists, select
from sqlalchemy.orm import Session, sessionmaker

from configs import dify_config
from core.human_input_v2.shared import AccountId
from models.account import Account, Tenant, TenantAccountJoin
from models.model import DifySetup
from repositories.human_input_v2.sqlalchemy_contact_repository import SQLAlchemyContactRepository


class InstallationStateRepository:
    """Read persistent state shared by installation bootstrap use cases."""

    def __init__(self, session_factory: sessionmaker[Session]) -> None:
        self._session_factory = session_factory

    def get_setup_at(self) -> datetime | None:
        with self._session_factory() as session:
            return session.scalar(select(DifySetup.setup_at).limit(1))

    def is_setup(self) -> bool:
        return self.get_setup_at() is not None

    def has_tenants(self) -> bool:
        with self._session_factory() as session:
            return session.scalar(select(exists().select_from(Tenant))) is True

    def mark_setup(self) -> None:
        with self._session_factory.begin() as session:
            session.add(DifySetup(version=dify_config.project.version, instance_id=str(uuid4())))

    def reset_setup(self, account_id: str | None) -> None:
        with self._session_factory.begin() as session:
            for model in (DifySetup, TenantAccountJoin):
                session.execute(delete(model))
            if account_id is not None:
                SQLAlchemyContactRepository(session).delete_account_identity_after_failed_creation(
                    AccountId(account_id)
                )
            for model in (Account, Tenant):
                session.execute(delete(model))
