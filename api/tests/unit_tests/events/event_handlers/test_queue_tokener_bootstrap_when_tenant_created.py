"""Post-commit dispatch observes durable cohort authority, never an owner heuristic."""

from dataclasses import dataclass, field

import pytest

from enums.model_billing import TenantTokenerIntegrationStatus
from events.event_handlers import queue_tokener_bootstrap_when_tenant_created as handler
from models.account import Tenant
from services.entities.model_billing import StoredModelBillingProfile
from services.model_billing_profile_service import ModelBillingProfileService
from tests.helpers.unit.config_override import apply_config_overrides


@dataclass
class ProfileQuery:
    value: StoredModelBillingProfile | None
    unavailable: bool = False
    tenant_ids: list[str] = field(default_factory=list)

    def get(self, tenant_id: str) -> StoredModelBillingProfile | None:
        self.tenant_ids.append(tenant_id)
        if self.unavailable:
            raise RuntimeError("PRIVATE_DATABASE_DIAGNOSTIC")
        return self.value


@dataclass
class Dispatch:
    fail: bool = False
    tenant_ids: list[str] = field(default_factory=list)

    def delay(self, tenant_id: str) -> None:
        self.tenant_ids.append(tenant_id)
        if self.fail:
            raise RuntimeError("PRIVATE_BROKER_DIAGNOSTIC")


def test_disabled_worker_flag_does_not_resolve_a_profile_or_dispatch(monkeypatch: pytest.MonkeyPatch) -> None:
    apply_config_overrides(monkeypatch, TOKENER_NEW_TENANT_BOOTSTRAP_ENABLED=False)

    def forbidden() -> ModelBillingProfileService:
        raise AssertionError("disabled worker must not perform a profile read")

    dispatch = Dispatch()
    monkeypatch.setattr(handler, "build_model_billing_profiles", forbidden)
    monkeypatch.setattr(handler.bootstrap_tokener_tenant_task, "delay", dispatch.delay)
    handler.handle(Tenant(name="Disabled signup dispatch"))
    assert dispatch.tenant_ids == []


@pytest.mark.parametrize("admission", [False, True])
def test_explicit_native_profile_dispatches_exact_committed_tenant_even_when_new_admission_is_off(
    monkeypatch: pytest.MonkeyPatch,
    admission: bool,
) -> None:
    apply_config_overrides(
        monkeypatch, TOKENER_NEW_TENANT_BOOTSTRAP_ENABLED=True, TOKENER_NEW_TENANT_COHORT_ENABLED=admission
    )
    tenant = Tenant(name="Durable native signup")
    query = ProfileQuery(StoredModelBillingProfile("tokener", TenantTokenerIntegrationStatus.PENDING))
    service, dispatch = ModelBillingProfileService(profiles=query), Dispatch()
    monkeypatch.setattr(handler, "build_model_billing_profiles", lambda: service)
    monkeypatch.setattr(handler.bootstrap_tokener_tenant_task, "delay", dispatch.delay)
    handler.handle(tenant)
    assert query.tenant_ids == [tenant.id]
    assert dispatch.tenant_ids == [tenant.id]


@pytest.mark.parametrize("profile", [None, StoredModelBillingProfile(None, None)])
def test_legacy_or_missing_profile_never_dispatches_tokener(
    monkeypatch: pytest.MonkeyPatch,
    profile: StoredModelBillingProfile | None,
) -> None:
    apply_config_overrides(
        monkeypatch, TOKENER_NEW_TENANT_BOOTSTRAP_ENABLED=True, TOKENER_NEW_TENANT_COHORT_ENABLED=True
    )
    query, dispatch = ProfileQuery(profile), Dispatch()
    service = ModelBillingProfileService(profiles=query)
    monkeypatch.setattr(handler, "build_model_billing_profiles", lambda: service)
    monkeypatch.setattr(handler.bootstrap_tokener_tenant_task, "delay", dispatch.delay)
    tenant = Tenant(name="Existing legacy owner")
    handler.handle(tenant)
    assert query.tenant_ids == [tenant.id]
    assert dispatch.tenant_ids == []


@pytest.mark.parametrize("unavailable", [False, True])
def test_unknown_or_unavailable_profile_fails_closed_and_does_not_log_private_details(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
    unavailable: bool,
) -> None:
    apply_config_overrides(monkeypatch, TOKENER_NEW_TENANT_BOOTSTRAP_ENABLED=True)
    query, dispatch = ProfileQuery(StoredModelBillingProfile("unknown", None), unavailable), Dispatch()
    service = ModelBillingProfileService(profiles=query)
    monkeypatch.setattr(handler, "build_model_billing_profiles", lambda: service)
    monkeypatch.setattr(handler.bootstrap_tokener_tenant_task, "delay", dispatch.delay)
    tenant = Tenant(name="Unavailable profile")
    handler.handle(tenant)
    assert dispatch.tenant_ids == []
    assert tenant.id in caplog.text
    assert "profile is unavailable" in caplog.text
    assert "PRIVATE_DATABASE_DIAGNOSTIC" not in caplog.text
    assert all(record.exc_info is None for record in caplog.records)


def test_broker_failure_does_not_escape_registration_or_serialize_private_error(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    apply_config_overrides(monkeypatch, TOKENER_NEW_TENANT_BOOTSTRAP_ENABLED=True)
    query = ProfileQuery(StoredModelBillingProfile("tokener", TenantTokenerIntegrationStatus.PENDING))
    service, dispatch = ModelBillingProfileService(profiles=query), Dispatch(fail=True)
    monkeypatch.setattr(handler, "build_model_billing_profiles", lambda: service)
    monkeypatch.setattr(handler.bootstrap_tokener_tenant_task, "delay", dispatch.delay)
    tenant = Tenant(name="Committed but broker unavailable")
    handler.handle(tenant)
    assert dispatch.tenant_ids == [tenant.id]
    assert "Failed to queue Tokener bootstrap" in caplog.text
    assert "PRIVATE_BROKER_DIAGNOSTIC" not in caplog.text
    assert all(record.exc_info is None for record in caplog.records)
