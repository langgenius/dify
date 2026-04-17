"""
Integration tests for Account and Tenant model methods that interact with the database.

Migrated from unit_tests/models/test_account_models.py, replacing
@patch("models.account.db") mock patches with real PostgreSQL operations.

Covers:
- Account.current_tenant setter (sets _current_tenant and role from TenantAccountJoin)
- Account.set_tenant_id (resolves tenant + role from real join row)
- Account.get_by_openid (AccountIntegrate lookup then Account fetch)
- Tenant.get_accounts (returns accounts linked via TenantAccountJoin)
"""

from collections.abc import Generator
from uuid import uuid4

import pytest
from sqlalchemy import delete
from sqlalchemy.orm import Session

from models.account import Account, AccountIntegrate, Tenant, TenantAccountJoin, TenantAccountRole


def _cleanup_tracked_rows(db_session: Session, tracked: list) -> None:
    """Delete rows tracked during the test so committed state does not leak into the DB.

    Rolls back any pending (uncommitted) session state first, then issues DELETE
    statements by primary key for each tracked entity (in reverse creation order)
    and commits. This cleans up rows created via either flush() or commit().
    """
    db_session.rollback()
    for entity in reversed(tracked):
        db_session.execute(delete(type(entity)).where(type(entity).id == entity.id))
    db_session.commit()


def _build_tenant() -> Tenant:
    return Tenant(name=f"Tenant {uuid4()}")


def _build_account(email_prefix: str = "account") -> Account:
    return Account(
        name=f"Account {uuid4()}",
        email=f"{email_prefix}_{uuid4()}@example.com",
        password="hashed-password",
        password_salt="salt",
        interface_language="en-US",
        timezone="UTC",
    )


class _DBTrackingTestBase:
    """Base class providing a tracker list and shared row factories for account/tenant tests."""

    _tracked: list

    @pytest.fixture(autouse=True)
    def _setup_cleanup(self, db_session_with_containers: Session) -> Generator[None, None, None]:
        self._tracked = []
        yield
        _cleanup_tracked_rows(db_session_with_containers, self._tracked)

    def _create_tenant(self, db_session: Session) -> Tenant:
        tenant = _build_tenant()
        db_session.add(tenant)
        db_session.flush()
        self._tracked.append(tenant)
        return tenant

    def _create_account(self, db_session: Session, email_prefix: str = "account") -> Account:
        account = _build_account(email_prefix)
        db_session.add(account)
        db_session.flush()
        self._tracked.append(account)
        return account

    def _create_join(
        self, db_session: Session, tenant_id: str, account_id: str, role: TenantAccountRole, current: bool = True
    ) -> TenantAccountJoin:
        join = TenantAccountJoin(tenant_id=tenant_id, account_id=account_id, role=role, current=current)
        db_session.add(join)
        db_session.flush()
        self._tracked.append(join)
        return join


class TestAccountCurrentTenantSetter(_DBTrackingTestBase):
    """Integration tests for Account.current_tenant property setter."""

    def test_current_tenant_property_returns_cached_tenant(self, db_session_with_containers: Session) -> None:
        """current_tenant getter returns the in-memory _current_tenant without DB access."""
        account = self._create_account(db_session_with_containers)
        tenant = self._create_tenant(db_session_with_containers)
        account._current_tenant = tenant

        assert account.current_tenant is tenant

    def test_current_tenant_setter_sets_tenant_and_role_when_join_exists(
        self, db_session_with_containers: Session
    ) -> None:
        """Setting current_tenant loads the join row and assigns role when relationship exists."""
        tenant = self._create_tenant(db_session_with_containers)
        account = self._create_account(db_session_with_containers)
        self._create_join(db_session_with_containers, tenant.id, account.id, TenantAccountRole.OWNER)
        db_session_with_containers.commit()

        account.current_tenant = tenant

        assert account._current_tenant is not None
        assert account._current_tenant.id == tenant.id
        assert account.role == TenantAccountRole.OWNER

    def test_current_tenant_setter_sets_none_when_no_join_exists(self, db_session_with_containers: Session) -> None:
        """Setting current_tenant results in _current_tenant=None when no join row exists."""
        tenant = self._create_tenant(db_session_with_containers)
        account = self._create_account(db_session_with_containers)
        db_session_with_containers.commit()

        account.current_tenant = tenant

        assert account._current_tenant is None


class TestAccountSetTenantId(_DBTrackingTestBase):
    """Integration tests for Account.set_tenant_id method."""

    def test_set_tenant_id_sets_tenant_and_role_when_relationship_exists(
        self, db_session_with_containers: Session
    ) -> None:
        """set_tenant_id loads the tenant and assigns role when a join row exists."""
        tenant = self._create_tenant(db_session_with_containers)
        account = self._create_account(db_session_with_containers)
        self._create_join(db_session_with_containers, tenant.id, account.id, TenantAccountRole.ADMIN)
        db_session_with_containers.commit()

        account.set_tenant_id(tenant.id)

        assert account._current_tenant is not None
        assert account._current_tenant.id == tenant.id
        assert account.role == TenantAccountRole.ADMIN

    def test_set_tenant_id_does_not_set_tenant_when_no_relationship_exists(
        self, db_session_with_containers: Session
    ) -> None:
        """set_tenant_id does nothing when no join row matches the tenant."""
        tenant = self._create_tenant(db_session_with_containers)
        account = self._create_account(db_session_with_containers)
        db_session_with_containers.commit()

        account.set_tenant_id(tenant.id)

        assert account._current_tenant is None


class TestAccountGetByOpenId(_DBTrackingTestBase):
    """Integration tests for Account.get_by_openid class method."""

    def test_get_by_openid_returns_account_when_integrate_exists(self, db_session_with_containers: Session) -> None:
        """get_by_openid returns the Account when a matching AccountIntegrate row exists."""
        account = self._create_account(db_session_with_containers, email_prefix="openid")
        provider = "google"
        open_id = f"google_{uuid4()}"

        integrate = AccountIntegrate(
            account_id=account.id,
            provider=provider,
            open_id=open_id,
            encrypted_token="token",
        )
        db_session_with_containers.add(integrate)
        db_session_with_containers.flush()
        self._tracked.append(integrate)

        result = Account.get_by_openid(provider, open_id)

        assert result is not None
        assert result.id == account.id

    def test_get_by_openid_returns_none_when_no_integrate_exists(self, db_session_with_containers: Session) -> None:
        """get_by_openid returns None when no AccountIntegrate row matches."""
        result = Account.get_by_openid("github", f"github_{uuid4()}")

        assert result is None


class TestTenantGetAccounts(_DBTrackingTestBase):
    """Integration tests for Tenant.get_accounts method."""

    def test_get_accounts_returns_linked_accounts(self, db_session_with_containers: Session) -> None:
        """get_accounts returns all accounts linked to the tenant via TenantAccountJoin."""
        tenant = self._create_tenant(db_session_with_containers)
        account1 = self._create_account(db_session_with_containers, email_prefix="tenant_member")
        account2 = self._create_account(db_session_with_containers, email_prefix="tenant_member")
        self._create_join(db_session_with_containers, tenant.id, account1.id, TenantAccountRole.OWNER, current=False)
        self._create_join(db_session_with_containers, tenant.id, account2.id, TenantAccountRole.NORMAL, current=False)

        accounts = tenant.get_accounts()

        assert len(accounts) == 2
        account_ids = {a.id for a in accounts}
        assert account1.id in account_ids
        assert account2.id in account_ids
