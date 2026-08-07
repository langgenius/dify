"""Persistence tests for installation setup and tenant-existence state."""

from sqlalchemy.orm import Session, sessionmaker

from models.account import Tenant
from models.model import DifySetup
from repositories.installation_state_repository import InstallationStateRepository


def test_empty_database_has_no_installation_state(sqlite_session_factory: sessionmaker[Session]) -> None:
    repository = InstallationStateRepository(client=sqlite_session_factory)

    assert repository.get_setup_at() is None
    assert repository.is_setup() is False
    assert repository.has_tenants() is False


def test_get_setup_at_returns_persisted_timestamp(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    setup = DifySetup(version="test-version")
    sqlite_session.add(setup)
    sqlite_session.commit()
    sqlite_session.refresh(setup)
    repository = InstallationStateRepository(client=sqlite_session_factory)

    assert repository.get_setup_at() == setup.setup_at
    assert repository.is_setup() is True


def test_has_tenants_detects_existing_tenant(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    sqlite_session.add(Tenant(name="Existing workspace"))
    sqlite_session.commit()
    repository = InstallationStateRepository(client=sqlite_session_factory)

    assert repository.has_tenants() is True
