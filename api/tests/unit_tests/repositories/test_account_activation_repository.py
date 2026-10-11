from typing import cast

from sqlalchemy import event, select
from sqlalchemy.dialects import postgresql
from sqlalchemy.orm import ORMExecuteState, Session, sessionmaker
from sqlalchemy.sql.elements import ClauseElement

from models.account import Account, AccountStatus, Tenant, TenantAccountJoin, TenantAccountRole
from repositories.account_activation_repository import SQLAlchemyAccountActivationRepository
from services.entities.account_activation_entities import AccountInvitation, AccountSetup, InvitationToken


def _persist_invitation_state(session: Session) -> tuple[Account, Tenant]:
    account = Account(name="Invited", email="invitee@example.com", status=AccountStatus.PENDING)
    account.id = "account-1"
    tenant = Tenant(name="Workspace")
    tenant.id = "workspace-1"
    session.add_all([account, tenant])
    session.commit()
    return account, tenant


def _invitation() -> AccountInvitation:
    return AccountInvitation(
        account_id="account-1",
        account_email="invitee@example.com",
        account_status="pending",
        workspace_id="workspace-1",
        workspace_name="Workspace",
        role="admin",
        requires_setup=True,
    )


class TestResolveInvitation:
    def test_returns_framework_neutral_record(
        self,
        sqlite_session: Session,
        sqlite_session_factory: sessionmaker[Session],
    ) -> None:
        _persist_invitation_state(sqlite_session)
        repository = SQLAlchemyAccountActivationRepository(sqlite_session_factory)

        result = repository.resolve(
            InvitationToken(
                account_id="account-1",
                email="invitee@example.com",
                workspace_id="workspace-1",
                role="admin",
                requires_setup=True,
            )
        )

        assert result == _invitation()

    def test_rejects_token_for_different_account(
        self,
        sqlite_session: Session,
        sqlite_session_factory: sessionmaker[Session],
    ) -> None:
        _persist_invitation_state(sqlite_session)
        repository = SQLAlchemyAccountActivationRepository(sqlite_session_factory)

        result = repository.resolve(
            InvitationToken(
                account_id="different-account",
                email="invitee@example.com",
                workspace_id="workspace-1",
            )
        )

        assert result is None


class TestPersistActivation:
    def test_locks_account_while_switching_current_workspace(
        self,
        sqlite_session: Session,
        sqlite_session_factory: sessionmaker[Session],
    ) -> None:
        _persist_invitation_state(sqlite_session)
        repository = SQLAlchemyAccountActivationRepository(sqlite_session_factory)
        statements: list[ClauseElement] = []

        def capture_statement(execute_state: ORMExecuteState) -> None:
            statements.append(cast(ClauseElement, execute_state.statement))

        event.listen(sqlite_session_factory.class_, "do_orm_execute", capture_statement)
        try:
            result = repository.activate(_invitation(), role="admin", setup=None)
        finally:
            event.remove(sqlite_session_factory.class_, "do_orm_execute", capture_statement)

        assert result is not None
        account_selects = [
            str(statement.compile(dialect=postgresql.dialect()))
            for statement in statements
            if "FROM accounts" in str(statement.compile(dialect=postgresql.dialect()))
        ]
        assert len(account_selects) == 1
        assert "FOR UPDATE" in account_selects[0]

    def test_creates_membership_initializes_account_and_switches_workspace(
        self,
        sqlite_session: Session,
        sqlite_session_factory: sessionmaker[Session],
    ) -> None:
        account, _ = _persist_invitation_state(sqlite_session)
        other_tenant = Tenant(name="Other Workspace")
        other_tenant.id = "workspace-2"
        sqlite_session.add(other_tenant)
        sqlite_session.flush()
        sqlite_session.add(
            TenantAccountJoin(
                tenant_id=other_tenant.id,
                account_id=account.id,
                role=TenantAccountRole.NORMAL,
                current=True,
            )
        )
        sqlite_session.commit()
        repository = SQLAlchemyAccountActivationRepository(sqlite_session_factory)

        result = repository.activate(
            _invitation(),
            role="admin",
            setup=AccountSetup(name="John Doe", interface_language="en-US", timezone="UTC"),
        )

        assert result is not None
        assert result.membership_created is True
        sqlite_session.expire_all()
        persisted_account = sqlite_session.get(Account, "account-1")
        assert persisted_account is not None
        assert persisted_account.name == "John Doe"
        assert persisted_account.interface_language == "en-US"
        assert persisted_account.timezone == "UTC"
        assert persisted_account.interface_theme == "light"
        assert persisted_account.status == AccountStatus.ACTIVE
        assert persisted_account.initialized_at is not None

        memberships = sqlite_session.scalars(
            select(TenantAccountJoin)
            .where(TenantAccountJoin.account_id == "account-1")
            .order_by(TenantAccountJoin.tenant_id)
        ).all()
        assert [(membership.tenant_id, membership.role, membership.current) for membership in memberships] == [
            ("workspace-1", TenantAccountRole.ADMIN, True),
            ("workspace-2", TenantAccountRole.NORMAL, False),
        ]
        assert memberships[0].last_opened_at is not None

    def test_keeps_existing_membership_role(
        self,
        sqlite_session: Session,
        sqlite_session_factory: sessionmaker[Session],
    ) -> None:
        account, tenant = _persist_invitation_state(sqlite_session)
        sqlite_session.add(
            TenantAccountJoin(
                tenant_id=tenant.id,
                account_id=account.id,
                role=TenantAccountRole.EDITOR,
            )
        )
        account.status = AccountStatus.ACTIVE
        sqlite_session.commit()
        repository = SQLAlchemyAccountActivationRepository(sqlite_session_factory)

        result = repository.activate(_invitation(), role="admin", setup=None)

        assert result is not None
        assert result.membership_created is False
        sqlite_session.expire_all()
        membership = sqlite_session.scalar(select(TenantAccountJoin))
        assert membership is not None
        assert membership.role == TenantAccountRole.EDITOR
        assert membership.current is True
