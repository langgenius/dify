"""Pure policy checks; atomic storage is exercised only against PostgreSQL in CI."""

from datetime import UTC, datetime, timedelta

import pytest

from runtime_contracts.builder.execution import BuilderExecutionPolicyError, canonical_digest
from runtime_contracts.builder.native.contracts import EffectIntent, OperationKey


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


@pytest.mark.parametrize(
    ("parameters", "golden"),
    [
        ({"limit": 1}, "612d212385dde1043ae8206d65b1ebc8c692cc53d8da9e5be0f8c3b06ed796db"),
        ({"limit": True}, "4d6f9f32e931369db2613ba4746f348cf99e5a98a1e6e2f8187e80738db8634c"),
    ],
)
def test_legacy_batch_scope_keeps_captured_digest_and_ignores_occurrence(parameters, golden):
    from services.dify_builder.native_testing.authorization import _scope_digest
    from services.dify_builder.native_testing.repository import NativeBinding

    effect = intent().model_copy(update={"parameters": parameters})
    legacy = binding(effect).model_dump(mode="json", exclude={"approval_scope"})
    trusted = NativeBinding.model_validate(legacy)
    assert trusted.approval_scope == "batch"
    assert _scope_digest(effect, trusted) == golden
    repeated = effect.model_copy(update={"key": effect.key.model_copy(update={"cursor": 1})})
    assert _scope_digest(repeated, binding(repeated)) == golden
    assert _scope_digest(effect, trusted.model_copy(update={"approval_scope": "batch"})) == golden


@pytest.mark.parametrize(
    "key_change",
    [{"invocation_id": "another-inv"}, {"occurrence_path": ("node", "iteration-1")}, {"cursor": 1}],
)
def test_operation_scope_binds_each_actual_key_component(key_change):
    from services.dify_builder.native_testing.authorization import _scope_digest
    from services.dify_builder.native_testing.repository import NativeBinding

    effect = intent()
    trusted = NativeBinding.model_validate({**binding(effect).model_dump(mode="json"), "approval_scope": "operation"})
    repeated = effect.model_copy(update={"key": effect.key.model_copy(update=key_change)})
    current = NativeBinding.model_validate({**binding(repeated).model_dump(mode="json"), "approval_scope": "operation"})
    assert _scope_digest(effect, trusted) != _scope_digest(repeated, current)
    assert _scope_digest(effect, trusted) == _scope_digest(effect, trusted.model_copy())
    assert _scope_digest(effect, trusted) != _scope_digest(effect, binding(effect))


def test_operation_scope_preserves_typed_parameters_and_excludes_transport_correlations():
    from services.dify_builder.native_testing.authorization import _scope_digest
    from services.dify_builder.native_testing.repository import NativeBinding

    effect = intent()
    trusted = NativeBinding.model_validate({**binding(effect).model_dump(mode="json"), "approval_scope": "operation"})
    boolean = effect.model_copy(update={"parameters": {"limit": True}})
    typed = NativeBinding.model_validate({**binding(boolean).model_dump(mode="json"), "approval_scope": "operation"})
    assert _scope_digest(effect, trusted) != _scope_digest(boolean, typed)
    correlated = trusted.model_copy(update={"execution_id": "new-worker", "invocation_digest": "d" * 64})
    assert _scope_digest(effect, trusted) == _scope_digest(effect, correlated)


def _binding_boundary(*, frozen, current):
    from sqlalchemy.orm import sessionmaker

    from core.dify_builder.models import Actor
    from runtime_contracts.builder.native.contracts import NativeTestContextRef, operation_digest
    from services.dify_builder.native_testing.authorization import EffectAuthorizationService
    from services.dify_builder.native_testing.http_binding import NativeHttpBindingResolver
    from services.dify_builder.native_testing.repository import OwnedNativeTest, OwnedNativeTestLoader

    effect = intent()
    resolver = NativeHttpBindingResolver()
    loader = OwnedNativeTestLoader(
        sessionmaker(), actor=Actor(tenant_id="tenant", account_id="actor"), resolver=resolver
    )
    owned = OwnedNativeTest(
        ref=NativeTestContextRef(request_id="request", invocation_id=effect.key.invocation_id, context_digest="a" * 64),
        bindings={operation_digest(effect.key): frozen},
        tenant_id="tenant",
        actor_id="actor",
        app_id="app",
        workflow_id="workflow",
        session_id="session",
        test_input_id="input",
        generation=0,
        task_approved=False,
        expires_at=datetime(2030, 1, 1, tzinfo=UTC),
        state="running",
    )
    with pytest.MonkeyPatch.context() as boundary:
        boundary.setattr(resolver, "resolve_binding", lambda **_kwargs: current)
        return EffectAuthorizationService(loader)._binding(None, owned, effect)


@pytest.mark.parametrize("invalid", [None, True, 1, "", "OPERATION", "other", ["operation"]])
@pytest.mark.parametrize("source", ["frozen", "current"])
def test_malformed_server_scope_is_rejected_at_c02_binding_boundary(invalid, source):
    effect = intent()
    trusted = binding(effect)
    raw = trusted.model_dump(mode="json")
    current = trusted
    if source == "frozen":
        raw["approval_scope"] = invalid
    else:
        current = trusted.model_copy(update={"approval_scope": invalid})
    with pytest.raises(BuilderExecutionPolicyError, match="native_binding_mismatch"):
        _binding_boundary(frozen=raw, current=current)


@pytest.mark.parametrize(("frozen_mode", "current_mode"), [("batch", "operation"), ("operation", "batch")])
def test_current_server_scope_classification_drift_is_rejected(frozen_mode, current_mode):
    trusted = binding(intent())
    frozen = {**trusted.model_dump(mode="json"), "approval_scope": frozen_mode}
    current = trusted.model_copy(update={"approval_scope": current_mode})
    with pytest.raises(BuilderExecutionPolicyError, match="native_binding_drift"):
        _binding_boundary(frozen=frozen, current=current)


@pytest.mark.parametrize("mode", ["batch", "operation"])
def test_known_destructive_classification_remains_forbidden_in_each_scope(mode):
    trusted = binding(intent()).model_copy(update={"approval_scope": mode, "destructive": True})
    with pytest.raises(BuilderExecutionPolicyError, match="destructive_effect_forbidden"):
        _binding_boundary(frozen=trusted.model_dump(mode="json"), current=trusted)


def test_client_effect_cannot_select_approval_scope():
    from pydantic import ValidationError

    with pytest.raises(ValidationError):
        EffectIntent.model_validate({**intent().model_dump(mode="json"), "approval_scope": "operation"})
