"""Persistence tests for installation setup and tenant-existence state."""

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from models.account import Account, Tenant, TenantAccountJoin, TenantAccountRole
from models.model import DifySetup
from repositories.installation_state_repository import InstallationStateRepository


def test_empty_database_has_no_installation_state(sqlite_session_factory: sessionmaker[Session]) -> None:
    repository = InstallationStateRepository(session_factory=sqlite_session_factory)

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
    repository = InstallationStateRepository(session_factory=sqlite_session_factory)

    assert repository.get_setup_at() == setup.setup_at
    assert repository.is_setup() is True


def test_has_tenants_detects_existing_tenant(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    sqlite_session.add(Tenant(name="Existing workspace"))
    sqlite_session.commit()
    repository = InstallationStateRepository(session_factory=sqlite_session_factory)

    assert repository.has_tenants() is True


def test_reset_setup_removes_only_the_created_account_workspace_aggregate(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    created_account = Account(name="Created", email="created@example.com")
    created_account.id = "created-account"
    created_workspace = Tenant(name="Created")
    created_workspace.id = "created-workspace"
    existing_account = Account(name="Existing", email="existing@example.com")
    existing_account.id = "existing-account"
    existing_workspace = Tenant(name="Existing")
    existing_workspace.id = "existing-workspace"
    sqlite_session.add_all(
        [
            DifySetup(version="existing-setup"),
            created_account,
            created_workspace,
            existing_account,
            existing_workspace,
            TenantAccountJoin(
                tenant_id=created_workspace.id,
                account_id=created_account.id,
                role=TenantAccountRole.OWNER,
            ),
            TenantAccountJoin(
                tenant_id=existing_workspace.id,
                account_id=existing_account.id,
                role=TenantAccountRole.OWNER,
            ),
        ]
    )
    sqlite_session.commit()
    repository = InstallationStateRepository(session_factory=sqlite_session_factory)
    created_account_id = created_account.id
    created_workspace_id = created_workspace.id
    existing_account_id = existing_account.id
    existing_workspace_id = existing_workspace.id

    repository.reset_setup(
        attempt_id="failed-attempt",
        account_id=created_account_id,
        workspace_id=created_workspace_id,
    )

    sqlite_session.expire_all()
    assert sqlite_session.get(Account, created_account_id) is None
    assert sqlite_session.get(Tenant, created_workspace_id) is None
    assert sqlite_session.get(Account, existing_account_id) is not None
    assert sqlite_session.get(Tenant, existing_workspace_id) is not None
    assert sqlite_session.scalar(select(DifySetup.version)) == "existing-setup"


def test_reset_setup_restores_retryable_uninstalled_state(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    account = Account(name="Created", email="created@example.com")
    workspace = Tenant(name="Created")
    sqlite_session.add_all(
        [
            account,
            workspace,
            TenantAccountJoin(
                tenant_id=workspace.id,
                account_id=account.id,
                role=TenantAccountRole.OWNER,
            ),
        ]
    )
    sqlite_session.commit()
    repository = InstallationStateRepository(session_factory=sqlite_session_factory)
    account_id = account.id
    workspace_id = workspace.id

    repository.reset_setup(attempt_id="failed-attempt", account_id=account_id, workspace_id=workspace_id)

    assert repository.get_setup_at() is None
    assert repository.has_tenants() is False
    sqlite_session.expire_all()
    assert sqlite_session.get(Account, account_id) is None


def test_reset_setup_uses_attempt_identity_and_recovers_unknown_workspace_id(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    account = Account(name="Created", email="created@example.com")
    workspace = Tenant(name="Created")
    sqlite_session.add_all(
        [
            DifySetup(version="failed-version", instance_id="failed-attempt"),
            account,
            workspace,
            TenantAccountJoin(
                tenant_id=workspace.id,
                account_id=account.id,
                role=TenantAccountRole.OWNER,
            ),
        ]
    )
    sqlite_session.commit()
    repository = InstallationStateRepository(session_factory=sqlite_session_factory)
    account_id = account.id
    workspace_id = workspace.id

    repository.reset_setup(attempt_id="failed-attempt", account_id=account_id, workspace_id=None)

    sqlite_session.expire_all()
    assert sqlite_session.get(Account, account_id) is None
    assert sqlite_session.get(Tenant, workspace_id) is None
    assert sqlite_session.scalar(select(DifySetup.version)) is None
