"""Versioned Console protocol. No request carries execution authority or inputs.

GET /dify-builder/sessions/{session_id}/native-test-input returns the current
saved-input binding, not plaintext inputs or a permit. Prefer existing Builder
test actions: current test_execution is included in session/ordinary SSE
projections. The old opt-in native stream remains compatible. Standalone
POST /native-tests remains a separately qualified legacy runtime capability;
obtaining a binding does not establish equivalent confirmed-run support.

Saved pending decisions freeze the corresponding card across refresh. Order
those facts by (generation, decision_public_revision); ``version`` retains its
execution-state meaning. Expiry/exhaustion can change readiness without a new
decision. ``can_resume`` is an advisory read-only policy check; resume repeats
those checks under its existing request lock. Configuration/form references
currently have no qualified public navigation/resolution binding and explicitly
report native_resolution_unavailable. No history of retired pending cards is
implied by this current-state projection.
"""

from typing import Literal, Self

from pydantic import model_validator

from runtime_contracts.builder.execution import Digest
from runtime_contracts.builder.native.approval_contracts import NativeApprovalTerms
from runtime_contracts.builder.native.contracts import (
    ID,
    CancellationReceipt,
    Counter,
    FiniteJSON,
    FrozenDTO,
    WaitReason,
)


class NativeTestInputBinding(FrozenDTO):
    """Binding only; ordinary Builder actions remain the preferred start path."""

    test_input_id: ID
    expected_version: Counter
    workflow_id: ID
    graph_revision: Digest
    preferred_start: Literal["builder_action"] = "builder_action"
    direct_start_capability: Literal["requires_runtime_qualification"] = "requires_runtime_qualification"


class NativeTestStartPayload(FrozenDTO):
    schema_version: Literal["builder-native-test-v1"]
    test_input_id: ID
    expected_version: Counter
    mode: Literal["native", "mock"]
    idempotency_key: ID


class NativeTestDecisionPayload(FrozenDTO):
    schema_version: Literal["builder-native-test-v1"]
    pending_operation_id: ID
    decision: Literal["confirm", "deny"]
    scope_digest: Digest
    expected_version: Counter
    idempotency_key: ID


class NativeTestResumePayload(FrozenDTO):
    schema_version: Literal["builder-native-test-v1"]
    expected_generation: Counter
    idempotency_key: ID


class NativeTestCancelPayload(FrozenDTO):
    schema_version: Literal["builder-native-test-v1"]
    idempotency_key: ID


class PendingActionDisclosure(FrozenDTO):
    pending_operation_id: ID
    wait_reason: WaitReason
    version: Counter
    scope_digest: Digest | None
    account_label: str | None
    action: str
    target: FiniteJSON
    parameters_summary: FiniteJSON
    risk_notice: str | None
    required_configuration: tuple[ID, ...]
    native_form_ref: ID | None
    approval_limits: NativeApprovalTerms | None
    decision: Literal["confirm", "deny"] | None = None
    decision_status: Literal["awaiting_decision", "confirmed", "denied", "expired", "exhausted"] | None = None
    continuation_blocked_reason: Literal["native_resolution_unavailable"] | None = None

    @model_validator(mode="after")
    def validate_category(self) -> Self:
        if self.wait_reason == "approval":
            if (
                self.approval_limits is None
                or self.scope_digest is None
                or self.required_configuration
                or self.native_form_ref
            ):
                raise ValueError("approval requires disclosed immutable terms")
        elif self.decision is not None or self.decision_status is not None:
            raise ValueError("non-approval cannot carry a saved decision")
        elif self.approval_limits is not None or self.scope_digest is not None:
            raise ValueError("non-approval cannot carry approval authority")
        return self


class NativeTestPublicReceipt(FrozenDTO):
    schema_version: Literal["builder-native-test-v1"] = "builder-native-test-v1"
    request_id: ID
    generation: Counter
    version: Counter
    status: Literal["prepared", "running", "waiting", "terminal"]
    wait_reason: WaitReason | None
    native_run_id: ID | None
    native_status: str | None
    pending: tuple[PendingActionDisclosure, ...]
    outcome: Literal["succeeded", "failed", "cancelled", "unknown"] | None
    evidence_refs: tuple[ID, ...]
    cancellation: CancellationReceipt | None = None
    # Order with generation; version retains its existing execution semantics.
    decision_public_revision: Counter = 0
    can_resume: bool = False
    resume_blocked_reason: (
        Literal["not_waiting", "approval_required", "native_resolution_unavailable", "state_unavailable"] | None
    ) = "state_unavailable"
