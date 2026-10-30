"""Exercise free claims and shared funding/activation against real tenant rows."""

import copy
import json
from datetime import datetime, timedelta
from uuid import uuid4

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from graphon.model_runtime.entities.model_entities import ModelType
from models.account import Tenant
from models.enums import ProviderQuotaType
from models.model import App, AppMode, AppModelConfig
from models.model_billing import TenantModelBillingProfile
from models.model_billing_migration import TenantModelBillingMigration
from models.provider import Provider, ProviderCredential, ProviderType, TenantDefaultModel, TenantPreferredModelProvider
from models.tokener import TenantTokenerIntegration, TenantTokenerIntegrationStatus
from repositories.model_billing_free_migration_repository import ModelBillingFreeMigrationRepository
from services import model_billing_migration_service as migration_module
from services.entities.model_billing_migration import (
    ActivateMigrationPayload,
    ClaimFreeMigrationPayload,
    ContractEventPayload,
    DecideCyclePayload,
    FreeGrantManifest,
    FundingReceiptsPayload,
    LeasePayload,
    PrepareMigrationPayload,
    canonical_hash,
)
from services.model_billing_free_migration_service import (
    AdmittedBillingMigrationCaller,
    FreeMigrationError,
    ModelBillingFreeMigrationService,
)
from services.model_billing_migration_service import MigrationError
from services.model_billing_migration_service import ModelBillingMigrationService as Migration
from tests.helpers.unit.config_override import apply_config_overrides
from tests.unit_tests.services.test_model_billing_migration_service import manifest as paid_manifest

NOW = datetime(2026, 10, 1, 12)


def operation(revision: int) -> dict[str, object]:
    return {"api_version": 1, "operation_id": str(uuid4()), "expected_revision": revision}


@pytest.fixture
def free_prepared(sqlite_session: Session, monkeypatch: pytest.MonkeyPatch) -> tuple[str, str]:
    return prepare_free(
        sqlite_session,
        monkeypatch,
        source_ownership={
            "langgenius/openai/openai": {"current_quota_type": "trial", "quotas": {"trial": {"unmetered": False}}}
        },
    )


def prepare_free(
    sqlite_session: Session, monkeypatch: pytest.MonkeyPatch, *, source_ownership: dict[str, object]
) -> tuple[str, str]:
    tenant = Tenant(name="Legacy free migration")
    sqlite_session.add(tenant)
    sqlite_session.commit()
    apply_config_overrides(
        monkeypatch,
        TOKENER_LEGACY_MIGRATION_ENABLED=True,
        TOKENER_LEGACY_MIGRATION_ALLOWLIST=tenant.id,
        TOKENER_PLUGIN_UNIQUE_IDENTIFIER="langgenius/tokener:0.4.3-dev1@fixture",
    )
    monkeypatch.setattr(migration_module, "naive_utc_now", lambda: NOW)
    # The existing preparation task/runtime mapping gateway is independently
    # exercised by its owner tests. These seams keep this state-machine unit offline.
    monkeypatch.setattr(Migration, "enqueue_prepare", lambda *_args: None)
    monkeypatch.setattr(Migration, "validate_runtime_readiness", lambda *_args, **_kwargs: None)
    request = PrepareMigrationPayload.model_validate(
        {
            **operation(0),
            "migration_id": str(uuid4()),
            "batch_id": "free-batch",
            "eligibility_policy_version": "free-legacy-v1",
            "model_mapping_version": "mapping-v1",
            "inventory_hash": "sha256:" + "1" * 64 if source_ownership else canonical_hash([]),
            "billing_preparation_ref": "billing.free.fixture",
        }
    )
    Migration.prepare(tenant.id, request)
    credential = ProviderCredential(
        tenant_id=tenant.id,
        provider_name="langgenius/tokener/tokener",
        credential_name="__dify_managed_tokener_v1__",
        encrypted_config="encrypted-managed",
    )
    sqlite_session.add(credential)
    sqlite_session.flush()
    integration = sqlite_session.scalar(
        select(TenantTokenerIntegration).where(TenantTokenerIntegration.tenant_id == tenant.id)
    )
    assert integration is not None
    integration.status = TenantTokenerIntegrationStatus.READY
    integration.provider_credential_id = credential.id
    sqlite_session.commit()
    Migration.complete_preparation(
        tenant.id,
        request.migration_id,
        source_ownership=source_ownership,
        expected_credential_fingerprint=canonical_hash({"encrypted_config": credential.encrypted_config}),
    )
    return tenant.id, request.migration_id


def free_manifest(tenant: str, migration: str) -> FreeGrantManifest:
    return FreeGrantManifest(
        schema_version=2,
        funding_kind="one_time_trial_grant",
        tenant_id=tenant,
        migration_id=migration,
        plan_revision=1,
        grant_id=f"trial.v1.{tenant}",
        external_ref=tenant,
        amount_usd_micro="250000",
        occurred_at="2026-09-02T01:02:03.456Z",
        amount_policy_version="signup-trial-v1",
        model_mapping_version="mapping-v1",
    )


def claim_request(tenant: str, migration: str) -> ClaimFreeMigrationPayload:
    status = Migration.status(tenant)
    manifest = free_manifest(tenant, migration)
    return ClaimFreeMigrationPayload.model_validate(
        {
            **operation(status["revision"]),
            "preparation_binding_hash": status["preparation_binding_hash"],
            "billing_receipt_refs": ["billing.free.eligibility.fixture"],
            "free_grant_manifest": manifest.model_dump(mode="json"),
            "manifest_hash": canonical_hash(manifest.model_dump(mode="json")),
        }
    )


def claim(tenant: str, migration: str, request: ClaimFreeMigrationPayload | None = None) -> dict[str, object]:
    return ModelBillingFreeMigrationService(store=ModelBillingFreeMigrationRepository()).claim_free(
        AdmittedBillingMigrationCaller(tenant), migration, request or claim_request(tenant, migration)
    )


def leased(tenant: str, migration: str) -> dict[str, object]:
    return Migration.lease(
        tenant,
        migration,
        LeasePayload.model_validate({**operation(Migration.status(tenant)["revision"]), "action": "acquire"}),
    )


def funding_request(tenant: str, migration: str, state: str = "verified") -> FundingReceiptsPayload:
    status = Migration.status(tenant)
    grant = free_manifest(tenant, migration)
    return FundingReceiptsPayload.model_validate(
        {
            **operation(status["revision"]),
            "lease_token": status["lease_token"],
            "intent_revision": 1,
            "manifest_hash": status["manifest_hash"],
            "commands": [
                {
                    "command_id": "grant:" + grant.grant_id,
                    "remote_id": grant.grant_id,
                    "payload_hash": canonical_hash(grant.partner_payload()),
                    "state": state,
                }
            ],
        }
    )


def activation(status: dict[str, object]) -> ActivateMigrationPayload:
    revision = status["revision"]
    assert isinstance(revision, int)
    return ActivateMigrationPayload.model_validate(
        {
            **operation(revision),
            **{
                key: status[key]
                for key in (
                    "lease_token",
                    "intent_revision",
                    "manifest_hash",
                    "funding_receipt_hash",
                    "preparation_binding_hash",
                )
            },
        }
    )


def test_free_claim_is_tenant_bound_one_time_and_replay_precedes_cas(free_prepared: tuple[str, str]) -> None:
    tenant, migration = free_prepared
    request = claim_request(tenant, migration)
    first = claim(tenant, migration, request)
    replay = claim(tenant, migration, request)
    assert first["phase"] == "claimed"
    assert first["eligibility_policy_version"] == "free-legacy-v1"
    assert FreeGrantManifest.model_validate(first["free_grant_manifest"]).grant_id == f"trial.v1.{tenant}"
    assert "manifest" not in first
    assert first["cycle_decisions"] == []
    assert replay["replayed"]
    assert replay["revision"] == first["revision"]
    replayed_operation = replay["replayed_operation"]
    assert isinstance(replayed_operation, dict)
    assert replayed_operation["result_summary"]["phase"] == "claimed"
    changed = request.model_copy(update={"manifest_hash": "sha256:" + "9" * 64})
    with pytest.raises(FreeMigrationError, match="manifest_conflict"):
        claim(tenant, migration, changed)
    with pytest.raises(FreeMigrationError, match="readiness_changed"):
        claim(tenant, migration, claim_request(tenant, migration))
    assert Migration.status(tenant)["revision"] == first["revision"]


@pytest.mark.parametrize("field", ["tenant_id", "migration_id", "model_mapping_version", "hash", "binding"])
def test_free_claim_rejects_unbound_identity_mapping_or_hash_without_writing(
    free_prepared: tuple[str, str], field: str
) -> None:
    tenant, migration = free_prepared
    before = Migration.status(tenant)
    data = claim_request(tenant, migration).model_dump(mode="json")
    if field == "tenant_id":
        other = str(uuid4())
        data["free_grant_manifest"].update(tenant_id=other, external_ref=other, grant_id=f"trial.v1.{other}")
    elif field == "migration_id":
        data["free_grant_manifest"][field] = str(uuid4())
    elif field == "model_mapping_version":
        data["free_grant_manifest"][field] = "different-mapping"
    data["manifest_hash"] = canonical_hash(data["free_grant_manifest"])
    if field == "hash":
        data["manifest_hash"] = "sha256:" + "9" * 64
    if field == "binding":
        data["preparation_binding_hash"] = "sha256:" + "9" * 64
    with pytest.raises(FreeMigrationError, match="readiness_changed" if field == "binding" else "manifest_conflict"):
        claim(tenant, migration, ClaimFreeMigrationPayload.model_validate(data))
    assert Migration.status(tenant) == before


@pytest.mark.parametrize("winner", ["free", "paid"])
def test_paid_and_free_same_revision_contenders_have_exactly_one_winner(
    free_prepared: tuple[str, str], winner: str
) -> None:
    tenant, migration = free_prepared
    free = claim_request(tenant, migration)
    data = paid_manifest(tenant, migration)
    paid = DecideCyclePayload.model_validate(
        {
            **operation(free.expected_revision),
            "cycle_key": "cycle-0",
            "decision": "tokener",
            "contract_ref": "contract-fixture",
            "preparation_binding_hash": free.preparation_binding_hash,
            "billing_receipt_refs": ["paid-receipt"],
            "manifest": data,
            "manifest_hash": canonical_hash(data),
        }
    )
    if winner == "free":
        claim(tenant, migration, free)
        with pytest.raises(MigrationError, match="revision_conflict"):
            Migration.decide_cycle(tenant, migration, paid)
    else:
        Migration.decide_cycle(tenant, migration, paid)
        with pytest.raises(FreeMigrationError, match="revision_conflict"):
            claim(tenant, migration, free)
    status = Migration.status(tenant)
    assert ("free_grant_manifest" in status) is (winner == "free")
    assert ("manifest" in status) is (winner == "paid")


@pytest.mark.parametrize("state", ["registered", "dispatched", "accepted", "outcome_unknown"])
def test_unverified_grant_never_activates(free_prepared: tuple[str, str], state: str) -> None:
    tenant, migration = free_prepared
    claim(tenant, migration)
    leased(tenant, migration)
    status = Migration.funding_receipts(tenant, migration, funding_request(tenant, migration, state))
    assert status["phase"] == "granting"
    with pytest.raises(MigrationError, match="contract_event_pending"):
        Migration.activate(tenant, migration, activation(status))
    assert not Migration.status(tenant)["ever_activated"]


@pytest.mark.parametrize("field", ["command_id", "remote_id", "payload_hash"])
def test_free_receipt_must_match_the_exact_partner_grant_body(free_prepared: tuple[str, str], field: str) -> None:
    tenant, migration = free_prepared
    claim(tenant, migration)
    before = leased(tenant, migration)
    data = funding_request(tenant, migration).model_dump(mode="json")
    data["commands"][0][field] = "sha256:" + "9" * 64 if field == "payload_hash" else "wrong"
    with pytest.raises(MigrationError, match="unplanned_command"):
        Migration.funding_receipts(tenant, migration, FundingReceiptsPayload.model_validate(data))
    assert Migration.status(tenant)["revision"] == before["revision"]


def test_free_activation_preserves_source_app_defaults_credentials_and_old_credit_counters(
    free_prepared: tuple[str, str], sqlite_session: Session
) -> None:
    tenant, migration = free_prepared
    source = Provider(
        tenant_id=tenant,
        provider_name="langgenius/openai/openai",
        provider_type=ProviderType.SYSTEM,
        is_valid=True,
        quota_type=ProviderQuotaType.TRIAL,
        quota_limit=200,
        quota_used=123,
    )
    personal = ProviderCredential(
        tenant_id=tenant,
        provider_name="langgenius/openai/openai",
        credential_name="personal",
        encrypted_config="encrypted-personal",
    )
    default = TenantDefaultModel(
        tenant_id=tenant, provider_name="langgenius/openai/openai", model_name="gpt-4o", model_type=ModelType.LLM
    )
    preference = TenantPreferredModelProvider(
        tenant_id=tenant, provider_name="langgenius/openai/openai", preferred_provider_type=ProviderType.SYSTEM
    )
    app = App(tenant_id=tenant, name="Existing app", mode=AppMode.CHAT, enable_site=True, enable_api=True)
    config = AppModelConfig(
        app_id=app.id,
        model=json.dumps(
            {"provider": "langgenius/openai/openai", "name": "gpt-4o", "completion_params": {"temperature": 0.3}}
        ),
    )
    sqlite_session.add_all([source, personal, default, preference, app, config])
    sqlite_session.flush()
    app.app_model_config_id = config.id
    sqlite_session.commit()
    before = (config.model, app.app_model_config_id, personal.encrypted_config)
    original_request = claim_request(tenant, migration)
    claim(tenant, migration, original_request)
    leased(tenant, migration)
    verified = Migration.funding_receipts(tenant, migration, funding_request(tenant, migration))
    assert verified["phase"] == "activating"
    published = Migration.activate(tenant, migration, activation(verified))
    assert published["phase"] == "active"
    assert published["ever_activated"]
    assert "manifest" not in published
    assert claim(tenant, migration, original_request)["replayed"]
    sqlite_session.expire_all()
    profile = sqlite_session.get(TenantModelBillingProfile, tenant)
    assert profile is not None
    assert profile.model_billing_source == "tokener"
    assert (config.model, app.app_model_config_id, personal.encrypted_config) == before
    assert (source.quota_limit, source.quota_used) == (200, 123)
    assert (default.provider_name, default.model_name) == ("langgenius/openai/openai", "gpt-4o")
    assert preference.preferred_provider_type == ProviderType.SYSTEM
    # Billing handles subsequent paid upgrades with native allowance in this org.
    # An erroneous paid event is a typed rejection, never a missing-manifest 500.
    event = ContractEventPayload.model_validate(
        {
            **operation(published["revision"]),
            "business_event_ref": "future-paid-event",
            "contract_ref": "not-owned-paid-contract",
            "billing_receipt_ref": "invoice-receipt",
            "affected_window_ids": [],
            "event_type": "plan_change",
        }
    )
    with pytest.raises(MigrationError, match="ineligible_contract") as caught:
        Migration.contract_event(tenant, migration, event)
    assert caught.value.status == 422


def test_free_activation_rechecks_credential_binding(free_prepared: tuple[str, str], sqlite_session: Session) -> None:
    tenant, migration = free_prepared
    claim(tenant, migration)
    leased(tenant, migration)
    verified = Migration.funding_receipts(tenant, migration, funding_request(tenant, migration))
    credential = sqlite_session.scalar(
        select(ProviderCredential).where(
            ProviderCredential.tenant_id == tenant, ProviderCredential.provider_name == "langgenius/tokener/tokener"
        )
    )
    assert credential is not None
    credential.encrypted_config = "changed-after-grant"
    sqlite_session.commit()
    with pytest.raises(MigrationError, match="readiness_changed"):
        Migration.activate(tenant, migration, activation(verified))
    assert not Migration.status(tenant)["ever_activated"]


@pytest.mark.parametrize("field", ["state", "remote_id", "payload_hash", "funding_receipt_hash"])
def test_free_activation_rechecks_frozen_receipt_proof(
    free_prepared: tuple[str, str], sqlite_session: Session, field: str
) -> None:
    tenant, migration = free_prepared
    claim(tenant, migration)
    leased(tenant, migration)
    verified = Migration.funding_receipts(tenant, migration, funding_request(tenant, migration))
    row = sqlite_session.get(TenantModelBillingMigration, tenant)
    assert row is not None
    state = copy.deepcopy(row.state)
    if field == "funding_receipt_hash":
        state[field] = "sha256:" + "9" * 64
    else:
        receipt = state["commands"]["grant:trial.v1." + tenant]
        receipt[field] = {"state": "accepted", "remote_id": "other-grant", "payload_hash": "sha256:" + "9" * 64}[field]
    row.state = state
    sqlite_session.commit()
    with pytest.raises(MigrationError, match="manifest_conflict"):
        Migration.activate(tenant, migration, activation(verified))
    assert not Migration.status(tenant)["ever_activated"]


def test_expired_free_worker_lease_cannot_report_a_verified_grant(
    free_prepared: tuple[str, str], monkeypatch: pytest.MonkeyPatch
) -> None:
    tenant, migration = free_prepared
    claim(tenant, migration)
    leased(tenant, migration)
    request = funding_request(tenant, migration)
    monkeypatch.setattr(migration_module, "naive_utc_now", lambda: NOW + timedelta(seconds=61))
    with pytest.raises(MigrationError, match="lease_lost"):
        Migration.funding_receipts(tenant, migration, request)
    assert Migration.status(tenant)["phase"] == "claimed"


def test_free_claim_rejects_paid_only_preparation(free_prepared: tuple[str, str], sqlite_session: Session) -> None:
    tenant, migration = free_prepared
    row = sqlite_session.get(TenantModelBillingMigration, tenant)
    assert row is not None
    row.state = {**copy.deepcopy(row.state), "eligibility_policy_version": "paid-legacy-v1"}
    sqlite_session.commit()
    with pytest.raises(FreeMigrationError, match="ineligible_contract"):
        claim(tenant, migration)


@pytest.mark.parametrize("has_byok", [False, True])
def test_free_without_system_provider_publishes_tokener_without_mutating_byok_or_defaults(
    sqlite_session: Session, monkeypatch: pytest.MonkeyPatch, has_byok: bool
) -> None:
    tenant, migration = prepare_free(sqlite_session, monkeypatch, source_ownership={})
    personal = None
    default = None
    if has_byok:
        personal = ProviderCredential(
            tenant_id=tenant,
            provider_name="langgenius/openai/openai",
            credential_name="personal",
            encrypted_config="only-byok-credential",
        )
        sqlite_session.add(personal)
        sqlite_session.flush()
        sqlite_session.add(
            Provider(
                tenant_id=tenant,
                provider_name="langgenius/openai/openai",
                provider_type=ProviderType.CUSTOM,
                credential_id=personal.id,
                is_valid=True,
            )
        )
        default = TenantDefaultModel(
            tenant_id=tenant, provider_name="langgenius/openai/openai", model_name="gpt-4o", model_type=ModelType.LLM
        )
        sqlite_session.add(default)
        sqlite_session.commit()
    readiness_calls: list[tuple[str, str, str, str, str | None]] = []

    def readiness(
        tenant_id: str,
        mapping_version: str,
        inventory_hash: str,
        ownership_hash: str,
        *,
        eligibility_policy_version: str | None = None,
    ) -> None:
        readiness_calls.append((tenant_id, mapping_version, inventory_hash, ownership_hash, eligibility_policy_version))

    # Source enumeration and daemon capability/credential checks remain owned by
    # the routing tests. This verifies the frozen policy reaches that boundary.
    monkeypatch.setattr(Migration, "validate_runtime_readiness", readiness)
    original_claim = claim_request(tenant, migration)
    claim(tenant, migration, original_claim)
    leased(tenant, migration)
    verified = Migration.funding_receipts(tenant, migration, funding_request(tenant, migration))
    active = Migration.activate(tenant, migration, activation(verified))
    assert active["phase"] == "active"
    assert active["ever_activated"]
    assert readiness_calls == [(tenant, "mapping-v1", canonical_hash([]), canonical_hash({}), "free-legacy-v1")]
    assert claim(tenant, migration, original_claim)["replayed"]
    sqlite_session.expire_all()
    row = sqlite_session.get(TenantModelBillingMigration, tenant)
    assert row is not None
    assert row.state["source_ownership"] == {}
    assert not sqlite_session.scalar(
        select(Provider).where(Provider.tenant_id == tenant, Provider.provider_type == ProviderType.SYSTEM)
    )
    managed = sqlite_session.scalar(
        select(Provider).where(Provider.tenant_id == tenant, Provider.provider_name == "langgenius/tokener/tokener")
    )
    assert managed is not None
    assert managed.credential_id
    assert managed.is_valid
    if personal is not None and default is not None:
        assert personal.encrypted_config == "only-byok-credential"
        assert (default.provider_name, default.model_name) == ("langgenius/openai/openai", "gpt-4o")
    else:
        assert sqlite_session.scalar(select(TenantDefaultModel).where(TenantDefaultModel.tenant_id == tenant)) is None
