import copy
from datetime import datetime, timedelta
from operator import itemgetter
from typing import Literal, NoReturn, NotRequired, TypedDict, cast
from uuid import uuid4

import pytest
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session

from models.account import Tenant
from models.model_billing import TenantModelBillingProfile
from models.model_billing_migration import TenantModelBillingMigration
from models.provider import Provider, ProviderCredential
from models.tokener import TenantTokenerIntegration, TenantTokenerIntegrationStatus
from services import model_billing_migration_service as module
from services.entities.model_billing_migration import (
    ActivateMigrationPayload,
    ContractEventPayload,
    DecideCyclePayload,
    FundingReceiptsPayload,
    LeasePayload,
    MigrationWindow,
    PrepareMigrationPayload,
    WindowManifest,
    canonical_hash,
)
from services.model_billing_migration_service import MigrationError
from services.model_billing_migration_service import ModelBillingMigrationService as Service
from tests.unit_tests.config_override import apply_config_overrides

NOW = datetime(2026, 10, 1, 12)
HASH = "sha256:" + "1" * 64


class WindowData(TypedDict):
    ordinal: int
    cycle_key: str
    window_id: str
    source_ref: str
    starts_at: str
    ends_at: str
    amount_usd_micro: str
    aliases: list[dict[str, str]]


class ManifestData(TypedDict):
    schema_version: int
    tenant_id: str
    migration_id: str
    plan_revision: int
    calendar_policy: str
    contract_ref: str
    subscription_id: str
    paid_period_start: str
    paid_period_end: str
    funding_invoice_id: str
    amount_policy_version: str
    model_mapping_version: str
    windows: list[WindowData]


class CorrectionData(TypedDict):
    command_id: str
    window: WindowData
    delta_usd_micro: str
    target_amount_usd_micro: str
    payload_hash: NotRequired[str]


class MigrationState(TypedDict, total=False):
    revision: int
    phase: str
    attention: str
    route_epoch: int
    claimed_at: str
    replayed: bool
    ever_activated: bool
    lease_token: str
    lease_expires_at: str
    intent_revision: int
    preparation_binding_hash: str
    manifest_hash: str
    funding_receipt_hash: str
    manifest: ManifestData
    commands: list[dict[str, str]]
    cycle_decisions: list[dict[str, str]]
    terminated_contract_refs: list[str]
    pending_contract_event: dict[str, object]


def envelope(revision: int) -> dict[str, object]:
    return {"api_version": 1, "operation_id": str(uuid4()), "expected_revision": revision}


@pytest.fixture
def preparation(sqlite_session: Session, monkeypatch: pytest.MonkeyPatch) -> tuple[str, PrepareMigrationPayload]:
    tenant = Tenant(name="Migration test")
    sqlite_session.add(tenant)
    sqlite_session.commit()
    apply_config_overrides(
        monkeypatch,
        TOKENER_LEGACY_MIGRATION_ENABLED=True,
        TOKENER_LEGACY_MIGRATION_ALLOWLIST=tenant.id,
        TOKENER_PLUGIN_UNIQUE_IDENTIFIER="langgenius/tokener:0.1.3@digest",
    )
    monkeypatch.setattr(module, "naive_utc_now", lambda: NOW)
    monkeypatch.setattr(Service, "enqueue_prepare", lambda *_args: None)
    monkeypatch.setattr(Service, "validate_runtime_readiness", lambda *_args: None)
    payload = PrepareMigrationPayload.model_validate(
        {
            **envelope(0),
            "migration_id": str(uuid4()),
            "batch_id": "batch-test",
            "eligibility_policy_version": "paid-v1",
            "model_mapping_version": "mapping-v1",
            "inventory_hash": HASH,
            "billing_preparation_ref": "billing.prepare.fixture",
        }
    )
    Service.prepare(tenant.id, payload)
    return tenant.id, payload


@pytest.fixture
def prepared(preparation: tuple[str, PrepareMigrationPayload], sqlite_session: Session) -> tuple[str, str]:
    tenant_id, payload = preparation
    credential = ProviderCredential(
        tenant_id=tenant_id,
        provider_name="langgenius/tokener/tokener",
        credential_name="__dify_managed_tokener_v1__",
        encrypted_config='{"api_key":"encrypted"}',
    )
    sqlite_session.add(credential)
    sqlite_session.flush()
    integration = sqlite_session.scalar(
        select(TenantTokenerIntegration).where(
            TenantTokenerIntegration.tenant_id == tenant_id,
        )
    )
    assert integration is not None
    integration.status = TenantTokenerIntegrationStatus.READY
    integration.provider_credential_id = credential.id
    sqlite_session.commit()
    Service.complete_preparation(
        tenant_id,
        payload.migration_id,
        source_ownership={
            "langgenius/openai/openai": {"current_quota_type": "paid", "quotas": {"paid": {"unmetered": False}}},
        },
        expected_credential_fingerprint=canonical_hash({"encrypted_config": credential.encrypted_config}),
    )
    return tenant_id, payload.migration_id


def manifest(tenant_id: str, migration_id: str) -> ManifestData:
    return {
        "schema_version": 1,
        "tenant_id": tenant_id,
        "migration_id": migration_id,
        "plan_revision": 1,
        "calendar_policy": "STRIPE_UTC_V1",
        "contract_ref": "contract-fixture",
        "subscription_id": "sub_fixture",
        "paid_period_start": "2026-10-01T00:00:00Z",
        "paid_period_end": "2026-12-01T13:00:00Z",
        "funding_invoice_id": "in_fixture",
        "amount_policy_version": "price-v1",
        "model_mapping_version": "mapping-v1",
        "windows": [
            {
                "ordinal": index,
                "cycle_key": f"cycle-{index}",
                "window_id": f"window-{index}",
                "source_ref": f"window-{index}",
                "starts_at": start,
                "ends_at": end,
                "amount_usd_micro": "5000000",
                "aliases": [{"kind": "normal_slot", "id": str(index)}],
            }
            for index, (start, end) in enumerate(
                [
                    ("2026-10-01T00:00:00Z", "2026-11-01T00:00:00Z"),
                    ("2026-11-01T00:00:00Z", "2026-12-01T00:00:00Z"),
                ]
            )
        ],
    }


def correction_payloads(
    tenant_id: str, migration_id: str, count: int = 2, prefix: str = "refund"
) -> list[CorrectionData]:
    result: list[CorrectionData] = []
    for index, window in enumerate(manifest(tenant_id, migration_id)["windows"][:count]):
        command: CorrectionData = {
            "command_id": f"{prefix}-{index}",
            "window": window,
            "delta_usd_micro": "-5000000",
            "target_amount_usd_micro": "0",
        }
        command["payload_hash"] = canonical_hash(command)
        result.append(command)
    return result


def claim(tenant_id: str, migration_id: str) -> tuple[MigrationState, DecideCyclePayload]:
    status = Service.status(tenant_id)
    data = manifest(tenant_id, migration_id)
    request = DecideCyclePayload.model_validate(
        {
            **envelope(status["revision"]),
            "cycle_key": "cycle-0",
            "decision": "tokener",
            "contract_ref": "contract-fixture",
            "preparation_binding_hash": status["preparation_binding_hash"],
            "billing_receipt_refs": ["receipt-fixture"],
            "manifest": data,
            "manifest_hash": canonical_hash(data),
        }
    )
    return cast(MigrationState, Service.decide_cycle(tenant_id, migration_id, request)), request


def acquire(tenant_id: str, migration_id: str) -> MigrationState:
    return cast(
        MigrationState,
        Service.lease(
            tenant_id,
            migration_id,
            LeasePayload.model_validate(
                {
                    **envelope(Service.status(tenant_id)["revision"]),
                    "action": "acquire",
                }
            ),
        ),
    )


def receipts(
    tenant_id: str, migration_id: str, status: MigrationState | dict[str, object], *, state: str = "verified"
) -> MigrationState:
    status = cast(MigrationState, status)
    return cast(
        MigrationState,
        Service.funding_receipts(
            tenant_id,
            migration_id,
            FundingReceiptsPayload.model_validate(
                {
                    **envelope(status["revision"]),
                    "lease_token": status["lease_token"],
                    "intent_revision": status["intent_revision"],
                    "manifest_hash": status["manifest_hash"],
                    "commands": [
                        {
                            "command_id": "grant:" + window["window_id"],
                            "payload_hash": canonical_hash(window),
                            "remote_id": window["window_id"],
                            "state": state,
                        }
                        for window in status["manifest"]["windows"]
                    ],
                }
            ),
        ),
    )


def activation(
    _tenant_id: str, _migration_id: str, status: MigrationState | dict[str, object]
) -> ActivateMigrationPayload:
    status = cast(MigrationState, status)
    return ActivateMigrationPayload.model_validate(
        {
            **envelope(status["revision"]),
            "lease_token": status["lease_token"],
            "intent_revision": status["intent_revision"],
            "manifest_hash": status["manifest_hash"],
            "funding_receipt_hash": status["funding_receipt_hash"],
            "preparation_binding_hash": status["preparation_binding_hash"],
        }
    )


def test_prepare_replay_precedes_cas_and_never_creates_profile(
    preparation: tuple[str, PrepareMigrationPayload], sqlite_session: Session
) -> None:
    tenant_id, payload = preparation
    result = Service.prepare(tenant_id, payload)
    assert result["replayed"] is True
    assert result["revision"] == 1
    assert sqlite_session.get(TenantModelBillingProfile, tenant_id) is None
    assert sqlite_session.scalar(select(Provider).where(Provider.tenant_id == tenant_id)) is None


def test_operation_id_different_payload_rejected(preparation: tuple[str, PrepareMigrationPayload]) -> None:
    tenant_id, payload = preparation
    with pytest.raises(MigrationError, match="idempotency_conflict"):
        Service.prepare(tenant_id, payload.model_copy(update={"batch_id": "different"}))


def test_new_operation_stale_revision_rejected(prepared: tuple[str, str]) -> None:
    tenant_id, migration_id = prepared
    with pytest.raises(MigrationError, match="revision_conflict"):
        Service.lease(tenant_id, migration_id, LeasePayload.model_validate({**envelope(0), "action": "acquire"}))


def test_claim_freezes_all_future_cycle_decisions_and_age(prepared: tuple[str, str]) -> None:
    tenant_id, migration_id = prepared
    result, request = claim(tenant_id, migration_id)
    assert result["phase"] == "claimed"
    assert result["claimed_at"] == "2026-10-01T12:00:00Z"
    assert {decision["cycle_key"] for decision in result["cycle_decisions"]} == {"cycle-0", "cycle-1"}
    assert Service.decide_cycle(tenant_id, migration_id, request)["replayed"] is True
    assert result["route_epoch"] == 1


def test_legacy_decision_cannot_flip_to_tokener(prepared: tuple[str, str]) -> None:
    tenant_id, migration_id = prepared
    status = Service.status(tenant_id)
    Service.decide_cycle(
        tenant_id,
        migration_id,
        DecideCyclePayload.model_validate(
            {
                **envelope(status["revision"]),
                "cycle_key": "cycle-0",
                "decision": "legacy_deferred",
                "contract_ref": "contract-fixture",
                "preparation_binding_hash": status["preparation_binding_hash"],
                "billing_receipt_refs": ["legacy-receipt"],
            }
        ),
    )
    with pytest.raises(MigrationError, match="cycle_decision_conflict"):
        claim(tenant_id, migration_id)


def test_prepare_not_in_claim_attention_clock(prepared: tuple[str, str], monkeypatch: pytest.MonkeyPatch) -> None:
    tenant_id, _ = prepared
    monkeypatch.setattr(module, "naive_utc_now", lambda: NOW + timedelta(days=100))
    assert Service.status(tenant_id)["attention"] == "normal"


@pytest.mark.parametrize(("seconds", "attention"), [(300, "normal"), (301, "alerted"), (1801, "manual_required")])
def test_attention_never_restarts_with_lease(
    prepared: tuple[str, str], monkeypatch: pytest.MonkeyPatch, seconds: int, attention: str
) -> None:
    tenant_id, migration_id = prepared
    initial, _ = claim(tenant_id, migration_id)
    monkeypatch.setattr(module, "naive_utc_now", lambda: NOW + timedelta(seconds=seconds))
    current = acquire(tenant_id, migration_id)
    assert current["attention"] == attention
    assert current["claimed_at"] == initial["claimed_at"]
    assert current["route_epoch"] == initial["route_epoch"]


def test_old_lease_cannot_publish_after_takeover(prepared: tuple[str, str], monkeypatch: pytest.MonkeyPatch) -> None:
    tenant_id, migration_id = prepared
    claim(tenant_id, migration_id)
    first = acquire(tenant_id, migration_id)
    monkeypatch.setattr(module, "naive_utc_now", lambda: NOW + timedelta(seconds=61))
    second = acquire(tenant_id, migration_id)
    first["revision"] = second["revision"]
    with pytest.raises(MigrationError, match="lease_lost"):
        receipts(tenant_id, migration_id, first)


def test_verified_receipts_activate_profile_atomically_and_publish_managed_provider(
    prepared: tuple[str, str], sqlite_session: Session
) -> None:
    tenant_id, migration_id = prepared
    claim(tenant_id, migration_id)
    ready = receipts(tenant_id, migration_id, acquire(tenant_id, migration_id))
    assert ready["phase"] == "activating"
    request = activation(tenant_id, migration_id, ready)
    active = Service.activate(tenant_id, migration_id, request)
    assert active["phase"] == "active"
    assert active["route_epoch"] == 2
    assert Service.activate(tenant_id, migration_id, request)["replayed"] is True
    sqlite_session.expire_all()
    profile = sqlite_session.get(TenantModelBillingProfile, tenant_id)
    assert profile is not None
    assert profile.model_billing_source == "tokener"
    provider = sqlite_session.scalar(select(Provider).where(Provider.tenant_id == tenant_id))
    assert provider is not None
    assert provider.is_valid is True
    routing_state = Service.get_routing_state(tenant_id)
    assert routing_state is not None
    assert provider.credential_id == routing_state["preparation"]["provider_credential_id"]


@pytest.mark.parametrize(
    "field", ["intent_revision", "manifest_hash", "funding_receipt_hash", "preparation_binding_hash"]
)
def test_activation_checks_every_explicit_binding(
    prepared: tuple[str, str], sqlite_session: Session, field: str
) -> None:
    tenant_id, migration_id = prepared
    claim(tenant_id, migration_id)
    ready = receipts(tenant_id, migration_id, acquire(tenant_id, migration_id))
    request = activation(tenant_id, migration_id, ready)
    tampered = request.model_copy(update={field: 999 if field == "intent_revision" else "sha256:" + "f" * 64})
    with pytest.raises(MigrationError, match="manifest_conflict"):
        Service.activate(tenant_id, migration_id, tampered)
    assert Service.status(tenant_id)["revision"] == ready["revision"]
    assert sqlite_session.get(TenantModelBillingProfile, tenant_id) is None


@pytest.mark.parametrize(
    "remote_state", ["registered", "dispatched", "accepted", "outcome_unknown", "failed_definitive"]
)
def test_nonverified_funding_cannot_activate(prepared: tuple[str, str], remote_state: str) -> None:
    tenant_id, migration_id = prepared
    claim(tenant_id, migration_id)
    status = receipts(tenant_id, migration_id, acquire(tenant_id, migration_id), state=remote_state)
    assert status["phase"] == "granting"
    with pytest.raises(MigrationError, match="contract_event_pending"):
        Service.activate(tenant_id, migration_id, activation(tenant_id, migration_id, status))


def test_key_change_between_prepare_and_claim_is_rejected(prepared: tuple[str, str], sqlite_session: Session) -> None:
    tenant_id, migration_id = prepared
    credential = sqlite_session.scalar(select(ProviderCredential).where(ProviderCredential.tenant_id == tenant_id))
    assert credential is not None
    credential.encrypted_config = '{"api_key":"changed"}'
    sqlite_session.commit()
    with pytest.raises(MigrationError, match="readiness_changed"):
        claim(tenant_id, migration_id)


def test_contract_event_fences_old_intent_and_requires_new_correction(prepared: tuple[str, str]) -> None:
    tenant_id, migration_id = prepared
    claim(tenant_id, migration_id)
    ready = receipts(tenant_id, migration_id, acquire(tenant_id, migration_id))
    event = ContractEventPayload.model_validate(
        {
            **envelope(ready["revision"]),
            "business_event_ref": "re_fixture",
            "contract_ref": "contract-fixture",
            "billing_receipt_ref": "refund-receipt",
            "affected_window_ids": ["window-0", "window-1"],
            "event_type": "refund",
            "terminal": True,
            "command_payloads": correction_payloads(tenant_id, migration_id),
        }
    )
    fenced = Service.contract_event(tenant_id, migration_id, event)
    assert fenced["phase"] == "blocked"
    assert fenced["intent_revision"] == 2
    old_activation = activation(tenant_id, migration_id, ready).model_copy(
        update={"expected_revision": fenced["revision"]}
    )
    with pytest.raises(MigrationError, match="contract_event_pending"):
        Service.activate(tenant_id, migration_id, old_activation)
    same_grants = receipts(tenant_id, migration_id, fenced)
    assert same_grants["phase"] == "blocked"
    cancelled = Service.funding_receipts(
        tenant_id,
        migration_id,
        FundingReceiptsPayload.model_validate(
            {
                **envelope(same_grants["revision"]),
                "lease_token": same_grants["lease_token"],
                "intent_revision": 2,
                "manifest_hash": same_grants["manifest_hash"],
                "commands": [
                    {
                        "command_id": f"refund-{index}",
                        "payload_hash": correction_payloads(tenant_id, migration_id)[index]["payload_hash"],
                        "remote_id": f"window-{index}",
                        "state": "verified",
                    }
                    for index in range(2)
                ],
            }
        ),
    )
    assert cancelled["phase"] == "cancelled"


def test_cross_tenant_migration_identity_rejected(prepared: tuple[str, str]) -> None:
    tenant_id, _ = prepared
    with pytest.raises(MigrationError, match="migration_not_found"):
        Service.lease(tenant_id, str(uuid4()), LeasePayload.model_validate({**envelope(2), "action": "acquire"}))


def test_unknown_operation_does_not_mean_failed(prepared: tuple[str, str]) -> None:
    tenant_id, _ = prepared
    with pytest.raises(MigrationError, match="operation_not_found"):
        Service.status(tenant_id, str(uuid4()))


def test_expired_batch_pauses_new_claim(prepared: tuple[str, str], sqlite_session: Session) -> None:
    tenant_id, migration_id = prepared
    other = Tenant(name="Stalled migration")
    sqlite_session.add(other)
    sqlite_session.flush()
    sqlite_session.add(
        TenantModelBillingMigration(
            tenant_id=other.id,
            migration_id=str(uuid4()),
            batch_id="batch-test",
            phase="granting",
            claimed_at=NOW - timedelta(minutes=31),
        )
    )
    sqlite_session.commit()
    with pytest.raises(MigrationError, match="batch_paused"):
        claim(tenant_id, migration_id)


@pytest.mark.parametrize("field", ["tenant_id", "migration_id"])
def test_manifest_scope_is_checked(prepared: tuple[str, str], field: Literal["tenant_id", "migration_id"]) -> None:
    tenant_id, migration_id = prepared
    status = Service.status(tenant_id)
    data = manifest(tenant_id, migration_id)
    data[field] = str(uuid4())
    with pytest.raises(MigrationError, match="manifest_conflict"):
        Service.decide_cycle(
            tenant_id,
            migration_id,
            DecideCyclePayload.model_validate(
                {
                    **envelope(status["revision"]),
                    "decision": "tokener",
                    "cycle_key": "cycle-0",
                    "contract_ref": "contract-fixture",
                    "preparation_binding_hash": status["preparation_binding_hash"],
                    "billing_receipt_refs": [],
                    "manifest": data,
                    "manifest_hash": canonical_hash(data),
                }
            ),
        )


@pytest.mark.parametrize("change", ["overlap", "bad_date", "beyond_paid", "duplicate"])
def test_manifest_validation_rejects_invalid_intervals(change: str) -> None:
    data = manifest(str(uuid4()), str(uuid4()))
    if change == "overlap":
        data["windows"][1]["starts_at"] = "2026-10-10T00:00:00Z"
    elif change == "bad_date":
        data["windows"][0]["starts_at"] = "2026-02-31T00:00:00Z"
    elif change == "beyond_paid":
        data["windows"][1]["ends_at"] = "2026-12-02T00:00:00Z"
    else:
        data["windows"][1]["ordinal"] = 0
    with pytest.raises(ValidationError):
        WindowManifest.model_validate(data)


@pytest.mark.parametrize("field", ["window_id", "ordinal", "cycle_key"])
def test_manifest_rejects_each_duplicate_identity(field: str) -> None:
    data = manifest(str(uuid4()), str(uuid4()))
    original = cast(dict[str, object], data["windows"][0])
    duplicate = cast(dict[str, object], data["windows"][1])
    duplicate[field] = original[field]
    with pytest.raises(ValidationError, match="duplicate window identity"):
        WindowManifest.model_validate(data)


def test_canonical_hash_forbids_float_and_null() -> None:
    invalid_payloads: tuple[dict[str, object], ...] = ({"amount": 1.2}, {"key": None})
    for value in invalid_payloads:
        with pytest.raises(ValueError):
            canonical_hash(value)


def test_late_refund_of_expired_migration_contract_terminates_contract_but_preserves_tokener_routing(
    prepared: tuple[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    tenant_id, migration_id = prepared
    claim(tenant_id, migration_id)
    ready = receipts(tenant_id, migration_id, acquire(tenant_id, migration_id))
    active = Service.activate(tenant_id, migration_id, activation(tenant_id, migration_id, ready))
    monkeypatch.setattr(module, "naive_utc_now", lambda: datetime(2027, 1, 1))
    fenced = Service.contract_event(
        tenant_id,
        migration_id,
        ContractEventPayload.model_validate(
            {
                **envelope(active["revision"]),
                "business_event_ref": "refund-original-annual-invoice",
                "contract_ref": "contract-fixture",
                "billing_receipt_ref": "historical-refund-receipt",
                "affected_window_ids": ["window-0", "window-1"],
                "event_type": "refund",
                "terminal": True,
                "command_payloads": correction_payloads(tenant_id, migration_id, prefix="historical-refund"),
            }
        ),
    )
    leased = acquire(tenant_id, migration_id)
    resolved = Service.funding_receipts(
        tenant_id,
        migration_id,
        FundingReceiptsPayload.model_validate(
            {
                **envelope(leased["revision"]),
                "lease_token": leased["lease_token"],
                "intent_revision": fenced["intent_revision"],
                "manifest_hash": fenced["manifest_hash"],
                "commands": [
                    {
                        "command_id": f"historical-refund-{index}",
                        "payload_hash": correction_payloads(tenant_id, migration_id, prefix="historical-refund")[index][
                            "payload_hash"
                        ],
                        "remote_id": f"window-{index}",
                        "state": "verified",
                    }
                    for index in range(2)
                ],
            }
        ),
    )
    assert resolved["phase"] == "cancelled"
    assert resolved["terminated_contract_refs"] == ["contract-fixture"]
    routing_state = Service.get_routing_state(tenant_id)
    assert routing_state is not None
    assert routing_state["ever_activated"] is True


def test_reanchor_cannot_shorten_current_active_window(prepared: tuple[str, str]) -> None:
    tenant_id, migration_id = prepared
    claimed, _ = claim(tenant_id, migration_id)
    replacement = manifest(tenant_id, migration_id)
    replacement["plan_revision"] = 2
    replacement["calendar_policy"] = "REANCHOR_V1"
    replacement["windows"][0]["ends_at"] = "2026-10-15T00:00:00Z"
    with pytest.raises(MigrationError, match="active_window_boundary_changed"):
        Service.contract_event(
            tenant_id,
            migration_id,
            ContractEventPayload.model_validate(
                {
                    **envelope(claimed["revision"]),
                    "business_event_ref": "reanchor-fixture",
                    "contract_ref": "contract-fixture",
                    "billing_receipt_ref": "reanchor-receipt",
                    "affected_window_ids": ["window-0"],
                    "event_type": "reanchor",
                    "command_payloads": correction_payloads(tenant_id, migration_id, count=1),
                    "replacement_manifest": replacement,
                    "replacement_manifest_hash": canonical_hash(replacement),
                }
            ),
        )
    assert Service.status(tenant_id)["phase"] == "claimed"


def test_dispatched_command_cannot_regress_to_registered(prepared: tuple[str, str]) -> None:
    tenant_id, migration_id = prepared
    claim(tenant_id, migration_id)
    dispatched = receipts(tenant_id, migration_id, acquire(tenant_id, migration_id), state="dispatched")
    with pytest.raises(MigrationError, match="command_state_conflict"):
        receipts(tenant_id, migration_id, dispatched, state="registered")


def test_prepare_replay_after_claim_returns_original_operation_without_regrant(
    preparation: tuple[str, PrepareMigrationPayload], prepared: tuple[str, str]
) -> None:
    tenant_id, migration_id = prepared
    claim(tenant_id, migration_id)
    original = Service.prepare(tenant_id, preparation[1])
    assert original["phase"] == "claimed"
    assert original["replayed_operation"]["result_summary"]["phase"] == "preparing"
    assert original["replayed_operation"]["result_revision"] == 1
    assert original["replayed"] is True
    assert Service.status(tenant_id)["phase"] == "claimed"


def test_activation_preserves_existing_tokener_byok(prepared: tuple[str, str], sqlite_session: Session) -> None:
    tenant_id, migration_id = prepared
    byok = Provider(
        tenant_id=tenant_id,
        provider_name="langgenius/tokener/tokener",
        credential_id="original-byok-id",
        is_valid=False,
    )
    sqlite_session.add(byok)
    sqlite_session.commit()
    claim(tenant_id, migration_id)
    ready = receipts(tenant_id, migration_id, acquire(tenant_id, migration_id))
    Service.activate(tenant_id, migration_id, activation(tenant_id, migration_id, ready))
    sqlite_session.expire_all()
    persisted = sqlite_session.get(Provider, byok.id)
    assert persisted is not None
    assert persisted.credential_id == "original-byok-id"
    assert persisted.is_valid is False


def test_contract_event_persists_full_frozen_correction_and_rejects_unplanned_receipt(
    prepared: tuple[str, str],
) -> None:
    tenant_id, migration_id = prepared
    claim(tenant_id, migration_id)
    ready = receipts(tenant_id, migration_id, acquire(tenant_id, migration_id))
    command = {
        "command_id": "dify.correction.v2.fixture",
        "window": ready["manifest"]["windows"][0],
        "delta_usd_micro": "-5000000",
        "target_amount_usd_micro": "0",
    }
    command["payload_hash"] = canonical_hash(command)
    fenced = Service.contract_event(
        tenant_id,
        migration_id,
        ContractEventPayload.model_validate(
            {
                **envelope(ready["revision"]),
                "business_event_ref": "refund-frozen-fixture",
                "contract_ref": "contract-fixture",
                "billing_receipt_ref": "receipt-fixture",
                "affected_window_ids": ["window-0"],
                "event_type": "refund",
                "terminal": True,
                "command_payloads": [command],
            }
        ),
    )
    assert fenced["pending_contract_event"]["command_payloads"] == [command]
    recovered = Service.status(tenant_id)
    assert recovered["contract_events"]["refund-frozen-fixture"]["command_payloads"][0]["delta_usd_micro"] == "-5000000"
    with pytest.raises(MigrationError, match="unplanned_command"):
        Service.funding_receipts(
            tenant_id,
            migration_id,
            FundingReceiptsPayload.model_validate(
                {
                    **envelope(fenced["revision"]),
                    "lease_token": fenced["lease_token"],
                    "intent_revision": fenced["intent_revision"],
                    "manifest_hash": fenced["manifest_hash"],
                    "commands": [
                        {
                            "command_id": "not-the-frozen-correction",
                            "remote_id": "window-0",
                            "payload_hash": HASH,
                            "state": "verified",
                        }
                    ],
                }
            ),
        )


def test_preparation_stores_only_narrow_source_ownership_snapshot(prepared: tuple[str, str]) -> None:
    tenant_id, _ = prepared
    state = Service.get_routing_state(tenant_id)
    assert state is not None
    assert state["source_ownership"] == {
        "langgenius/openai/openai": {"current_quota_type": "paid", "quotas": {"paid": {"unmetered": False}}},
    }
    assert state["preparation"]["source_ownership_hash"] == canonical_hash(state["source_ownership"])


def submit_command(
    tenant_id: str, migration_id: str, status: MigrationState | dict[str, object], command: dict[str, str]
) -> MigrationState:
    status = cast(MigrationState, status)
    return cast(
        MigrationState,
        Service.funding_receipts(
            tenant_id,
            migration_id,
            FundingReceiptsPayload.model_validate(
                {
                    **envelope(status["revision"]),
                    "lease_token": status["lease_token"],
                    "intent_revision": status["intent_revision"],
                    "manifest_hash": status["manifest_hash"],
                    "commands": [command],
                }
            ),
        ),
    )


def prepare_reanchor(tenant_id: str, migration_id: str) -> tuple[MigrationState, CorrectionData, WindowData]:
    claim(tenant_id, migration_id)
    ready = receipts(tenant_id, migration_id, acquire(tenant_id, migration_id))
    active = Service.activate(tenant_id, migration_id, activation(tenant_id, migration_id, ready))
    replacement = copy.deepcopy(active["manifest"])
    replacement["plan_revision"] = 2
    replacement["calendar_policy"] = "REANCHOR_V1"
    future = replacement["windows"][1]
    future.update(
        window_id="dify.reanchor.v1.fixture.1",
        source_ref="dify.reanchor.v1.fixture.1",
        starts_at="2026-11-05T00:00:00Z",
        cycle_key="reanchor-new-cycle",
        aliases=[{"kind": "reanchor_slot", "id": "2026-11-05"}],
    )
    correction = correction_payloads(tenant_id, migration_id)[1]
    fenced = Service.contract_event(
        tenant_id,
        migration_id,
        ContractEventPayload.model_validate(
            {
                **envelope(active["revision"]),
                "business_event_ref": "in-reanchor-fixture",
                "contract_ref": "contract-fixture",
                "billing_receipt_ref": "approved-reanchor-receipt",
                "affected_window_ids": ["window-1"],
                "event_type": "reanchor",
                "replacement_manifest": replacement,
                "replacement_manifest_hash": canonical_hash(replacement),
                "command_payloads": [correction],
            }
        ),
    )
    return cast(MigrationState, fenced), correction, future


def test_real_core_accepts_saas_reanchor_grants_after_correction_without_counting_them_as_corrections(
    prepared: tuple[str, str],
) -> None:
    tenant_id, migration_id = prepared
    fenced, correction, future = prepare_reanchor(tenant_id, migration_id)
    grant = {
        "command_id": "grant:" + future["window_id"],
        "remote_id": future["window_id"],
        "payload_hash": canonical_hash(future),
        "state": "dispatched",
    }
    dispatched = submit_command(tenant_id, migration_id, fenced, grant)
    assert dispatched["phase"] == "blocked"
    assert dispatched["pending_contract_event"]["business_event_ref"] == "in-reanchor-fixture"
    verified = submit_command(tenant_id, migration_id, dispatched, {**grant, "state": "verified"})
    assert verified["phase"] == "blocked"  # A new grant cannot satisfy the old-future cancellation.
    complete = submit_command(
        tenant_id,
        migration_id,
        verified,
        {
            "command_id": correction["command_id"],
            "payload_hash": correction["payload_hash"],
            "remote_id": "window-1",
            "state": "verified",
        },
    )
    assert complete["phase"] == "activating"
    assert "pending_contract_event" not in complete
    activated = Service.activate(tenant_id, migration_id, activation(tenant_id, migration_id, complete))
    assert activated["phase"] == "active"


def test_real_core_reanchor_correction_first_clears_event_then_accepts_exact_saas_new_grant(
    prepared: tuple[str, str],
) -> None:
    tenant_id, migration_id = prepared
    fenced, correction, future = prepare_reanchor(tenant_id, migration_id)
    corrected = submit_command(
        tenant_id,
        migration_id,
        fenced,
        {
            "command_id": correction["command_id"],
            "payload_hash": correction["payload_hash"],
            "remote_id": "window-1",
            "state": "verified",
        },
    )
    assert corrected["phase"] == "granting"
    assert "pending_contract_event" not in corrected
    funded = submit_command(
        tenant_id,
        migration_id,
        corrected,
        {
            "command_id": "grant:" + future["window_id"],
            "payload_hash": canonical_hash(future),
            "remote_id": future["window_id"],
            "state": "verified",
        },
    )
    assert funded["phase"] == "activating"
    assert Service.activate(tenant_id, migration_id, activation(tenant_id, migration_id, funded))["phase"] == "active"


@pytest.mark.parametrize("replacement", [False, True])
@pytest.mark.parametrize("tamper", ["command_id", "payload_hash", "remote_id", "unknown_window", "changed_amount"])
def test_core_rejects_unbound_initial_and_replacement_grant_receipts(
    prepared: tuple[str, str], replacement: bool, tamper: str
) -> None:
    tenant_id, migration_id = prepared
    if replacement:
        status, _, window = prepare_reanchor(tenant_id, migration_id)
    else:
        claim(tenant_id, migration_id)
        status = acquire(tenant_id, migration_id)
        window = status["manifest"]["windows"][0]
    command = {
        "command_id": "grant:" + window["window_id"],
        "payload_hash": canonical_hash(window),
        "remote_id": window["window_id"],
        "state": "verified",
    }
    if tamper == "unknown_window":
        command.update(command_id="grant:another-window", remote_id="another-window")
    elif tamper == "changed_amount":
        command["payload_hash"] = canonical_hash({**window, "amount_usd_micro": "999999999"})
    else:
        command[tamper] = HASH if tamper == "payload_hash" else "wrong-binding"
    with pytest.raises(MigrationError, match="unplanned_command"):
        submit_command(tenant_id, migration_id, status, command)
    assert Service.status(tenant_id)["phase"] == status["phase"]
    assert Service.status(tenant_id)["revision"] == status["revision"]


def test_grant_payload_hash_matches_billing_shared_manifest_window_vector() -> None:
    # Same first window as SaaS testdata/tokener_migration_manifest_v1.json.
    # The receipt hashes the full original window, not just its identity/amount.
    window = MigrationWindow.model_validate(
        {
            "ordinal": 0,
            "cycle_key": "dify.cycle.v1.d03379f2a78034a6b4c0adbf05611b675704fb1fffefe03a50ecfa15c018958a",
            "window_id": "dify.migration.v1.22222222-2222-4222-8222-222222222222.0",
            "source_ref": "dify.migration.v1.22222222-2222-4222-8222-222222222222.0",
            "starts_at": "2027-06-17T00:00:00Z",
            "ends_at": "2027-07-17T00:00:00Z",
            "amount_usd_micro": "5000000",
            "aliases": [{"kind": "legacy_annual_target_date", "id": "2027-06-16"}],
        }
    )
    assert (
        canonical_hash(window.model_dump(mode="json"))
        == "sha256:a8bed17c378500a03bd5be203f44e4ddd80d507187dec5ee45e3b8e56d692886"
    )


def test_verified_corrections_cannot_substitute_for_verified_initial_grants(prepared: tuple[str, str]) -> None:
    tenant_id, migration_id = prepared
    claim(tenant_id, migration_id)
    leased = acquire(tenant_id, migration_id)
    planned = correction_payloads(tenant_id, migration_id)
    for command in planned:
        command.update(delta_usd_micro="0", target_amount_usd_micro="5000000")
        command["payload_hash"] = canonical_hash(
            {key: value for key, value in command.items() if key != "payload_hash"}
        )
    fenced = Service.contract_event(
        tenant_id,
        migration_id,
        ContractEventPayload.model_validate(
            {
                **envelope(leased["revision"]),
                "business_event_ref": "in-plan-change",
                "contract_ref": "contract-fixture",
                "billing_receipt_ref": "approved-plan-change",
                "affected_window_ids": ["window-0", "window-1"],
                "event_type": "plan_change",
                "command_payloads": planned,
            }
        ),
    )
    corrected = Service.funding_receipts(
        tenant_id,
        migration_id,
        FundingReceiptsPayload.model_validate(
            {
                **envelope(fenced["revision"]),
                "lease_token": fenced["lease_token"],
                "intent_revision": fenced["intent_revision"],
                "manifest_hash": fenced["manifest_hash"],
                "commands": [
                    {
                        "command_id": command["command_id"],
                        "payload_hash": command["payload_hash"],
                        "remote_id": command["window"]["window_id"],
                        "state": "verified",
                    }
                    for command in planned
                ],
            }
        ),
    )
    assert corrected["phase"] == "granting"
    with pytest.raises(MigrationError, match="contract_event_pending"):
        Service.activate(tenant_id, migration_id, activation(tenant_id, migration_id, corrected))
    funded = receipts(tenant_id, migration_id, corrected)
    assert funded["phase"] == "activating"


@pytest.mark.parametrize("event_type", ["refund", "cancel", "paid_to_free"])
def test_terminal_event_blocks_late_plan_update_and_preserves_tokener_profile(
    prepared: tuple[str, str], sqlite_session: Session, event_type: str
) -> None:
    tenant_id, migration_id = prepared
    claim(tenant_id, migration_id)
    ready = receipts(tenant_id, migration_id, acquire(tenant_id, migration_id))
    active = Service.activate(tenant_id, migration_id, activation(tenant_id, migration_id, ready))
    routing_state = Service.get_routing_state(tenant_id)
    assert routing_state is not None
    original_binding = routing_state["preparation"]
    frozen = correction_payloads(tenant_id, migration_id)
    fenced = Service.contract_event(
        tenant_id,
        migration_id,
        ContractEventPayload.model_validate(
            {
                **envelope(active["revision"]),
                "business_event_ref": "terminal-fixture",
                "contract_ref": "contract-fixture",
                "billing_receipt_ref": "terminal-receipt",
                "affected_window_ids": ["window-0", "window-1"],
                "event_type": event_type,
                "terminal": True,
                "command_payloads": frozen,
            }
        ),
    )
    assert fenced["terminated_contract_refs"] == ["contract-fixture"]
    complete = Service.funding_receipts(
        tenant_id,
        migration_id,
        FundingReceiptsPayload.model_validate(
            {
                **envelope(fenced["revision"]),
                "lease_token": fenced["lease_token"],
                "intent_revision": fenced["intent_revision"],
                "manifest_hash": fenced["manifest_hash"],
                "commands": [
                    {
                        "command_id": command["command_id"],
                        "payload_hash": command["payload_hash"],
                        "remote_id": command["window"]["window_id"],
                        "state": "verified",
                    }
                    for command in frozen
                ],
            }
        ),
    )
    assert complete["phase"] == "cancelled"
    assert complete["ever_activated"] is True
    for command in frozen:
        command.update(
            command_id=command["command_id"] + "-late", delta_usd_micro="10000000", target_amount_usd_micro="10000000"
        )
        command["payload_hash"] = canonical_hash(
            {key: value for key, value in command.items() if key != "payload_hash"}
        )
    with pytest.raises(MigrationError, match="contract_terminated"):
        Service.contract_event(
            tenant_id,
            migration_id,
            ContractEventPayload.model_validate(
                {
                    **envelope(complete["revision"]),
                    "business_event_ref": "stale-plan-update",
                    "contract_ref": "contract-fixture",
                    "billing_receipt_ref": "late-receipt",
                    "affected_window_ids": ["window-0", "window-1"],
                    "event_type": "plan_change",
                    "command_payloads": frozen,
                }
            ),
        )
    sqlite_session.expire_all()
    profile = sqlite_session.get(TenantModelBillingProfile, tenant_id)
    assert profile is not None
    assert profile.model_billing_source == "tokener"
    updated_routing_state = Service.get_routing_state(tenant_id)
    assert updated_routing_state is not None
    assert updated_routing_state["preparation"] == original_binding
    assert Service.status(tenant_id)["revision"] == complete["revision"]


def test_late_initial_invoice_keeps_original_cycle_alias_after_expired_slot_is_skipped(
    prepared: tuple[str, str],
) -> None:
    tenant_id, migration_id = prepared
    status = Service.status(tenant_id)
    data = manifest(tenant_id, migration_id)
    data["paid_period_start"] = "2026-09-01T12:00:00Z"
    data["windows"][0]["ordinal"] = 1
    data["windows"][1]["ordinal"] = 2
    original_cycle = "dify.cycle.v1." + canonical_hash(
        [
            tenant_id,
            data["contract_ref"],
            "invoice_initial",
            data["paid_period_start"],
        ]
    ).removeprefix("sha256:")
    assert original_cycle not in {window["cycle_key"] for window in data["windows"]}
    claimed = Service.decide_cycle(
        tenant_id,
        migration_id,
        DecideCyclePayload.model_validate(
            {
                **envelope(status["revision"]),
                "decision": "tokener",
                "cycle_key": original_cycle,
                "contract_ref": data["contract_ref"],
                "preparation_binding_hash": status["preparation_binding_hash"],
                "billing_receipt_refs": ["initial-invoice-receipt"],
                "manifest": data,
                "manifest_hash": canonical_hash(data),
            }
        ),
    )
    assert {decision["cycle_key"] for decision in claimed["cycle_decisions"]} == {original_cycle, "cycle-0", "cycle-1"}


def test_unbound_cycle_cannot_use_late_invoice_alias_exception(prepared: tuple[str, str]) -> None:
    tenant_id, migration_id = prepared
    status = Service.status(tenant_id)
    data = manifest(tenant_id, migration_id)
    with pytest.raises(MigrationError, match="manifest_conflict"):
        Service.decide_cycle(
            tenant_id,
            migration_id,
            DecideCyclePayload.model_validate(
                {
                    **envelope(status["revision"]),
                    "decision": "tokener",
                    "cycle_key": "arbitrary-unbound-cycle",
                    "contract_ref": data["contract_ref"],
                    "preparation_binding_hash": status["preparation_binding_hash"],
                    "billing_receipt_refs": [],
                    "manifest": data,
                    "manifest_hash": canonical_hash(data),
                }
            ),
        )


def test_terminal_refund_of_prior_manifest_cannot_cancel_current_contract(
    prepared: tuple[str, str], monkeypatch: pytest.MonkeyPatch
) -> None:
    tenant_id, migration_id = prepared
    claim(tenant_id, migration_id)
    ready = receipts(tenant_id, migration_id, acquire(tenant_id, migration_id))
    Service.activate(tenant_id, migration_id, activation(tenant_id, migration_id, ready))
    monkeypatch.setattr(module, "naive_utc_now", lambda: datetime(2026, 12, 1, 12))
    leased = acquire(tenant_id, migration_id)
    replacement = copy.deepcopy(leased["manifest"])
    replacement.update(
        plan_revision=2,
        calendar_policy="REANCHOR_V1",
        contract_ref="new-contract",
        paid_period_start="2026-12-01T00:00:00Z",
        paid_period_end="2027-02-01T00:00:00Z",
    )
    for index, window in enumerate(replacement["windows"]):
        window.update(
            window_id=f"new-window-{index}",
            source_ref=f"new-window-{index}",
            cycle_key=f"new-cycle-{index}",
            starts_at=["2026-12-01T00:00:00Z", "2027-01-01T00:00:00Z"][index],
            ends_at=["2027-01-01T00:00:00Z", "2027-02-01T00:00:00Z"][index],
        )
    old_commands = correction_payloads(tenant_id, migration_id)
    fenced = Service.contract_event(
        tenant_id,
        migration_id,
        ContractEventPayload.model_validate(
            {
                **envelope(leased["revision"]),
                "business_event_ref": "new-contract-reanchor",
                "contract_ref": "contract-fixture",
                "billing_receipt_ref": "new-contract-receipt",
                "affected_window_ids": ["window-0", "window-1"],
                "event_type": "reanchor",
                "replacement_manifest": replacement,
                "replacement_manifest_hash": canonical_hash(replacement),
                "command_payloads": old_commands,
            }
        ),
    )
    for command in old_commands:
        fenced = submit_command(
            tenant_id,
            migration_id,
            fenced,
            {
                "command_id": command["command_id"],
                "payload_hash": command["payload_hash"],
                "remote_id": command["window"]["window_id"],
                "state": "verified",
            },
        )
    funded = receipts(tenant_id, migration_id, fenced)
    current = Service.activate(tenant_id, migration_id, activation(tenant_id, migration_id, funded))
    historical = correction_payloads(tenant_id, migration_id, prefix="historical")
    refunded = Service.contract_event(
        tenant_id,
        migration_id,
        ContractEventPayload.model_validate(
            {
                **envelope(current["revision"]),
                "business_event_ref": "old-contract-refund",
                "contract_ref": "contract-fixture",
                "billing_receipt_ref": "old-invoice-receipt",
                "affected_window_ids": ["window-0", "window-1"],
                "event_type": "refund",
                "terminal": True,
                "command_payloads": historical,
            }
        ),
    )
    for command in historical:
        refunded = submit_command(
            tenant_id,
            migration_id,
            refunded,
            {
                "command_id": command["command_id"],
                "payload_hash": command["payload_hash"],
                "remote_id": command["window"]["window_id"],
                "state": "verified",
            },
        )
    assert refunded["phase"] == "active"
    assert refunded["terminated_contract_refs"] == ["contract-fixture"]
    assert refunded["manifest"] == replacement
    assert refunded["manifest_hash"] == current["manifest_hash"]


def test_replayed_lease_preserves_original_receipt_without_adopting_successor(
    prepared: tuple[str, str], monkeypatch: pytest.MonkeyPatch
) -> None:
    tenant_id, migration_id = prepared
    claimed, _ = claim(tenant_id, migration_id)
    acquire_payload = LeasePayload.model_validate({**envelope(claimed["revision"]), "action": "acquire"})
    first = Service.lease(tenant_id, migration_id, acquire_payload)
    monkeypatch.setattr(module, "naive_utc_now", lambda: NOW + timedelta(seconds=61))
    successor = acquire(tenant_id, migration_id)
    replayed = Service.lease(tenant_id, migration_id, acquire_payload)
    assert replayed["lease_token"] == successor["lease_token"]  # Explicitly current state.
    assert replayed["replayed_operation"]["lease_token"] == first["lease_token"]
    assert replayed["replayed_operation"]["lease_token"] != replayed["lease_token"]
    assert replayed["replayed_operation"]["result_revision"] == first["revision"]


def test_operation_journal_stores_compact_receipts_not_status_copies(
    prepared: tuple[str, str], sqlite_session: Session
) -> None:
    tenant_id, migration_id = prepared
    claim(tenant_id, migration_id)
    receipts(tenant_id, migration_id, acquire(tenant_id, migration_id))
    row = sqlite_session.get(TenantModelBillingMigration, tenant_id)
    assert row is not None
    for operation in row.state["operations"].values():
        assert "response" not in operation
        assert set(operation) <= {
            "operation_id",
            "request_hash",
            "result_code",
            "result_revision",
            "result_summary",
            "lease_action",
            "lease_token",
            "lease_expires_at",
        }
        assert "manifest" not in operation["result_summary"]
        assert "operation_results" not in operation["result_summary"]


def test_routing_projection_does_not_materialize_control_status(
    prepared: tuple[str, str], monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    tenant_id, _ = prepared
    row = sqlite_session.get(TenantModelBillingMigration, tenant_id)
    assert row is not None
    row.state = {**row.state, "large_control_journal": "not-runtime-state" * 100000}
    row.claimed_at = datetime(2026, 10, 1, 12, 34, 56, 123456)
    sqlite_session.commit()

    def forbidden_status(*_args: object, **_kwargs: object) -> NoReturn:
        raise AssertionError("model admission must not build full control status")

    monkeypatch.setattr(Service, "_status", forbidden_status)
    state = Service.get_routing_state(tenant_id)
    assert state is not None
    from core.repositories.model_billing_migration_repository import get_routing_state

    assert state == get_routing_state(tenant_id)
    assert get_routing_state(str(uuid4())) is None
    assert state["claimed_at"] == "2026-10-01T12:34:56Z"
    assert set(state) == {
        "tenant_id",
        "migration_id",
        "phase",
        "route_epoch",
        "claimed_at",
        "blocked_from",
        "model_mapping_version",
        "preparation",
        "provisioned_binding",
        "source_ownership",
        "ever_activated",
    }
    assert state["phase"] == "prepared"


def test_migration_control_state_uses_postgresql_jsonb_and_sqlite_json() -> None:
    from sqlalchemy.dialects import postgresql, sqlite

    state_type = TenantModelBillingMigration.__table__.c.state.type
    assert state_type.compile(dialect=postgresql.dialect()) == "JSONB"
    assert state_type.compile(dialect=sqlite.dialect()) == "JSON"


def manual_replan_payload(status: MigrationState) -> ContractEventPayload:
    replacement = copy.deepcopy(status["manifest"])
    replacement["plan_revision"] += 1
    window = replacement["windows"][0]
    window.update(
        window_id="dify.reanchor.v1.manual.0", source_ref="dify.reanchor.v1.manual.0", starts_at="2026-10-02T00:00:00Z"
    )
    old = status["manifest"]["windows"][0]
    command = {
        "command_id": "manual-cancel-old",
        "window": old,
        "delta_usd_micro": "-5000000",
        "target_amount_usd_micro": "0",
    }
    command["payload_hash"] = canonical_hash(command)
    return ContractEventPayload.model_validate(
        {
            **envelope(status["revision"]),
            "business_event_ref": "manual-replan-fixture",
            "contract_ref": status["manifest"]["contract_ref"],
            "billing_receipt_ref": "approved-manual-command",
            "event_type": "plan_change",
            "manual_replan": True,
            "affected_window_ids": [old["window_id"]],
            "command_payloads": [command],
            "replacement_manifest": replacement,
            "replacement_manifest_hash": canonical_hash(replacement),
        }
    )


@pytest.mark.parametrize("old_state", [None, "registered"])
def test_manual_replan_only_moves_never_dispatched_current_window(
    prepared: tuple[str, str], monkeypatch: pytest.MonkeyPatch, old_state: str | None
) -> None:
    tenant_id, migration_id = prepared
    status, _ = claim(tenant_id, migration_id)
    if old_state is not None:
        status = receipts(tenant_id, migration_id, acquire(tenant_id, migration_id), state=old_state)
    monkeypatch.setattr(module, "naive_utc_now", lambda: NOW + timedelta(days=1))
    repaired = Service.contract_event(tenant_id, migration_id, manual_replan_payload(status))
    assert repaired["phase"] == "blocked"
    assert repaired["manifest"]["windows"][0]["starts_at"] == "2026-10-02T00:00:00Z"
    assert repaired["manifest"]["windows"][0]["ends_at"] == status["manifest"]["windows"][0]["ends_at"]
    assert repaired["manifest"]["windows"][0]["amount_usd_micro"] == "5000000"
    assert repaired["manifest"]["windows"][1] == status["manifest"]["windows"][1]


@pytest.mark.parametrize("old_state", ["dispatched", "accepted", "outcome_unknown", "verified"])
def test_manual_replan_rejects_any_dispatch_or_unknown_outcome(
    prepared: tuple[str, str], monkeypatch: pytest.MonkeyPatch, old_state: str
) -> None:
    tenant_id, migration_id = prepared
    claim(tenant_id, migration_id)
    status = receipts(tenant_id, migration_id, acquire(tenant_id, migration_id), state=old_state)
    monkeypatch.setattr(module, "naive_utc_now", lambda: NOW + timedelta(days=1))
    with pytest.raises(MigrationError, match="manual_replan_already_dispatched"):
        Service.contract_event(tenant_id, migration_id, manual_replan_payload(status))
    assert Service.status(tenant_id)["revision"] == status["revision"]


def test_manual_replan_loses_cas_if_worker_dispatched_first(
    prepared: tuple[str, str], monkeypatch: pytest.MonkeyPatch
) -> None:
    tenant_id, migration_id = prepared
    claim(tenant_id, migration_id)
    registered = receipts(tenant_id, migration_id, acquire(tenant_id, migration_id), state="registered")
    request = manual_replan_payload(registered)
    dispatched = receipts(tenant_id, migration_id, registered, state="dispatched")
    monkeypatch.setattr(module, "naive_utc_now", lambda: NOW + timedelta(days=1))
    with pytest.raises(MigrationError, match="revision_conflict"):
        Service.contract_event(tenant_id, migration_id, request)
    assert Service.status(tenant_id)["revision"] == dispatched["revision"]


def cancel_before_first_publication(tenant_id: str, migration_id: str) -> MigrationState:
    claim(tenant_id, migration_id)
    leased = acquire(tenant_id, migration_id)
    planned = correction_payloads(tenant_id, migration_id)
    fenced = Service.contract_event(
        tenant_id,
        migration_id,
        ContractEventPayload.model_validate(
            {
                **envelope(leased["revision"]),
                "business_event_ref": "refund-before-publication",
                "contract_ref": "contract-fixture",
                "billing_receipt_ref": "refund-before-publication-receipt",
                "affected_window_ids": ["window-0", "window-1"],
                "event_type": "refund",
                "terminal": True,
                "command_payloads": planned,
            }
        ),
    )
    for command in planned:
        fenced = submit_command(
            tenant_id,
            migration_id,
            fenced,
            {
                "command_id": command["command_id"],
                "payload_hash": command["payload_hash"],
                "remote_id": command["window"]["window_id"],
                "state": "verified",
            },
        )
    assert fenced["phase"] == "cancelled"
    assert fenced["ever_activated"] is False
    return cast(MigrationState, fenced)


def test_cancelled_before_initial_activation_publishes_zero_money_routing_after_readiness(
    prepared: tuple[str, str],
    sqlite_session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    tenant_id, migration_id = prepared
    cancelled = cancel_before_first_publication(tenant_id, migration_id)
    assert sqlite_session.get(TenantModelBillingProfile, tenant_id) is None
    calls = []

    def assert_readiness_before_publish(*args: object) -> None:
        assert sqlite_session.get(TenantModelBillingProfile, tenant_id) is None
        calls.append(args)

    monkeypatch.setattr(Service, "validate_runtime_readiness", assert_readiness_before_publish)
    # The original allowance is no longer current. Publishing the same managed
    # org's routing must not require a new paid window, trial or balance grant.
    monkeypatch.setattr(module, "naive_utc_now", lambda: datetime(2027, 1, 1))
    leased = acquire(tenant_id, migration_id)
    request = activation(tenant_id, migration_id, leased)
    published = Service.activate(tenant_id, migration_id, request)
    assert len(calls) == 1
    assert published["phase"] == "cancelled"
    assert published["ever_activated"] is True
    assert published["terminated_contract_refs"] == ["contract-fixture"]
    assert published["commands"] == cancelled["commands"]
    assert not any(command["command_id"].startswith("grant:") for command in published["commands"])
    sqlite_session.expire_all()
    profile = sqlite_session.get(TenantModelBillingProfile, tenant_id)
    assert profile is not None
    assert profile.model_billing_source == "tokener"
    assert Service.activate(tenant_id, migration_id, request)["replayed"] is True
    assert len(calls) == 1
    # This is the precise native-handoff contract: published routing is true;
    # only the terminated original contract is fenced, not a new paid contract.
    assert "next-paid-contract" not in published["terminated_contract_refs"]


def test_cancelled_publication_does_not_bypass_runtime_readiness(
    prepared: tuple[str, str], sqlite_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    tenant_id, migration_id = prepared
    cancelled = cancel_before_first_publication(tenant_id, migration_id)

    def reject_readiness(*_args: object) -> NoReturn:
        raise MigrationError("readiness_changed")

    monkeypatch.setattr(Service, "validate_runtime_readiness", reject_readiness)
    with pytest.raises(MigrationError, match="readiness_changed"):
        Service.activate(tenant_id, migration_id, activation(tenant_id, migration_id, cancelled))
    assert Service.status(tenant_id)["ever_activated"] is False
    assert sqlite_session.get(TenantModelBillingProfile, tenant_id) is None


def test_cancelled_publication_rejects_changed_managed_credential_binding(
    prepared: tuple[str, str], sqlite_session: Session
) -> None:
    tenant_id, migration_id = prepared
    cancelled = cancel_before_first_publication(tenant_id, migration_id)
    credential = sqlite_session.scalar(select(ProviderCredential).where(ProviderCredential.tenant_id == tenant_id))
    assert credential is not None
    credential.encrypted_config = '{"api_key":"changed-after-terminal"}'
    sqlite_session.commit()
    with pytest.raises(MigrationError, match="readiness_changed"):
        Service.activate(tenant_id, migration_id, activation(tenant_id, migration_id, cancelled))
    assert Service.status(tenant_id)["ever_activated"] is False
    assert sqlite_session.get(TenantModelBillingProfile, tenant_id) is None


@pytest.mark.parametrize(
    "unfinished",
    [
        "pending_event",
        "registered",
        "dispatched",
        "accepted",
        "outcome_unknown",
        "failed_correction",
        "missing_termination",
    ],
)
def test_cancelled_publication_requires_fully_converged_terminal_proof(
    prepared: tuple[str, str], sqlite_session: Session, unfinished: str
) -> None:
    tenant_id, migration_id = prepared
    cancel_before_first_publication(tenant_id, migration_id)
    row = sqlite_session.get(TenantModelBillingMigration, tenant_id)
    assert row is not None
    state = copy.deepcopy(row.state)
    if unfinished == "pending_event":
        state["pending_contract_event"] = state["contract_events"]["refund-before-publication"]
    elif unfinished == "missing_termination":
        empty_contract_refs: list[str] = []
        state["terminated_contract_refs"] = empty_contract_refs
    else:
        command = next(iter(state["commands"].values()))
        command["state"] = "failed_definitive" if unfinished == "failed_correction" else unfinished
        state["funding_receipt_hash"] = canonical_hash(sorted(state["commands"].values(), key=itemgetter("command_id")))
    row.state = state
    sqlite_session.commit()
    current = Service.status(tenant_id)
    with pytest.raises(MigrationError, match="contract_event_pending"):
        Service.activate(tenant_id, migration_id, activation(tenant_id, migration_id, current))
    assert Service.status(tenant_id)["ever_activated"] is False
    assert sqlite_session.get(TenantModelBillingProfile, tenant_id) is None


@pytest.mark.parametrize("edit_timing", ["before_readiness", "after_readiness"])
def test_complete_preparation_rejects_key_edit_against_same_transaction_provisioned_pin(
    preparation: tuple[str, PrepareMigrationPayload],
    sqlite_session: Session,
    edit_timing: str,
) -> None:
    tenant_id, prepare_request = preparation
    credential = ProviderCredential(
        tenant_id=tenant_id,
        provider_name="langgenius/tokener/tokener",
        credential_name="platform-generated",
        encrypted_config='{"api_key":"PLATFORM_ENCRYPTED"}',
    )
    sqlite_session.add(credential)
    sqlite_session.flush()
    integration = sqlite_session.scalar(
        select(TenantTokenerIntegration).where(TenantTokenerIntegration.tenant_id == tenant_id)
    )
    assert integration is not None
    integration.provider_credential_id = credential.id
    integration.status = TenantTokenerIntegrationStatus.READY
    original_fingerprint = canonical_hash({"encrypted_config": credential.encrypted_config})
    row = sqlite_session.get(TenantModelBillingMigration, tenant_id)
    assert row is not None
    row.state = {
        **row.state,
        "provisioned_binding": {
            "tenant_id": tenant_id,
            "migration_id": prepare_request.migration_id,
            "provider_name": credential.provider_name,
            "provider_credential_id": credential.id,
            "credential_fingerprint": original_fingerprint,
        },
    }
    sqlite_session.commit()
    credential.encrypted_config = '{"api_key":"PRIVATE_ORG_EDIT"}'
    sqlite_session.commit()
    readiness_fingerprint = (
        original_fingerprint
        if edit_timing == "after_readiness"
        else canonical_hash(
            {
                "encrypted_config": credential.encrypted_config,
            }
        )
    )
    with pytest.raises(MigrationError, match="readiness_changed"):
        Service.complete_preparation(
            tenant_id,
            prepare_request.migration_id,
            source_ownership={
                "langgenius/openai/openai": {"current_quota_type": "paid", "quotas": {"paid": {"unmetered": False}}}
            },
            expected_credential_fingerprint=readiness_fingerprint,
        )
    assert Service.status(tenant_id)["phase"] == "preparing"
    routing_state = Service.get_routing_state(tenant_id)
    assert routing_state is not None
    assert "preparation" not in routing_state or routing_state["preparation"] == {}
