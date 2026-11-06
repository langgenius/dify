"""Workflow actor identity resolution preserves Account and EndUser scope."""

import pytest
from sqlalchemy import inspect
from sqlalchemy.orm import Session, sessionmaker

from models import Account, EndUser
from models.account import TenantAccountJoin, TenantAccountRole
from repositories.tools.workflow_repository import WorkflowToolRepository
from tests.helpers.unit.model_factories import make_account, make_end_user, make_tenant


@pytest.fixture
def actor_repository(sqlite_session_factory: sessionmaker[Session]) -> WorkflowToolRepository:
    """Seed an Account in one workspace and an EndUser belonging to that tenant."""
    with sqlite_session_factory.begin() as session:
        session.add_all(
            [
                make_account(),
                make_tenant(),
                make_tenant(tenant_id="other-tenant"),
                TenantAccountJoin(tenant_id="tenant-1", account_id="account-1", role=TenantAccountRole.OWNER),
                make_end_user(),
            ]
        )
    return WorkflowToolRepository(sqlite_session_factory)


def test_actor_resolves_account_from_another_workspace(actor_repository: WorkflowToolRepository) -> None:
    """An admitted Account resolves without gaining membership in the tool workspace."""
    actor = actor_repository.actor(tenant_id="other-tenant", user_id="account-1")

    assert isinstance(actor, Account)
    assert actor.id == "account-1"
    assert actor.current_tenant_id is None
    assert actor.current_role is None
    assert inspect(actor).detached


def test_actor_preserves_account_membership_context(actor_repository: WorkflowToolRepository) -> None:
    """An Account belonging to the tool workspace retains its tenant and role."""
    actor = actor_repository.actor(tenant_id="tenant-1", user_id="account-1")

    assert isinstance(actor, Account)
    assert actor.current_tenant_id == "tenant-1"
    assert actor.current_role == TenantAccountRole.OWNER
    assert inspect(actor).detached


def test_actor_keeps_end_users_tenant_scoped(actor_repository: WorkflowToolRepository) -> None:
    """An EndUser resolves only in its own tenant, even when both tenants exist."""
    actor = actor_repository.actor(tenant_id="tenant-1", user_id="end-user-1")

    assert isinstance(actor, EndUser)
    assert actor.id == "end-user-1"
    assert inspect(actor).detached
    assert actor_repository.actor(tenant_id="other-tenant", user_id="end-user-1") is None


@pytest.mark.parametrize(
    ("tenant_id", "user_id"),
    [("tenant-1", "missing-user"), ("missing-tenant", "account-1")],
)
def test_actor_requires_an_existing_tenant_and_identity(
    actor_repository: WorkflowToolRepository, tenant_id: str, user_id: str
) -> None:
    """Missing tenant or actor records produce no identity."""
    assert actor_repository.actor(tenant_id=tenant_id, user_id=user_id) is None
