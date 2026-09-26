"""Exercise integration-test identity setup with real SQLite persistence."""

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from extensions.ext_application_services import ApplicationServices
from models.account import Account, TenantAccountJoin, TenantAccountRole
from tests.test_containers_integration_tests.helpers import accounts as account_fixtures
from tests.unit_tests.account_domain import AccountDomain


def test_owner_workspace_fixture_seeds_once_when_self_service_creation_is_disabled(
    account_application_services: ApplicationServices,
    account_domain: AccountDomain,
    sqlite_session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    account_domain.policy.is_workspace_creation_allowed.return_value = False
    monkeypatch.setattr(account_fixtures, "application_services", lambda: account_application_services)
    account = account_fixtures.create_account(
        email="owner@example.com", name="Owner", interface_language="en-US", session=sqlite_session
    )

    account_fixtures.create_owner_workspace(account, name="Fixture workspace", session=sqlite_session)
    account_fixtures.create_owner_workspace(account, name="Ignored", session=sqlite_session)

    tenant = account.current_tenant
    assert tenant is not None
    assert tenant.name == "Fixture workspace"
    assert sqlite_session.get(Account, account.id) is account
    memberships = sqlite_session.scalars(
        select(TenantAccountJoin).where(TenantAccountJoin.account_id == account.id)
    ).all()
    assert [(membership.tenant_id, membership.role) for membership in memberships] == [
        (tenant.id, TenantAccountRole.OWNER)
    ]
