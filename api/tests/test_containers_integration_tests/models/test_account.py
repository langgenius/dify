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
from sqlalchemy.orm import Session

from models.account import Account, AccountIntegrate, Tenant, TenantAccountJoin, TenantAccountRole


class TestAccountCurrentTenantSetter:
    """Integration tests for Account.current_tenant property setter."""

    @pytest.fixture(autouse=True)
    def _auto_rollback(self, db_session_with_containers: Session) -> Generator[None, None, None]:
        yield
        db_session_with_containers.rollback()

    def _create_tenant(self, db_session: Session) -> Tenant:
        tenant = Tenant(name=f"Tenant {uuid4()}")
        db_session.add(tenant)
        db_session.flush()
        return tenant

    def _create_account(self, db_session: Session) -> Account:
        account = Account(
            name=f"Account {uuid4()}",
            email=f"account_{uuid4()}@example.com",
            password="hashed-password",
            password_salt="salt",
            interface_language="en-US",
            timezone="UTC",
        )
        db_session.add(account)
        db_session.flush()
        return account

    def test_current_tenant_property_returns_cached_tenant(
        self, db_session_with_containers: Session
    ) -> None:
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
        db_session_with_containers.add(
            TenantAccountJoin(
                tenant_id=tenant.id,
                account_id=account.id,
                role=TenantAccountRole.OWNER,
                current=True,
            )
        )
        db_session_with_containers.commit()

        account.current_tenant = tenant

        assert account._current_tenant is not None
        assert account._current_tenant.id == tenant.id
        assert account.role == TenantAccountRole.OWNER

    def test_current_tenant_setter_sets_none_when_no_join_exists(
        self, db_session_with_containers: Session
    ) -> None:
        """Setting current_tenant results in _current_tenant=None when no join row exists."""
        tenant = self._create_tenant(db_session_with_containers)
        account = self._create_account(db_session_with_containers)
        db_session_with_containers.commit()

        account.current_tenant = tenant

        assert account._current_tenant is None


class TestAccountSetTenantId:
    """Integration tests for Account.set_tenant_id method."""

    @pytest.fixture(autouse=True)
    def _auto_rollback(self, db_session_with_containers: Session) -> Generator[None, None, None]:
        yield
        db_session_with_containers.rollback()

    def _create_tenant(self, db_session: Session) -> Tenant:
        tenant = Tenant(name=f"Tenant {uuid4()}")
        db_session.add(tenant)
        db_session.flush()
        return tenant

    def _create_account(self, db_session: Session) -> Account:
        account = Account(
            name=f"Account {uuid4()}",
            email=f"account_{uuid4()}@example.com",
            password="hashed-password",
            password_salt="salt",
            interface_language="en-US",
            timezone="UTC",
        )
        db_session.add(account)
        db_session.flush()
        return account

    def test_set_tenant_id_sets_tenant_and_role_when_relationship_exists(
        self, db_session_with_containers: Session
    ) -> None:
        """set_tenant_id loads the tenant and assigns role when a join row exists."""
        tenant = self._create_tenant(db_session_with_containers)
        account = self._create_account(db_session_with_containers)
        db_session_with_containers.add(
            TenantAccountJoin(
                tenant_id=tenant.id,
                account_id=account.id,
                role=TenantAccountRole.ADMIN,
                current=True,
            )
        )
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


class TestAccountGetByOpenId:
    """Integration tests for Account.get_by_openid class method."""

    @pytest.fixture(autouse=True)
    def _auto_rollback(self, db_session_with_containers: Session) -> Generator[None, None, None]:
        yield
        db_session_with_containers.rollback()

    def _create_account(self, db_session: Session) -> Account:
        account = Account(
            name=f"Account {uuid4()}",
            email=f"openid_{uuid4()}@example.com",
            password="hashed-password",
            password_salt="salt",
            interface_language="en-US",
            timezone="UTC",
        )
        db_session.add(account)
        db_session.flush()
        return account

    def test_get_by_openid_returns_account_when_integrate_exists(
        self, db_session_with_containers: Session
    ) -> None:
        """get_by_openid returns the Account when a matching AccountIntegrate row exists."""
        account = self._create_account(db_session_with_containers)
        provider = "google"
        open_id = f"google_{uuid4()}"

        db_session_with_containers.add(
            AccountIntegrate(
                account_id=account.id,
                provider=provider,
                open_id=open_id,
                encrypted_token="token",
            )
        )
        db_session_with_containers.flush()

        result = Account.get_by_openid(provider, open_id)

        assert result is not None
        assert result.id == account.id

    def test_get_by_openid_returns_none_when_no_integrate_exists(
        self, db_session_with_containers: Session
    ) -> None:
        """get_by_openid returns None when no AccountIntegrate row matches."""
        result = Account.get_by_openid("github", f"github_{uuid4()}")

        assert result is None


class TestTenantGetAccounts:
    """Integration tests for Tenant.get_accounts method."""

    @pytest.fixture(autouse=True)
    def _auto_rollback(self, db_session_with_containers: Session) -> Generator[None, None, None]:
        yield
        db_session_with_containers.rollback()

    def _create_account(self, db_session: Session) -> Account:
        account = Account(
            name=f"Account {uuid4()}",
            email=f"tenant_member_{uuid4()}@example.com",
            password="hashed-password",
            password_salt="salt",
            interface_language="en-US",
            timezone="UTC",
        )
        db_session.add(account)
        db_session.flush()
        return account

    def test_get_accounts_returns_linked_accounts(self, db_session_with_containers: Session) -> None:
        """get_accounts returns all accounts linked to the tenant via TenantAccountJoin."""
        tenant = Tenant(name=f"Tenant {uuid4()}")
        db_session_with_containers.add(tenant)
        db_session_with_containers.flush()

        account1 = self._create_account(db_session_with_containers)
        account2 = self._create_account(db_session_with_containers)

        db_session_with_containers.add(
            TenantAccountJoin(
                tenant_id=tenant.id, account_id=account1.id, role=TenantAccountRole.OWNER
            )
        )
        db_session_with_containers.add(
            TenantAccountJoin(
                tenant_id=tenant.id, account_id=account2.id, role=TenantAccountRole.NORMAL
            )
        )
        db_session_with_containers.flush()

        accounts = tenant.get_accounts()

        assert len(accounts) == 2
        account_ids = {a.id for a in accounts}
        assert account1.id in account_ids
        assert account2.id in account_ids
