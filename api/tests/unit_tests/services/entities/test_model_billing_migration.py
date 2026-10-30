"""The free manifest retains exact signup grant identity and millisecond bytes."""

import copy

import pytest
from pydantic import ValidationError

from dev.generate_model_billing_migration_contract import free_fixture
from services.entities.model_billing_migration import ClaimFreeMigrationPayload, FreeGrantManifest, canonical_hash


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
