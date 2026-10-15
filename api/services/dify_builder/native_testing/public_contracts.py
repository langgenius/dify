"""Versioned Console protocol. No request carries execution authority or inputs."""

from typing import Literal, Self

from pydantic import model_validator

from services.dify_builder.execution_contracts import Digest
from services.dify_builder.native_testing.approval_contracts import NativeApprovalTerms
from services.dify_builder.native_testing.contracts import (
    ID,
    CancellationReceipt,
    Counter,
    FiniteJSON,
    FrozenDTO,
    WaitReason,
)


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
