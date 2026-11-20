"""Enrich native workspace credits without opening a legacy credits pool."""

from collections.abc import Callable

import pytest
from sqlalchemy.orm import Session

from enums import DeploymentEdition
from enums.model_billing import ModelBillingSource, TenantTokenerIntegrationStatus
from models.account import Tenant
from models.model_billing import TenantModelBillingProfile
from models.tokener import TenantTokenerIntegration
from services.billing_service import BillingService
from services.entities.tokener_metering import TokenerTenantMeteringResponse
from services.errors.billing import BillingUpstreamUnavailableError
from services.workspace.gateways import DeploymentWorkspaceFeatureGateway


@pytest.mark.parametrize(
    ("status", "upstream_available"),
    [
        (TenantTokenerIntegrationStatus.PENDING, True),
        (TenantTokenerIntegrationStatus.FAILED, True),
        (TenantTokenerIntegrationStatus.READY, True),
        (TenantTokenerIntegrationStatus.READY, False),
    ],
)
def test_native_credits_never_fall_back_to_legacy(
    sqlite_session: Session,
    config_overrides: Callable[..., None],
    monkeypatch: pytest.MonkeyPatch,
    status: TenantTokenerIntegrationStatus,
    upstream_available: bool,
) -> None:
    config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.CLOUD)
    tenant = Tenant(name="Native signup fixture")
    sqlite_session.add(tenant)
    sqlite_session.flush()
    tenant_id = tenant.id
    sqlite_session.add_all(
        [
            TenantModelBillingProfile(tenant_id=tenant_id, model_billing_source="tokener"),
            TenantTokenerIntegration(tenant_id=tenant_id, status=status),
        ]
    )
    sqlite_session.commit()

    meter: TokenerTenantMeteringResponse = {
        "tenant_id": tenant_id,
        "currency": "USD",
        "available_usd_micro": "999994",
        "current_month": {
            "status": "available",
            "start_date": "2026-11-01",
            "end_date": "2026-11-30",
            "billed_usd_micro": "6",
            "request_count": "1",
        },
        "balance_generated_at": "2026-11-18T00:00:00Z",
        "usage_generated_at": "2026-11-18T00:00:00Z",
    }
    metering_reads: list[str] = []

    def fail_legacy(_tenant: str, **_options: bool) -> None:
        raise AssertionError("A native tenant must not ask for a legacy credit pool")

    def read_native(workspace_id: str) -> TokenerTenantMeteringResponse:
        metering_reads.append(workspace_id)
        if not upstream_available:
            raise BillingUpstreamUnavailableError("fixture upstream is unavailable")
        return meter

    monkeypatch.setattr(BillingService, "get_info", fail_legacy)
    monkeypatch.setattr(BillingService, "get_tokener_metering", read_native)
    result = DeploymentWorkspaceFeatureGateway().get_model_provider_credits(tenant_id)
    ready = status == TenantTokenerIntegrationStatus.READY
    assert metering_reads == ([tenant_id] if ready else [])
    assert result.model_billing_source == ModelBillingSource.TOKENER
    assert result.tokener_bootstrap_status == status.value
    assert result.pool_type is None
    assert result.tokener_metering == (meter if ready and upstream_available else None)
