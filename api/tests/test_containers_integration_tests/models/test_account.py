"""
Integration tests for Account and Tenant model methods that interact with the database.

Migrated from unit_tests/models/test_account_models.py, replacing
@patch("models.account.db") mock patches with real PostgreSQL operations.
Also absorbs unit_tests/models/test_account.py role helper coverage.

Covers:
- Account.current_tenant setter (sets _current_tenant and role from TenantAccountJoin)
- Account.set_tenant_id (resolves tenant + role from real join row)
- Account.get_by_openid (AccountIntegrate lookup then Account fetch)
- Tenant.get_accounts (returns accounts linked via TenantAccountJoin)
"""

from typing import cast
from uuid import uuid4

import pytest
from sqlalchemy.orm import Session

from models.account import Account, AccountIntegrate, Tenant, TenantAccountJoin, TenantAccountRole


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


class _AccountTestBase:
    """Shared row factories for account and tenant model tests."""

    def _create_tenant(self, db_session: Session) -> Tenant:
        tenant = _build_tenant()
        db_session.add(tenant)
        db_session.flush()
        return tenant

    def _create_account(self, db_session: Session, email_prefix: str = "account") -> Account:
        account = _build_account(email_prefix)
        db_session.add(account)
        db_session.flush()
        return account

    def _create_join(
        self, db_session: Session, tenant_id: str, account_id: str, role: TenantAccountRole, current: bool = True
    ) -> TenantAccountJoin:
        join = TenantAccountJoin(tenant_id=tenant_id, account_id=account_id, role=role, current=current)
        db_session.add(join)
        db_session.flush()
        return join


class TestTenantAccountRole:
    """Tests for TenantAccountRole helper methods."""

    def test_account_is_privileged_role(self) -> None:
        assert TenantAccountRole.ADMIN == "admin"
        assert TenantAccountRole.OWNER == "owner"
        assert TenantAccountRole.EDITOR == "editor"
        assert TenantAccountRole.NORMAL == "normal"

        assert TenantAccountRole.is_privileged_role(TenantAccountRole.ADMIN)
        assert TenantAccountRole.is_privileged_role(TenantAccountRole.OWNER)
        assert not TenantAccountRole.is_privileged_role(TenantAccountRole.NORMAL)
        assert not TenantAccountRole.is_privileged_role(TenantAccountRole.EDITOR)
        assert not TenantAccountRole.is_privileged_role(cast(TenantAccountRole, ""))


class TestAccountCurrentTenantSetter(_AccountTestBase):
    """Integration tests for Account.current_tenant property setter."""

    def test_current_tenant_property_returns_cached_tenant(self, container_db_transaction: Session) -> None:
        """current_tenant getter returns the in-memory _current_tenant without DB access."""
        account = self._create_account(container_db_transaction)
        tenant = self._create_tenant(container_db_transaction)
        account._current_tenant = tenant

        assert account.current_tenant is tenant

    def test_current_tenant_setter_sets_tenant_and_role_when_join_exists(
        self, container_db_transaction: Session
    ) -> None:
        """Setting current_tenant loads the join row and assigns role when relationship exists."""
        tenant = self._create_tenant(container_db_transaction)
        account = self._create_account(container_db_transaction)
        self._create_join(container_db_transaction, tenant.id, account.id, TenantAccountRole.OWNER)
        container_db_transaction.commit()

        account.current_tenant = tenant

        assert account._current_tenant is not None
        assert account._current_tenant.id == tenant.id
        assert account.role == TenantAccountRole.OWNER

    def test_current_tenant_setter_sets_none_when_no_join_exists(self, container_db_transaction: Session) -> None:
        """Setting current_tenant results in _current_tenant=None when no join row exists."""
        tenant = self._create_tenant(container_db_transaction)
        account = self._create_account(container_db_transaction)
        container_db_transaction.commit()

        account.current_tenant = tenant

        assert account._current_tenant is None


class TestAccountSetTenantId(_AccountTestBase):
    """Integration tests for Account.set_tenant_id method."""

    def test_set_tenant_id_sets_tenant_and_role_when_relationship_exists(
        self, container_db_transaction: Session
    ) -> None:
        """set_tenant_id loads the tenant and assigns role when a join row exists."""
        tenant = self._create_tenant(container_db_transaction)
        account = self._create_account(container_db_transaction)
        self._create_join(container_db_transaction, tenant.id, account.id, TenantAccountRole.ADMIN)
        container_db_transaction.commit()

        account.set_tenant_id(tenant.id)

        assert account._current_tenant is not None
        assert account._current_tenant.id == tenant.id
        assert account.role == TenantAccountRole.ADMIN

    def test_set_tenant_id_does_not_set_tenant_when_no_relationship_exists(
        self, container_db_transaction: Session
    ) -> None:
        """set_tenant_id does nothing when no join row matches the tenant."""
        tenant = self._create_tenant(container_db_transaction)
        account = self._create_account(container_db_transaction)
        container_db_transaction.commit()

        account.set_tenant_id(tenant.id)

        assert account._current_tenant is None


class TestAccountGetByOpenId(_AccountTestBase):
    """Integration tests for Account.get_by_openid class method."""

    def test_get_by_openid_returns_account_when_integrate_exists(self, container_db_transaction: Session) -> None:
        """get_by_openid returns the Account when a matching AccountIntegrate row exists."""
        account = self._create_account(container_db_transaction, email_prefix="openid")
        provider = "google"
        open_id = f"google_{uuid4()}"

        integrate = AccountIntegrate(
            account_id=account.id,
            provider=provider,
            open_id=open_id,
            encrypted_token="token",
        )
        container_db_transaction.add(integrate)
        container_db_transaction.flush()

        result = Account.get_by_openid(provider, open_id)

        assert result is not None
        assert result.id == account.id

    @pytest.mark.usefixtures("container_db_transaction")
    def test_get_by_openid_returns_none_when_no_integrate_exists(self) -> None:
        """get_by_openid returns None when no AccountIntegrate row matches."""
        result = Account.get_by_openid("github", f"github_{uuid4()}")

        assert result is None


class TestTenantGetAccounts(_AccountTestBase):
    """Integration tests for Tenant.get_accounts method."""

    def test_get_accounts_returns_linked_accounts(self, container_db_transaction: Session) -> None:
        """get_accounts returns all accounts linked to the tenant via TenantAccountJoin."""
        tenant = self._create_tenant(container_db_transaction)
        account1 = self._create_account(container_db_transaction, email_prefix="tenant_member")
        account2 = self._create_account(container_db_transaction, email_prefix="tenant_member")
        self._create_join(container_db_transaction, tenant.id, account1.id, TenantAccountRole.OWNER, current=False)
        self._create_join(container_db_transaction, tenant.id, account2.id, TenantAccountRole.NORMAL, current=False)

        accounts = tenant.get_accounts(session=container_db_transaction)

        assert len(accounts) == 2
        account_ids = {a.id for a in accounts}
        assert account1.id in account_ids
        assert account2.id in account_ids
