"""Task Stop fences real native admission owners before cancellation delivery."""

from datetime import UTC, datetime, timedelta
from typing import Literal, NoReturn

import pytest

from core.dify_builder.models import Actor
from models.dify_builder import DifyBuilderSession, DifyBuilderSessionCommit
from models.dify_builder_native_tests import NativeDispatch, NativeInvocationState
from runtime_contracts.builder.execution import BuilderExecutionPolicyError
from runtime_contracts.builder.native.contracts import DispatchPermit, decode_native_ref
from services.dify_builder.native_testing.authorization import EffectAuthorizationService
from services.dify_builder.native_testing.context_binding import NativeAdmissionCompilation, NativeRuntimeProfile
from services.dify_builder.native_testing.host_capacity import NativeHostCapacity
from tests.unit_tests.services.dify_builder.native_testing.test_authorization import intent
from tests.unit_tests.services.dify_builder.native_testing.test_native_runtime import (
    CancellationCase,
    dispatch_identity,
)

pytest_plugins = ["tests.unit_tests.services.dify_builder.native_testing.test_native_runtime"]


def pause_task(case: CancellationCase) -> None:
    builder = case.rows[DifyBuilderSession][0]
    assert isinstance(builder, DifyBuilderSession)
    old = case.rows[DifyBuilderSessionCommit][-1]
    assert isinstance(old, DifyBuilderSessionCommit)
    builder.version += 1
    case.rows[DifyBuilderSessionCommit].append(
        DifyBuilderSessionCommit(
            id="task-stop",
            session_id=builder.id,
            version=builder.version,
            state=builder.current_state,
            actor="actor",
            context={**old.context, "paused": True},
        )
    )


def test_saved_unlaunched_start_retry_cannot_enqueue_after_task_stop(
    cancel_composition: CancellationCase, monkeypatch: pytest.MonkeyPatch
) -> None:
    c = cancel_composition
    request = c.api._request(actor=c.actor, session_id="session", request_id=c.started.request_id)
    request.observations = [
        {k: v for k, v in record.items() if k != "admission_launched"} for record in request.observations
    ]
    c.rows[NativeDispatch] = []
    state = c.rows[NativeInvocationState][0]
    assert isinstance(state, NativeInvocationState)
    state.state = "running"
    c.published.clear()
    assert c.api.admission is not None
    compiler = c.api.admission.compiler
    compile_before_stop = compiler.compile

    def compile_then_pause(
        *,
        actor: Actor,
        session_id: str,
        test_input_id: str,
        expected_version: int,
        mode: Literal["native", "mock"],
        request_id: str,
        invocation_id: str,
        native_run_id: str,
        profile: NativeRuntimeProfile,
        revision_basis: Literal["confirmed-canvas-v1"] | None = None,
    ) -> NativeAdmissionCompilation:
        prepared = compile_before_stop(
            actor=actor,
            session_id=session_id,
            test_input_id=test_input_id,
            expected_version=expected_version,
            mode=mode,
            request_id=request_id,
            invocation_id=invocation_id,
            native_run_id=native_run_id,
            profile=profile,
            revision_basis=revision_basis,
        )
        pause_task(c)
        return prepared

    monkeypatch.setattr(compiler, "compile", compile_then_pause)
    with pytest.raises(BuilderExecutionPolicyError, match="native_revision_drift"):
        c.api.start(
            actor=c.actor,
            session_id="session",
            test_input_id="input",
            expected_version=1,
            mode="native",
            idempotency_key="cancel-composed-start",
        )
    assert c.rows[NativeDispatch] == []
    assert c.published == []


def test_effect_dispatch_claim_is_fenced_after_task_stop_before_native_cancel(
    cancel_composition: CancellationCase, monkeypatch: pytest.MonkeyPatch
) -> None:
    c = cancel_composition
    ref = decode_native_ref(c.published[0]["ref"])
    service = EffectAuthorizationService(c.api.loader)
    effect = intent().model_copy(update={"key": intent().key.model_copy(update={"invocation_id": ref.invocation_id})})
    permit = DispatchPermit(
        permit_id="permit",
        attempt_id="attempt",
        operation_id="operation",
        expires_at=(datetime.now(UTC) + timedelta(minutes=5)).isoformat(),
    )
    # The permit read is an explicit boundary; the real loader and claim entry
    # stay live. An unpaused positive control reaches the next claim validation.
    monkeypatch.setattr(service, "_permit_ref", lambda _: ref)
    validations = []

    def validate(**_kwargs: object) -> NoReturn:
        validations.append("claim")
        raise RuntimeError("dispatch validation reached")

    monkeypatch.setattr(service, "_validate_dispatch_locked", validate)
    with pytest.raises(RuntimeError, match="dispatch validation reached"):
        service.claim_dispatch(ref=ref, intent=effect, permit=permit)
    pause_task(c)
    with pytest.raises(BuilderExecutionPolicyError, match="native_revision_drift"):
        service.claim_dispatch(ref=ref, intent=effect, permit=permit)
    assert validations == ["claim"]


def test_host_capacity_claim_cannot_bypass_paused_task_as_settlement(
    cancel_composition: CancellationCase, monkeypatch: pytest.MonkeyPatch
) -> None:
    c = cancel_composition
    message = c.published[0]
    ref = decode_native_ref(message["ref"])

    class CleanupVerifier:
        def consume_cleanup(self, **_kwargs: object) -> None:
            pytest.fail("capacity admission must not request cleanup")

    delivery = NativeHostCapacity(c.api.lifecycle, cleanup_verifier=CleanupVerifier())
    dispatch = c.rows[NativeDispatch][0]
    assert isinstance(dispatch, NativeDispatch)
    original_state = dispatch.state
    scans = []

    def scan(*_args: object) -> NoReturn:
        scans.append("capacity")
        raise RuntimeError("capacity scan reached")

    # Occupancy is a separate SQL-join boundary. The unpaused positive control
    # reaches it; paused admission must stop before it or any physical claim.
    monkeypatch.setattr(delivery, "_occupants", scan)
    with pytest.raises(RuntimeError, match="capacity scan reached"):
        delivery.claim_dispatch(ref=ref, generation=0, dispatch_id=dispatch_identity(message))
    pause_task(c)
    with pytest.raises(BuilderExecutionPolicyError, match="native_revision_drift"):
        delivery.claim_dispatch(ref=ref, generation=0, dispatch_id=dispatch_identity(message))
    dispatch = c.rows[NativeDispatch][0]
    assert isinstance(dispatch, NativeDispatch)
    assert dispatch.state == original_state
    assert scans == ["capacity"]


def test_task_stop_still_allows_native_cancellation_and_evidence_settlement(
    cancel_composition: CancellationCase,
) -> None:
    c = cancel_composition
    ref = decode_native_ref(c.published[0]["ref"])
    pause_task(c)
    with c.api.loader.locked(ref=ref, settlement=True):
        pass
    receipt = c.api.cancel(
        actor=c.actor, session_id="session", request_id=c.started.request_id, idempotency_key="after-task-stop"
    )
    assert receipt.status == "terminal"
    assert receipt.cancellation is not None
    assert receipt.cancellation.status == "cancelled"
