"""State-based checks for shared service-API authentication fixtures."""

from uuid import uuid4

from sqlalchemy import select

from models.account import Account, Tenant, TenantAccountJoin, TenantAccountRole
from tests.unit_tests.conftest import (
    persist_service_api_dataset_owner,
    persist_service_api_tenant_owner,
)
from tests.unit_tests.controllers.service_api.conftest import ServiceApiIdentity


def test_service_api_identity_persists_tenant_scoped_owner(service_api_identity: ServiceApiIdentity) -> None:
    identity = service_api_identity

    owner_row = identity.session.execute(
        select(Tenant, Account)
        .join(TenantAccountJoin, Tenant.id == TenantAccountJoin.tenant_id)
        .join(Account, TenantAccountJoin.account_id == Account.id)
        .where(
            Tenant.id == identity.tenant.id,
            TenantAccountJoin.role == TenantAccountRole.OWNER,
        )
    ).one()

    assert owner_row == (identity.tenant, identity.account)
    assert identity.account.current_tenant is identity.tenant


def test_shared_helpers_persist_real_app_and_dataset_owner_rows(service_api_identity: ServiceApiIdentity) -> None:
    session = service_api_identity.session
    app_tenant = Tenant(name="App Workspace")
    app_tenant.id = str(uuid4())
    app_owner = Account(name="App Owner", email=f"app-owner-{app_tenant.id}@example.com")
    app_owner.id = str(uuid4())

    app_membership = persist_service_api_tenant_owner(session, app_tenant, app_owner)

    dataset_tenant = Tenant(name="Dataset Workspace")
    dataset_tenant.id = str(uuid4())
    dataset_membership = TenantAccountJoin(
        tenant_id=dataset_tenant.id,
        account_id=service_api_identity.account.id,
        role=TenantAccountRole.OWNER,
    )
    persist_service_api_dataset_owner(session, dataset_tenant, dataset_membership)

    assert session.get(TenantAccountJoin, app_membership.id) is app_membership
    assert session.execute(
        select(Tenant, TenantAccountJoin)
        .join(TenantAccountJoin, Tenant.id == TenantAccountJoin.tenant_id)
        .where(Tenant.id == dataset_tenant.id)
    ).one() == (dataset_tenant, dataset_membership)
