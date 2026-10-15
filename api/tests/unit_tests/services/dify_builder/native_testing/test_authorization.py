"""Pure policy checks; atomic storage is exercised only against PostgreSQL in CI."""

from datetime import UTC, datetime, timedelta

import pytest

from services.dify_builder.execution_contracts import BuilderExecutionPolicyError, canonical_digest
from services.dify_builder.native_testing.contracts import EffectIntent, OperationKey


def intent():
    return EffectIntent(
        key=OperationKey(invocation_id="inv", occurrence_path=("node", "iteration-0"), cursor=0),
        kind="tool",
        resource_ref="mail.read",
        implementation_revision="v1",
        account_ref="account",
        target={"mailbox": "inbox"},
        parameters={"limit": 1},
        input_digest="a" * 64,
        capability_digest="b" * 64,
    )


def binding(effect):
    from services.dify_builder.native_testing.repository import NativeBinding

    return NativeBinding(
        intent_digest=canonical_digest(effect.model_dump(mode="json")),
        kind="tool",
        resource_ref="mail.read",
        implementation_revision="v1",
        account_ref="account",
        capability_digest="b" * 64,
        resource_version="resource-v1",
        credential_version="credential-v1",
        isolated=False,
        egress=True,
        new_data=True,
        destructive=False,
        cost_units=2,
        budget={"cpu_ms": 10, "wall_ms": 20, "memory_bytes": 100},
        execution_id="exec",
        invocation_digest="c" * 64,
    )


def test_forged_code_kind_cannot_use_task_approval():
    from services.dify_builder.native_testing.authorization import validate_binding

    effect = intent()
    with pytest.raises(BuilderExecutionPolicyError, match="native_binding_mismatch"):
        validate_binding(effect.model_copy(update={"kind": "code"}), binding(effect))


@pytest.mark.parametrize(
    "change",
    [
        {"resource_ref": "mail.send"},
        {"capability_digest": "d" * 64},
        {"key": OperationKey(invocation_id="other", occurrence_path=("node",), cursor=0)},
        {"parameters": {"limit": True}},
    ],
)
def test_binding_rejects_resource_capability_key_and_typed_parameter_forgery(change):
    from services.dify_builder.native_testing.authorization import validate_binding

    effect = intent()
    with pytest.raises(BuilderExecutionPolicyError, match="native_binding_mismatch"):
        validate_binding(effect.model_copy(update=change), binding(effect))


def test_valid_binding_does_not_autogrant_external_read():
    from services.dify_builder.native_testing.authorization import task_grant_allowed, validate_binding

    effect = intent()
    trusted = binding(effect)
    validate_binding(effect, trusted)
    assert task_grant_allowed(trusted, task_approved=True) is False


@pytest.mark.parametrize("change", [{"egress": True}, {"new_data": True}, {"isolated": False}, {"destructive": True}])
def test_task_grant_requires_all_isolation_conditions(change):
    from services.dify_builder.native_testing.authorization import task_grant_allowed

    trusted = binding(intent()).model_copy(
        update={"kind": "code", "egress": False, "new_data": False, "isolated": True}
    )
    assert task_grant_allowed(trusted, task_approved=True)
    assert not task_grant_allowed(trusted.model_copy(update=change), task_approved=True)
    assert not task_grant_allowed(trusted, task_approved=False)


def test_reservation_rejects_forged_identity_expiry_and_inflated_budget():
    from services.dify_builder.native_testing.repository import BudgetReservation

    now = datetime.now(UTC)
    reservation = BudgetReservation(
        budget_reservation_ref="reservation",
        execution_id="exec",
        invocation_digest="c" * 64,
        expires_at=now + timedelta(seconds=30),
        limits={"cpu_ms": 10},
        profile={"cpu_ms": 8},
    )
    assert reservation.authorize(execution_id="exec", invocation_digest="c" * 64, requested={"cpu_ms": 8}, now=now) == {
        "cpu_ms": 8
    }
    for kwargs in (
        {"execution_id": "other"},
        {"invocation_digest": "d" * 64},
        {"requested": {"cpu_ms": 9}},
        {"requested": {"cpu_ms": True}},
        {"requested": {"new_dimension": 1}},
        {"now": now + timedelta(seconds=31)},
    ):
        args = {"execution_id": "exec", "invocation_digest": "c" * 64, "requested": {"cpu_ms": 8}, "now": now}
        args.update(kwargs)
        with pytest.raises(BuilderExecutionPolicyError, match="invalid_budget_reservation"):
            reservation.authorize(**args)


def test_serialized_revision_never_reads_resolved_secret_variables(monkeypatch):
    from models.workflow import Workflow
    from services.dify_builder.native_testing.repository import native_workflow_revision

    def forbidden_resolution(_self):
        raise AssertionError("revision hashing must never resolve secrets")

    workflow = Workflow(
        graph='{"nodes": []}', _features="{}", _environment_variables="{}", _conversation_variables="{}"
    )
    monkeypatch.setattr(Workflow, "environment_variables", property(forbidden_resolution))
    monkeypatch.setattr(Workflow, "conversation_variables", property(forbidden_resolution))
    original = native_workflow_revision(workflow)
    workflow._environment_variables = '{"changed": "opaque-encrypted-metadata"}'
    assert native_workflow_revision(workflow) != original


def test_reservation_profile_is_immutable_after_creation():
    from services.dify_builder.native_testing.repository import BudgetReservation

    limits = {"cpu_ms": 10}
    reservation = BudgetReservation(
        budget_reservation_ref="r",
        execution_id="e",
        invocation_digest="c" * 64,
        expires_at=datetime.now(UTC) + timedelta(minutes=1),
        limits=limits,
        profile=limits,
    )
    limits["cpu_ms"] = 999
    assert reservation.limits["cpu_ms"] == 10
    with pytest.raises(TypeError):
        reservation.profile["cpu_ms"] = 999
