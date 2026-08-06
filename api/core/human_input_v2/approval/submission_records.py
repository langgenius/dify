"""Submission and shared authorization-audit persistence values.

These values preserve business identity and structured snapshots without
exposing ORM records. Persistence mappers alone translate them to storage
columns and Pydantic JSON values.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from enum import StrEnum

from pydantic import JsonValue

from core.human_input_v2.entities import HumanInputDeliveryChannel
from core.human_input_v2.shared import (
    ApproverGrantId,
    AuditEventId,
    DeliveryEndpointId,
    SubmissionId,
    UtcTimestamp,
)

from .grants import FormRef
from .submission_authorization import SubmissionActor, VerifiedEmailOTPProof, VerifiedSubmissionProof


class FormAuthorizationAuditEventType(StrEnum):
    """Stable append-only event names owned by the shared audit table."""

    OTP_CHALLENGE_ISSUED = "otp_challenge_issued"
    SUBMISSION_AUTHORIZED = "submission_authorized"
    SUBMISSION_REJECTED = "submission_rejected"


@dataclass(frozen=True, slots=True)
class FormAuthorizationAuditEvent:
    """Secret-free authorized, rejected, or OTP issuance audit fact."""

    id: AuditEventId
    event_type: FormAuthorizationAuditEventType
    form_ref: FormRef
    approver_grant_id: ApproverGrantId | None
    endpoint_id: DeliveryEndpointId | None
    channel: HumanInputDeliveryChannel | None
    reason_code: str | None
    reason_message: str | None
    authorization_proof: VerifiedSubmissionProof | None
    payload: Mapping[str, JsonValue] | None
    occurred_at: UtcTimestamp
    created_at: UtcTimestamp
    updated_at: UtcTimestamp

    def __post_init__(self) -> None:
        if self.event_type is FormAuthorizationAuditEventType.SUBMISSION_AUTHORIZED:
            if self.approver_grant_id is None or self.authorization_proof is None:
                raise ValueError("authorized audit event requires a grant and verified proof")
            if self.reason_code is not None:
                raise ValueError("authorized audit event cannot contain a rejection reason")
            self.validate_authorization_proof_owner()
        if self.event_type is FormAuthorizationAuditEventType.SUBMISSION_REJECTED and not self.reason_code:
            raise ValueError("rejected audit event requires a stable reason code")

    def validate_authorization_proof_owner(self) -> None:
        """Reject authorized Email evidence captured for another form or grant."""

        proof = self.authorization_proof
        if not isinstance(proof, VerifiedEmailOTPProof):
            return
        if (
            proof.challenge_ref.form_ref != self.form_ref
            or proof.challenge_ref.grant_ref.grant_id != self.approver_grant_id
        ):
            raise ValueError("authorized Email proof owner does not match the audit event")


@dataclass(frozen=True, slots=True)
class FormSubmission:
    """Winning submission mapped independently from ORM lifetime."""

    id: SubmissionId
    form_ref: FormRef
    approver_grant_id: ApproverGrantId
    endpoint_id: DeliveryEndpointId | None
    authorization_audit_event_id: AuditEventId
    actor: SubmissionActor
    selected_action_id: str
    input_snapshot: Mapping[str, JsonValue]
    canonical_values: Mapping[str, JsonValue]
    submitted_at: UtcTimestamp
    created_at: UtcTimestamp
    updated_at: UtcTimestamp

    def __post_init__(self) -> None:
        if not self.selected_action_id.strip():
            raise ValueError("submission selected action must not be blank")


__all__ = [
    "FormAuthorizationAuditEvent",
    "FormAuthorizationAuditEventType",
    "FormSubmission",
]
