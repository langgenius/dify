"""Database state required by the initialization validation use case."""

from typing import override

from sqlalchemy import exists, select
from sqlalchemy.orm import Session, sessionmaker

from models.account import Tenant
from models.model import DifySetup
from services.init_validation_service import InitValidationState


class InitValidationRepository(InitValidationState):
    def __init__(self, client: sessionmaker[Session]) -> None:
        self._client = client

    @override
    def has_tenants(self) -> bool:
        with self._client() as session:
            return session.scalar(select(exists().select_from(Tenant))) is True

    @override
    def is_setup(self) -> bool:
        with self._client() as session:
            return session.scalar(select(exists().select_from(DifySetup))) is True
