from unittest.mock import MagicMock, patch

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from models.model_billing import TenantModelBillingProfile
from models.tokener import TenantTokenerIntegration, TenantTokenerIntegrationStatus
from services.account_service import TenantService
from tests.unit_tests.config_override import apply_config_overrides


def test_create_tenant_persists_tokener_integration_in_initial_commit(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
) -> None:
    apply_config_overrides(
        monkeypatch,
        TOKENER_NEW_TENANT_COHORT_ENABLED=True,
        TOKENER_NEW_TENANT_BOOTSTRAP_ENABLED=True,
        TOKENER_PLUGIN_UNIQUE_IDENTIFIER="langgenius/tokener:0.1.2@checksum",
    )

    with (
        patch("services.account_service.SystemFeatureService.is_workspace_creation_allowed", return_value=True),
        patch("services.account_service.generate_key_pair", return_value="public-key"),
        patch("services.credit_pool_service.CreditPoolService.create_default_pool") as create_default_pool,
    ):
        tenant = TenantService.create_tenant("Tokener tenant", session=sqlite_session)

    integration = sqlite_session.scalar(
        select(TenantTokenerIntegration).where(TenantTokenerIntegration.tenant_id == tenant.id)
    )
    assert integration is not None
    assert integration.status == TenantTokenerIntegrationStatus.PENDING
    assert integration.plugin_unique_identifier == "langgenius/tokener:0.1.2@checksum"
    assert integration.attempt_count == 0
    profile = sqlite_session.scalar(
        select(TenantModelBillingProfile).where(TenantModelBillingProfile.tenant_id == tenant.id)
    )
    assert profile is not None
    assert profile.model_billing_source == "tokener"
    create_default_pool.assert_not_called()


def test_create_tenant_does_not_persist_tokener_integration_when_disabled(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
) -> None:
    apply_config_overrides(
        monkeypatch,
        TOKENER_NEW_TENANT_COHORT_ENABLED=False,
        TOKENER_NEW_TENANT_BOOTSTRAP_ENABLED=True,
    )

    with (
        patch("services.account_service.SystemFeatureService.is_workspace_creation_allowed", return_value=True),
        patch("services.account_service.generate_key_pair", return_value="public-key"),
        patch("services.credit_pool_service.CreditPoolService.create_default_pool", MagicMock()) as create_default_pool,
    ):
        tenant = TenantService.create_tenant("Legacy tenant", session=sqlite_session)

    integration = sqlite_session.scalar(
        select(TenantTokenerIntegration).where(TenantTokenerIntegration.tenant_id == tenant.id)
    )
    assert integration is None
    profile = sqlite_session.scalar(
        select(TenantModelBillingProfile).where(TenantModelBillingProfile.tenant_id == tenant.id)
    )
    assert profile is None
    create_default_pool.assert_called_once_with(tenant.id, session=sqlite_session)


def test_tokener_cohort_assignment_does_not_depend_on_worker_switch(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
) -> None:
    apply_config_overrides(
        monkeypatch,
        TOKENER_NEW_TENANT_COHORT_ENABLED=True,
        TOKENER_NEW_TENANT_BOOTSTRAP_ENABLED=False,
    )

    with (
        patch("services.account_service.SystemFeatureService.is_workspace_creation_allowed", return_value=True),
        patch("services.account_service.generate_key_pair", return_value="public-key"),
        patch("services.credit_pool_service.CreditPoolService.create_default_pool") as create_default_pool,
    ):
        tenant = TenantService.create_tenant("Paused Tokener tenant", session=sqlite_session)

    profile = sqlite_session.get(TenantModelBillingProfile, tenant.id)
    integration = sqlite_session.scalar(
        select(TenantTokenerIntegration).where(TenantTokenerIntegration.tenant_id == tenant.id)
    )
    assert profile is not None
    assert profile.model_billing_source == "tokener"
    assert integration is not None
    assert integration.status == TenantTokenerIntegrationStatus.PENDING
    create_default_pool.assert_not_called()
