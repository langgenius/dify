"""Persistence tests for initialization validation state."""

from sqlalchemy.orm import Session, sessionmaker

from models.account import Tenant
from models.model import DifySetup
from repositories.init_validation_repository import InitValidationRepository


def test_empty_database_is_not_initialized(sqlite_session_factory: sessionmaker[Session]) -> None:
    repository = InitValidationRepository(client=sqlite_session_factory)

    assert repository.has_tenants() is False
    assert repository.is_setup() is False


def test_detects_an_existing_tenant(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    sqlite_session.add(Tenant(name="Existing workspace"))
    sqlite_session.commit()
    repository = InitValidationRepository(client=sqlite_session_factory)

    assert repository.has_tenants() is True


def test_detects_an_existing_setup(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    sqlite_session.add(DifySetup(version="test-version"))
    sqlite_session.commit()
    repository = InitValidationRepository(client=sqlite_session_factory)

    assert repository.is_setup() is True
