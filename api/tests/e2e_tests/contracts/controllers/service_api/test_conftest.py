"""State-based checks for shared service-API authentication fixtures."""

from uuid import uuid4

from sqlalchemy import select

from models.account import Account, Tenant, TenantAccountJoin, TenantAccountRole
from tests.unit_tests.conftest import (
    persist_service_api_dataset_owner,
    persist_service_api_tenant_owner,
)
from tests.unit_tests.controllers.conftest import app_query_services as app_query_services  # noqa: PLC0414
from tests.unit_tests.controllers.conftest import (
    datasource_application_dependencies as datasource_application_dependencies,  # noqa: PLC0414
)
from tests.unit_tests.controllers.conftest import error_response_contract as error_response_contract  # noqa: PLC0414
from tests.unit_tests.controllers.conftest import pipeline_application as pipeline_application  # noqa: PLC0414
from tests.unit_tests.controllers.service_api.conftest import ServiceApiIdentity
from tests.unit_tests.controllers.service_api.conftest import app as app  # noqa: PLC0414
from tests.unit_tests.controllers.service_api.conftest import mock_account as mock_account  # noqa: PLC0414
from tests.unit_tests.controllers.service_api.conftest import mock_api_token as mock_api_token  # noqa: PLC0414
from tests.unit_tests.controllers.service_api.conftest import mock_app_id as mock_app_id  # noqa: PLC0414
from tests.unit_tests.controllers.service_api.conftest import mock_app_model as mock_app_model  # noqa: PLC0414
from tests.unit_tests.controllers.service_api.conftest import mock_child_chunk as mock_child_chunk  # noqa: PLC0414
from tests.unit_tests.controllers.service_api.conftest import mock_dataset as mock_dataset  # noqa: PLC0414
from tests.unit_tests.controllers.service_api.conftest import mock_dataset_api_token as mock_dataset_api_token  # noqa: PLC0414
from tests.unit_tests.controllers.service_api.conftest import mock_document as mock_document  # noqa: PLC0414
from tests.unit_tests.controllers.service_api.conftest import mock_end_user as mock_end_user  # noqa: PLC0414
from tests.unit_tests.controllers.service_api.conftest import mock_segment as mock_segment  # noqa: PLC0414
from tests.unit_tests.controllers.service_api.conftest import mock_tenant as mock_tenant  # noqa: PLC0414
from tests.unit_tests.controllers.service_api.conftest import mock_tenant_id as mock_tenant_id  # noqa: PLC0414
from tests.unit_tests.controllers.service_api.conftest import service_api_identity as service_api_identity  # noqa: PLC0414


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
