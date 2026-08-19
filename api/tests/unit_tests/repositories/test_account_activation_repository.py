from typing import cast

import pytest
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
        rbac_role_id="role-1",
        inviter_id="inviter-1",
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
                rbac_role_id="role-1",
                inviter_id="inviter-1",
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
        account, tenant = _persist_invitation_state(sqlite_session)
        sqlite_session.add(
            TenantAccountJoin(
                tenant_id=tenant.id,
                account_id=account.id,
                role=TenantAccountRole.ADMIN,
            )
        )
        sqlite_session.commit()
        repository = SQLAlchemyAccountActivationRepository(sqlite_session_factory)
        statements: list[ClauseElement] = []

        def capture_statement(execute_state: ORMExecuteState) -> None:
            statements.append(cast(ClauseElement, execute_state.statement))

        event.listen(sqlite_session_factory.class_, "do_orm_execute", capture_statement)
        try:
            result = repository.activate(_invitation(), setup=None, membership_role="admin")
        finally:
            event.remove(sqlite_session_factory.class_, "do_orm_execute", capture_statement)

        assert result is True
        account_selects = [
            str(statement.compile(dialect=postgresql.dialect()))
            for statement in statements
            if "FROM accounts" in str(statement.compile(dialect=postgresql.dialect()))
        ]
        assert len(account_selects) == 1
        assert "FOR UPDATE" in account_selects[0]

    def test_initializes_account_and_switches_preassigned_membership(
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
        sqlite_session.add(
            TenantAccountJoin(
                tenant_id="workspace-1",
                account_id=account.id,
                role=TenantAccountRole.ADMIN,
            )
        )
        sqlite_session.commit()
        repository = SQLAlchemyAccountActivationRepository(sqlite_session_factory)

        result = repository.activate(
            _invitation(),
            setup=AccountSetup(name="John Doe", interface_language="en-US", timezone="UTC"),
            membership_role="admin",
        )

        assert result is True
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

    def test_active_account_keeps_profile_and_existing_membership_role(
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

        result = repository.activate(
            _invitation(),
            setup=AccountSetup(name="Stale Name", interface_language="zh-Hans", timezone="Asia/Shanghai"),
            membership_role="admin",
        )

        assert result is True
        sqlite_session.expire_all()
        membership = sqlite_session.scalar(select(TenantAccountJoin))
        assert membership is not None
        assert membership.role == TenantAccountRole.EDITOR
        assert membership.current is True
        persisted_account = sqlite_session.get(Account, account.id)
        assert persisted_account is not None
        assert persisted_account.name == "Invited"
        assert persisted_account.interface_language is None
        assert persisted_account.timezone is None
        assert persisted_account.initialized_at is None

    @pytest.mark.parametrize(
        "account_status",
        [AccountStatus.BANNED, AccountStatus.CLOSED, AccountStatus.UNINITIALIZED],
    )
    def test_rejects_non_activatable_account_without_mutation(
        self,
        sqlite_session: Session,
        sqlite_session_factory: sessionmaker[Session],
        account_status: AccountStatus,
    ) -> None:
        account, tenant = _persist_invitation_state(sqlite_session)
        account.status = account_status
        sqlite_session.add(
            TenantAccountJoin(
                tenant_id=tenant.id,
                account_id=account.id,
                role=TenantAccountRole.EDITOR,
                current=False,
            )
        )
        sqlite_session.commit()
        repository = SQLAlchemyAccountActivationRepository(sqlite_session_factory)

        result = repository.activate(
            _invitation(),
            setup=AccountSetup(name="Stale Name", interface_language="zh-Hans", timezone="Asia/Shanghai"),
            membership_role="admin",
        )

        assert result is False
        sqlite_session.expire_all()
        persisted_account = sqlite_session.get(Account, account.id)
        assert persisted_account is not None
        assert persisted_account.status == account_status
        assert persisted_account.name == "Invited"
        assert persisted_account.interface_language is None
        assert persisted_account.timezone is None
        assert persisted_account.initialized_at is None
        membership = sqlite_session.scalar(select(TenantAccountJoin))
        assert membership is not None
        assert membership.current is False
        assert membership.last_opened_at is None

    def test_creates_membership_and_activation_atomically(
        self,
        sqlite_session: Session,
        sqlite_session_factory: sessionmaker[Session],
    ) -> None:
        account, _ = _persist_invitation_state(sqlite_session)
        repository = SQLAlchemyAccountActivationRepository(sqlite_session_factory)

        result = repository.activate(
            _invitation(),
            setup=AccountSetup(name="John Doe", interface_language="en-US", timezone="UTC"),
            membership_role="admin",
        )

        assert result is True
        sqlite_session.expire_all()
        membership = sqlite_session.scalar(select(TenantAccountJoin))
        assert membership is not None
        assert membership.role == TenantAccountRole.ADMIN
        assert membership.current is True
        persisted_account = sqlite_session.get(Account, account.id)
        assert persisted_account is not None
        assert persisted_account.status == AccountStatus.ACTIVE
        assert persisted_account.name == "John Doe"

    def test_rejects_stale_account_snapshot_without_creating_membership(
        self,
        sqlite_session: Session,
        sqlite_session_factory: sessionmaker[Session],
    ) -> None:
        account, _ = _persist_invitation_state(sqlite_session)
        account.email = "changed@example.com"
        sqlite_session.commit()
        repository = SQLAlchemyAccountActivationRepository(sqlite_session_factory)

        result = repository.activate(
            _invitation(),
            setup=AccountSetup(name="John Doe", interface_language="en-US", timezone="UTC"),
            membership_role="admin",
        )

        assert result is False
        assert sqlite_session.scalar(select(TenantAccountJoin)) is None
