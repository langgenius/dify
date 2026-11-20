from sqlalchemy.orm import Session, sessionmaker

from enums.model_billing import TenantTokenerIntegrationStatus
from models.account import Tenant
from models.model_billing import TenantModelBillingProfile
from models.tokener import TenantTokenerIntegration
from repositories.model_billing_profile_repository import ModelBillingProfileRepository
from services.entities.model_billing import StoredModelBillingProfile


def test_profile_status_read_is_exact_tenant_owned_and_detached(sqlite_session_factory: sessionmaker[Session]) -> None:
    with sqlite_session_factory() as session:
        one, two, legacy = Tenant(name="Native one"), Tenant(name="Native two"), Tenant(name="Legacy")
        session.add_all([one, two, legacy])
        session.flush()
        session.add_all(
            [
                TenantModelBillingProfile(tenant_id=one.id, model_billing_source="tokener"),
                TenantModelBillingProfile(tenant_id=two.id, model_billing_source="tokener"),
                TenantModelBillingProfile(tenant_id=legacy.id, model_billing_source=None),
                TenantTokenerIntegration(tenant_id=one.id, status=TenantTokenerIntegrationStatus.READY),
                TenantTokenerIntegration(tenant_id=two.id, status=TenantTokenerIntegrationStatus.FAILED),
            ]
        )
        session.commit()
        ids = one.id, two.id, legacy.id
    query = ModelBillingProfileRepository(sessions=sqlite_session_factory)
    assert query.get(ids[0]) == StoredModelBillingProfile("tokener", TenantTokenerIntegrationStatus.READY)
    assert query.get(ids[1]) == StoredModelBillingProfile("tokener", TenantTokenerIntegrationStatus.FAILED)
    assert query.get(ids[2]) == StoredModelBillingProfile(None, None)
    assert query.get("missing") is None
