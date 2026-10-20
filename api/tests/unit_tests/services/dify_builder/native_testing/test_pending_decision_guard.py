"""Post-read guard compares the complete frozen checkpoint identity."""

import importlib.util
from types import SimpleNamespace

import pytest

from runtime_contracts.builder.execution import BuilderExecutionPolicyError, canonical_digest
from runtime_contracts.builder.native.contracts import CheckpointRef, NativeTestContextRef, operation_digest
from tests.unit_tests.services.dify_builder.native_testing.test_pending_intents import effect


def module():
    name = "services.dify_builder.native_testing.pending_intents"
    assert importlib.util.find_spec(name) is not None, "protected pending intent reader is missing"
    return __import__(name, fromlist=["ResolvedPendingIntent"])


def test_guard_rejects_changed_generation_checkpoint_key_intent_scope_and_owner():
    m = module()
    intent = effect()
    resolved = m.ResolvedPendingIntent(
        ref=NativeTestContextRef(request_id="r", invocation_id="inv", context_digest="c" * 64),
        generation=0,
        checkpoint=CheckpointRef(checkpoint_id="cp", payload_digest="d" * 64),
        intent=intent,
    )
    pending = {
        "id": "p",
        "tenant_id": "t",
        "request_id": "r",
        "invocation_id": "inv",
        "generation": 0,
        "category": "approval",
        "operation_id": "op",
        "reference": "op",
        "reference_digest": canonical_digest("op"),
        "owner_ref": "app",
        "owner_version": "e" * 64,
    }
    operation = {
        "id": "op",
        "tenant_id": "t",
        "request_id": "r",
        "invocation_id": "inv",
        "operation_digest": operation_digest(intent.key),
        "intent_digest": canonical_digest(intent.model_dump(mode="json")),
        "scope_digest": "e" * 64,
        "state": "pending",
    }
    state = {
        "tenant_id": "t",
        "request_id": "r",
        "invocation_id": "inv",
        "generation": 0,
        "checkpoint_id": "cp",
        "pending_ids": ["p"],
        "state": "waiting",
    }
    cp = {
        "tenant_id": "t",
        "request_id": "r",
        "invocation_id": "inv",
        "generation": 0,
        "checkpoint_id": "cp",
        "payload_digest": "d" * 64,
    }

    def validate(p=pending, o=operation, s=state, checkpoint=cp):
        m.validate_pending_snapshot(
            resolved=resolved,
            tenant_id="t",
            app_id="app",
            pending=SimpleNamespace(**p),
            operation=SimpleNamespace(**o),
            state=SimpleNamespace(**s),
            continuation=SimpleNamespace(**checkpoint),
            scope_digest="e" * 64,
            expected_version=1,
        )

    validate()
    for group, field, value in (
        ("p", "category", "configuration"),
        ("p", "generation", 1),
        ("p", "owner_ref", "other"),
        ("o", "intent_digest", "f" * 64),
        ("o", "operation_digest", "f" * 64),
        ("o", "scope_digest", "f" * 64),
        ("s", "checkpoint_id", "old"),
        ("s", "pending_ids", []),
        ("checkpoint", "payload_digest", "f" * 64),
    ):
        original = {"p": pending, "o": operation, "s": state, "checkpoint": cp}[group]
        with pytest.raises(BuilderExecutionPolicyError):
            validate(**{group: {**original, field: value}})
