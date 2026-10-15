"""Structural failures must stop before an authority lookup or dispatch claim.

Durability, ordering and concurrency belong to the CI-only PostgreSQL module.
"""

from datetime import UTC, datetime, timedelta

import pytest

from services.dify_builder.execution_contracts import BuilderExecutionPolicyError
from services.dify_builder.native_testing.authorization import EffectAuthorizationService
from services.dify_builder.native_testing.contracts import DispatchPermit, NativeTestContextRef
from tests.unit_tests.services.dify_builder.native_testing.test_authorization import intent


class NoAuthorityLookup:
    """Malformed wire objects must never reach a repository or physical owner."""

    def __getattr__(self, name):
        raise AssertionError(f"malformed dispatch reached authority lookup: {name}")


@pytest.mark.parametrize("field", ["ref", "intent", "permit"])
def test_missing_dispatch_evidence_stops_before_authority_lookup(field):
    guard = EffectAuthorizationService(NoAuthorityLookup())
    args = {
        "ref": NativeTestContextRef(request_id="request", invocation_id="inv", context_digest="a" * 64),
        "intent": intent(),
        "permit": DispatchPermit(
            permit_id="permit",
            attempt_id="attempt",
            operation_id="operation",
            expires_at=(datetime.now(UTC) + timedelta(minutes=1)).isoformat(),
        ),
    }
    args[field] = None
    claim = getattr(guard, "claim_dispatch", None)
    assert callable(claim), "durable physical dispatch claim protocol is unavailable"
    with pytest.raises(BuilderExecutionPolicyError, match="invalid_dispatch_permit"):
        claim(**args)


@pytest.mark.parametrize(
    ("field", "change"),
    [
        ("ref", {"policy_version": "builder-execution-v1"}),
        ("ref", {"context_digest": "invalid"}),
        ("intent", {"kind": "untrusted"}),
        ("intent", {"parameters": {"limit": float("nan")}}),
        ("permit", {"expires_at": "2026-10-15T10:00:00"}),
        ("permit", {"attempt_id": ""}),
    ],
    ids=["old-policy", "invalid-context", "invalid-kind", "nonfinite-args", "naive-expiry", "missing-attempt"],
)
def test_in_process_dto_bypass_is_revalidated_before_authority_lookup(field, change):
    guard = EffectAuthorizationService(NoAuthorityLookup())
    args = {
        "ref": NativeTestContextRef(request_id="request", invocation_id="inv", context_digest="a" * 64),
        "intent": intent(),
        "permit": DispatchPermit(
            permit_id="permit",
            attempt_id="attempt",
            operation_id="operation",
            expires_at=(datetime.now(UTC) + timedelta(minutes=1)).isoformat(),
        ),
    }
    args[field] = args[field].model_copy(update=change)
    claim = getattr(guard, "claim_dispatch", None)
    assert callable(claim), "durable physical dispatch claim protocol is unavailable"
    with pytest.raises(BuilderExecutionPolicyError, match="invalid_dispatch_permit"):
        claim(**args)
