from sqlalchemy.orm import Session, sessionmaker

from models.account import Tenant
from models.model import DifySetup
from repositories.setup_repository import SetupRepository


def test_empty_database_has_no_setup_or_tenants(sqlite_session_factory: sessionmaker[Session]) -> None:
    repository = SetupRepository(client=sqlite_session_factory)

    assert repository.get_setup_at() is None
    assert repository.has_tenants() is False


def test_get_setup_at_returns_persisted_timestamp(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    setup = DifySetup(version="test-version")
    sqlite_session.add(setup)
    sqlite_session.commit()
    sqlite_session.refresh(setup)
    repository = SetupRepository(client=sqlite_session_factory)

    assert repository.get_setup_at() == setup.setup_at


def test_has_tenants_detects_existing_tenant(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    sqlite_session.add(Tenant(name="Existing workspace"))
    sqlite_session.commit()
    repository = SetupRepository(client=sqlite_session_factory)

    assert repository.has_tenants() is True
