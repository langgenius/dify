"""Structural failures must stop before an authority lookup or dispatch claim.

Durability, ordering and concurrency belong to the CI-only PostgreSQL module.
"""

from datetime import UTC, datetime, timedelta
from typing import NoReturn, cast

import pytest
from sqlalchemy.orm import sessionmaker

from core.dify_builder.models import Actor
from runtime_contracts.builder.execution import BuilderExecutionPolicyError
from runtime_contracts.builder.native.contracts import DispatchPermit, EffectIntent, NativeTestContextRef
from services.dify_builder.native_testing.authorization import EffectAuthorizationService
from services.dify_builder.native_testing.http_binding import NativeHttpBindingResolver
from services.dify_builder.native_testing.repository import OwnedNativeTestLoader
from tests.unit_tests.services.dify_builder.native_testing.test_authorization import intent


def authority_guard(monkeypatch: pytest.MonkeyPatch) -> EffectAuthorizationService:
    loader = OwnedNativeTestLoader(
        sessionmaker(),
        actor=Actor(tenant_id="tenant", account_id="actor"),
        resolver=NativeHttpBindingResolver(),
    )

    def forbidden(*args: object, **kwargs: object) -> NoReturn:
        del args, kwargs
        raise AssertionError("malformed dispatch reached authority lookup")

    monkeypatch.setattr(loader, "load", forbidden)
    monkeypatch.setattr(loader, "locked", forbidden)
    return EffectAuthorizationService(loader)


@pytest.mark.parametrize("field", ["ref", "intent", "permit"])
def test_missing_dispatch_evidence_stops_before_authority_lookup(field: str, monkeypatch: pytest.MonkeyPatch) -> None:
    guard = authority_guard(monkeypatch)
    args: dict[str, DispatchPermit | EffectIntent | NativeTestContextRef | None] = {
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
    claim = guard.claim_dispatch
    assert callable(claim), "durable physical dispatch claim protocol is unavailable"
    with pytest.raises(BuilderExecutionPolicyError, match="invalid_dispatch_permit"):
        claim(
            ref=cast(NativeTestContextRef, args["ref"]),
            intent=cast(EffectIntent, args["intent"]),
            permit=cast(DispatchPermit, args["permit"]),
        )


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
def test_in_process_dto_bypass_is_revalidated_before_authority_lookup(
    field: str, change: dict[str, object], monkeypatch: pytest.MonkeyPatch
) -> None:
    guard = authority_guard(monkeypatch)
    args: dict[str, DispatchPermit | EffectIntent | NativeTestContextRef] = {
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
    claim = guard.claim_dispatch
    assert callable(claim), "durable physical dispatch claim protocol is unavailable"
    with pytest.raises(BuilderExecutionPolicyError, match="invalid_dispatch_permit"):
        claim(
            ref=cast(NativeTestContextRef, args["ref"]),
            intent=cast(EffectIntent, args["intent"]),
            permit=cast(DispatchPermit, args["permit"]),
        )
