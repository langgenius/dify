"""Persistence adapter for installation setup and tenant-existence state."""

from datetime import datetime

from sqlalchemy import exists, select
from sqlalchemy.orm import Session, sessionmaker

from models.account import Tenant
from models.model import DifySetup


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
