from unittest.mock import MagicMock, patch

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from models import TenantCreditPool
from models.enums import ProviderQuotaType
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
    assert sqlite_session.scalars(select(TenantCreditPool)).all() == []


def test_create_tenant_does_not_persist_tokener_integration_when_disabled(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
) -> None:
    apply_config_overrides(
        monkeypatch,
        TOKENER_NEW_TENANT_COHORT_ENABLED=False,
        TOKENER_NEW_TENANT_BOOTSTRAP_ENABLED=True,
        HOSTED_POOL_CREDITS=321,
    )

    with (
        patch("services.account_service.SystemFeatureService.is_workspace_creation_allowed", return_value=True),
        patch("services.account_service.generate_key_pair", return_value="public-key"),
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
    pools = sqlite_session.scalars(select(TenantCreditPool).where(TenantCreditPool.tenant_id == tenant.id)).all()
    assert len(pools) == 1
    assert pools[0].pool_type == ProviderQuotaType.TRIAL
    assert pools[0].quota_limit == 321
    assert pools[0].quota_used == 0


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
    assert sqlite_session.scalars(select(TenantCreditPool)).all() == []


@pytest.mark.parametrize("tokener_enabled", [True, False], ids=["tokener", "legacy"])
def test_billing_initialization_does_not_own_the_callers_transaction(
    monkeypatch: pytest.MonkeyPatch,
    tokener_enabled: bool,
) -> None:
    from services.tenant_model_billing_service import initialize_tenant_model_billing

    apply_config_overrides(
        monkeypatch,
        TOKENER_NEW_TENANT_COHORT_ENABLED=tokener_enabled,
        TOKENER_PLUGIN_UNIQUE_IDENTIFIER="   ",
    )
    session = MagicMock(spec=Session)

    initialize_tenant_model_billing("tenant-id", session=session)

    session.commit.assert_not_called()
    session.flush.assert_not_called()
    session.execute.assert_not_called()
    session.scalar.assert_not_called()
    session.scalars.assert_not_called()
    session.rollback.assert_not_called()
    staged = [call.args[0] for call in session.add.call_args_list]
    for call in session.add_all.call_args_list:
        staged.extend(call.args[0])
    if tokener_enabled:
        assert len(staged) == 2
        profile = next(row for row in staged if isinstance(row, TenantModelBillingProfile))
        integration = next(row for row in staged if isinstance(row, TenantTokenerIntegration))
        assert profile.tenant_id == "tenant-id"
        assert profile.model_billing_source == "tokener"
        assert integration.tenant_id == "tenant-id"
        assert integration.plugin_unique_identifier is None
        assert integration.status == TenantTokenerIntegrationStatus.PENDING
    else:
        assert len(staged) == 1
        assert isinstance(staged[0], TenantCreditPool)
        assert staged[0].tenant_id == "tenant-id"
