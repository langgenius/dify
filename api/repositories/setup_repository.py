"""Database state required by the setup application service."""

from datetime import datetime
from typing import override

from sqlalchemy import exists, select
from sqlalchemy.orm import Session, sessionmaker

from models.account import Tenant
from models.model import DifySetup
from services.setup_service import SetupState


class SetupRepository(SetupState):
    def __init__(self, client: sessionmaker[Session]) -> None:
        self._client = client

    @override
    def get_setup_at(self) -> datetime | None:
        with self._client() as session:
            return session.scalar(select(DifySetup.setup_at).limit(1))

    @override
    def has_tenants(self) -> bool:
        with self._client() as session:
            return session.scalar(select(exists().select_from(Tenant))) is True
