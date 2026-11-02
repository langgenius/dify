"""The free manifest retains exact signup grant identity and millisecond bytes."""

import copy
from typing import cast

import pytest
from pydantic import TypeAdapter, ValidationError

from dev.generate_model_billing_migration_contract import free_fixture
from services.entities.model_billing_migration import (
    ClaimFreeMigrationPayload,
    FreeGrantManifest,
    MigrationSourceProviderOwnership,
    StableMigrationSourceProviderOwnership,
    canonical_hash,
)


def test_v2_source_ownership_union_keeps_old_record_bytes_and_hash_exact() -> None:
    provider = "langgenius/openai/openai"
    old = {"current_quota_type": "trial", "quotas": {"paid": {"unmetered": False}, "trial": {"unmetered": True}}}
    parsed = TypeAdapter(
        dict[str, MigrationSourceProviderOwnership | StableMigrationSourceProviderOwnership]
    ).validate_python({provider: old})
    rendered = {key: value.model_dump(mode="json") for key, value in parsed.items()}
    assert rendered == {provider: old}
    assert canonical_hash(rendered) == canonical_hash({provider: old})
    assert "schema_version" not in rendered[provider]


def test_v2_source_ownership_has_structural_fields_without_current_wallet_or_counters() -> None:
    raw = {
        "schema_version": 2,
        "shared_pool_types": ["paid", "trial"],
        "quotas": {
            "paid": {"unit": "credits", "unmetered": False},
            "free": {"unit": "tokens", "unmetered": False},
            "trial": {"unit": "credits", "unmetered": False},
        },
    }
    record = StableMigrationSourceProviderOwnership.model_validate(raw)
    assert record.model_dump(mode="json") == raw
    assert not hasattr(record, "current_quota_type")
    changed = copy.deepcopy(raw)
    cast(dict[str, dict[str, object]], changed["quotas"])["paid"]["usage"] = 3
    with pytest.raises(ValidationError):
        StableMigrationSourceProviderOwnership.model_validate(changed)


@pytest.mark.parametrize("shared", [["trial", "paid"], ["paid", "paid"], ["free"], ["trial"]])
def test_v2_source_ownership_rejects_noncanonical_or_unmetered_masked_shared_capability(shared: list[str]) -> None:
    with pytest.raises(ValidationError):
        StableMigrationSourceProviderOwnership.model_validate(
            {
                "schema_version": 2,
                "shared_pool_types": shared,
                "quotas": {
                    "paid": {"unit": "credits", "unmetered": True},
                    "trial": {"unit": "credits", "unmetered": False},
                },
            }
        )


def test_free_manifest_matches_cross_language_grant_trial_payload_hash() -> None:
    fixture = free_fixture()
    manifest = FreeGrantManifest.model_validate(fixture["manifest"])
    assert manifest.occurred_at == "2026-09-02T01:02:03.456Z"
    assert manifest.partner_payload() == fixture["partner_payload"]
    assert fixture["manifest_hash"] == "sha256:ef7ea4cd518a8a4808f0eb1e8a05a44dea8b185d8a6202719804b478df6f149c"
    assert canonical_hash(manifest.partner_payload()) == (
        "sha256:a70d1f0c5051463ecd460e72081e2e0a33da510cbfd9b0caf15c2d26712c4d00"
    )


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("grant_id", "trial.v1.other"),
        ("external_ref", "33333333-3333-4333-8333-333333333333"),
        ("occurred_at", "2026-09-02T01:02:03Z"),
        ("occurred_at", "2026-09-02T01:02:03.456000Z"),
        ("occurred_at", "2026-09-02T01:02:03.456+00:00"),
        ("occurred_at", "2026-02-30T01:02:03.456Z"),
        ("amount_usd_micro", "0"),
        ("amount_usd_micro", "-1"),
        ("amount_usd_micro", "0.25"),
        ("amount_usd_micro", 250000),
        ("plan_revision", True),
        ("plan_revision", 2),
        ("contract_ref", "synthetic"),
        ("funding_invoice_id", "fake-invoice"),
        ("windows", []),
        ("currency", "USD"),
        ("status", "active"),
    ],
)
def test_free_manifest_rejects_noncanonical_identity_or_synthetic_paid_fields(field: str, value: object) -> None:
    data = copy.deepcopy(free_fixture()["manifest"])
    data[field] = value
    with pytest.raises(ValidationError):
        FreeGrantManifest.model_validate(data)


def test_claim_free_requires_manifest_and_nonempty_billing_evidence() -> None:
    fixture = free_fixture()
    payload = {
        "api_version": 1,
        "operation_id": "33333333-3333-4333-8333-333333333333",
        "expected_revision": 2,
        "preparation_binding_hash": "sha256:" + "1" * 64,
        "free_grant_manifest": fixture["manifest"],
        "manifest_hash": fixture["manifest_hash"],
        "billing_receipt_refs": ["billing.free.fixture"],
    }
    assert ClaimFreeMigrationPayload.model_validate(payload).free_grant_manifest.schema_version == 2
    with pytest.raises(ValidationError):
        ClaimFreeMigrationPayload.model_validate({**payload, "billing_receipt_refs": []})
    with pytest.raises(ValidationError):
        ClaimFreeMigrationPayload.model_validate({**payload, "manifest": fixture["manifest"]})
