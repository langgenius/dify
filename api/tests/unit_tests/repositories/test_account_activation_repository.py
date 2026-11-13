from typing import cast

import pytest
from sqlalchemy import event, select
from sqlalchemy.dialects import postgresql
from sqlalchemy.orm import ORMExecuteState, Session, sessionmaker
from sqlalchemy.sql.elements import ClauseElement

from models.account import Account, AccountStatus, Tenant, TenantAccountJoin, TenantAccountRole, TenantStatus
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
    @pytest.mark.parametrize("invalidated", ["workspace", "email"])
    def test_revalidates_invitation_state_before_creating_membership(
        self,
        sqlite_session_factory: sessionmaker[Session],
        invalidated: str,
    ) -> None:
        """An invitation invalidated after lookup must not initialize an account or create membership."""
        with sqlite_session_factory() as session:
            _persist_invitation_state(session)
        repository = SQLAlchemyAccountActivationRepository(sqlite_session_factory)
        invitation = repository.resolve(
            InvitationToken(account_id="account-1", email="invitee@example.com", workspace_id="workspace-1")
        )
        assert invitation is not None
        with sqlite_session_factory.begin() as session:
            if invalidated == "workspace":
                tenant = session.get(Tenant, "workspace-1")
                assert tenant is not None
                tenant.status = TenantStatus.ARCHIVE
            else:
                account = session.get(Account, "account-1")
                assert account is not None
                account.email = "changed@example.com"

        result = repository.activate(
            invitation,
            role="admin",
            setup=AccountSetup(name="Accepted", interface_language="en-US", timezone="UTC"),
        )

        assert result is None
        with sqlite_session_factory() as session:
            assert session.scalars(select(TenantAccountJoin)).all() == []
            account = session.get(Account, "account-1")
            assert account is not None
            assert (account.name, account.status, account.initialized_at) == ("Invited", AccountStatus.PENDING, None)

    def test_failed_activation_rolls_back_setup_and_workspace_switch_then_retries(
        self,
        sqlite_session_factory: sessionmaker[Session],
    ) -> None:
        """A failed commit preserves setup and memberships; retry changes only the invited account."""
        with sqlite_session_factory() as session:
            _persist_invitation_state(session)
        with sqlite_session_factory.begin() as session:
            previous_workspace = Tenant(name="Previous workspace")
            previous_workspace.id = "workspace-2"
            other_account = Account(name="Other", email="other@example.com", status=AccountStatus.ACTIVE)
            other_account.id = "account-2"
            session.add_all(
                [
                    previous_workspace,
                    other_account,
                    TenantAccountJoin(
                        tenant_id="workspace-2", account_id="account-1", role=TenantAccountRole.NORMAL, current=True
                    ),
                    TenantAccountJoin(
                        tenant_id="workspace-2", account_id="account-2", role=TenantAccountRole.NORMAL, current=True
                    ),
                ]
            )
        repository = SQLAlchemyAccountActivationRepository(sqlite_session_factory)
        setup = AccountSetup(name="Accepted", interface_language="en-US", timezone="UTC")

        def reject_commit(session: Session) -> None:
            """Flush real pending writes, then fail before they can commit."""
            session.flush()
            raise RuntimeError("activation commit failed")

        event.listen(sqlite_session_factory.class_, "before_commit", reject_commit)
        try:
            with pytest.raises(RuntimeError, match="activation commit failed"):
                repository.activate(_invitation(), role="admin", setup=setup)
        finally:
            event.remove(sqlite_session_factory.class_, "before_commit", reject_commit)

        with sqlite_session_factory() as session:
            account = session.get(Account, "account-1")
            assert account is not None
            assert (account.name, account.status, account.initialized_at) == ("Invited", AccountStatus.PENDING, None)
            memberships = session.scalars(select(TenantAccountJoin).order_by(TenantAccountJoin.account_id)).all()
            assert [(row.account_id, row.tenant_id, row.current) for row in memberships] == [
                ("account-1", "workspace-2", True),
                ("account-2", "workspace-2", True),
            ]

        first = repository.activate(_invitation(), role="admin", setup=setup)
        repeated = repository.activate(_invitation(), role="normal", setup=None)

        assert first is not None
        assert first.membership_created is True
        assert repeated is not None
        assert repeated.membership_created is False
        with sqlite_session_factory() as session:
            account = session.get(Account, "account-1")
            assert account is not None
            assert (account.name, account.status) == ("Accepted", AccountStatus.ACTIVE)
            assert account.initialized_at is not None
            memberships = session.scalars(
                select(TenantAccountJoin).order_by(TenantAccountJoin.account_id, TenantAccountJoin.tenant_id)
            ).all()
            assert [(row.account_id, row.tenant_id, row.role, row.current) for row in memberships] == [
                ("account-1", "workspace-1", TenantAccountRole.ADMIN, True),
                ("account-1", "workspace-2", TenantAccountRole.NORMAL, False),
                ("account-2", "workspace-2", TenantAccountRole.NORMAL, True),
            ]

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

    def test_does_not_create_membership_when_creation_is_disallowed(
        self,
        sqlite_session: Session,
        sqlite_session_factory: sessionmaker[Session],
    ) -> None:
        account, _ = _persist_invitation_state(sqlite_session)
        repository = SQLAlchemyAccountActivationRepository(sqlite_session_factory)

        result = repository.activate(
            _invitation(),
            role="admin",
            setup=AccountSetup(name="Name", interface_language="en-US", timezone="UTC"),
            create_membership=False,
        )

        assert result is None
        sqlite_session.expire_all()
        assert sqlite_session.scalar(select(TenantAccountJoin)) is None
        reloaded = sqlite_session.get(Account, account.id)
        assert reloaded is not None
        assert reloaded.status == AccountStatus.PENDING

    def test_keeps_existing_membership_when_creation_is_disallowed(
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

        result = repository.activate(_invitation(), role="admin", setup=None, create_membership=False)

        assert result is not None
        assert result.membership_created is False
        sqlite_session.expire_all()
        membership = sqlite_session.scalar(select(TenantAccountJoin))
        assert membership is not None
        assert membership.role == TenantAccountRole.EDITOR
        assert membership.current is True
