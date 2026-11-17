"""New-tenant initialization stages rows but never takes the caller's transaction."""

from collections.abc import Callable

import pytest
from sqlalchemy import event
from sqlalchemy.orm import Session

from models import TenantCreditPool
from models.account import Tenant
from models.enums import ProviderQuotaType
from models.model_billing import TenantModelBillingProfile
from models.tokener import TenantTokenerIntegration, TenantTokenerIntegrationStatus
from services.tenant_model_billing_service import initialize_tenant_model_billing


@pytest.mark.parametrize("tokener_enabled", [True, False], ids=["tokener", "legacy"])
def test_initialization_stages_only_the_selected_cohort_without_flushing_or_committing(
    sqlite_session: Session, config_overrides: Callable[..., None], tokener_enabled: bool
) -> None:
    config_overrides(
        TOKENER_NEW_TENANT_COHORT_ENABLED=tokener_enabled,
        TOKENER_NEW_TENANT_BOOTSTRAP_ENABLED=False,
        TOKENER_PLUGIN_UNIQUE_IDENTIFIER="   ",
        HOSTED_POOL_CREDITS=321,
    )
    tenant = Tenant(name="Caller-owned new workspace")
    sqlite_session.add(tenant)
    sqlite_session.commit()
    tenant_id = tenant.id
    observed: list[str] = []

    def flush(*_args: object) -> None:
        observed.append("flush")

    def commit(*_args: object) -> None:
        observed.append("commit")

    def rollback(*_args: object) -> None:
        observed.append("rollback")

    event.listen(sqlite_session, "before_flush", flush)
    event.listen(sqlite_session, "after_commit", commit)
    event.listen(sqlite_session, "after_rollback", rollback)
    try:
        initialize_tenant_model_billing(tenant_id, session=sqlite_session)
        assert observed == []
        assert sqlite_session.in_transaction()
        staged = tuple(sqlite_session.new)
        if tokener_enabled:
            assert len(staged) == 2
            profile = next(row for row in staged if isinstance(row, TenantModelBillingProfile))
            integration = next(row for row in staged if isinstance(row, TenantTokenerIntegration))
            assert profile.tenant_id == tenant_id
            assert profile.model_billing_source == "tokener"
            assert integration.tenant_id == tenant_id
            assert integration.plugin_unique_identifier is None
            assert integration.status == TenantTokenerIntegrationStatus.PENDING
        else:
            assert len(staged) == 1
            assert isinstance(staged[0], TenantCreditPool)
            assert staged[0].tenant_id == tenant_id
            assert staged[0].pool_type == ProviderQuotaType.TRIAL
            assert staged[0].quota_limit == 321
            assert staged[0].quota_used == 0
        sqlite_session.rollback()
        assert observed == ["rollback"]
        assert not sqlite_session.new
        assert sqlite_session.get(TenantModelBillingProfile, tenant_id) is None
    finally:
        event.remove(sqlite_session, "before_flush", flush)
        event.remove(sqlite_session, "after_commit", commit)
        event.remove(sqlite_session, "after_rollback", rollback)
