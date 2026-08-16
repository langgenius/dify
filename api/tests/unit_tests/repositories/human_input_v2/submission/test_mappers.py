"""Explicit domain/record mapping contracts for submission and shared audit facts."""

from datetime import datetime

import pytest

from core.human_input_v2.approval import (
    AccountSubmissionActor,
    ContactOTPSubject,
    EmailAddressOTPSubject,
    EmailAddressSubmissionActor,
    EndUserSubmissionActor,
    FormAuthorizationAuditEvent,
    FormAuthorizationAuditEventType,
    FormRef,
    FormSubmission,
    VerifiedAccountSessionProof,
    VerifiedEmailOTPProof,
    VerifiedIMIdentityProof,
    VerifiedTrustedEndUserProof,
)
from core.human_input_v2.entities import (
    HumanInputApproverGrantSubjectType,
    HumanInputDeliveryChannel,
    HumanInputSubmissionActorType,
    IMProvider,
)
from core.human_input_v2.shared import (
    AccountId,
    AppId,
    ApproverGrantId,
    AuditEventId,
    ContactId,
    DeliveryEndpointId,
    EndUserId,
    FormId,
    IMBindingId,
    IMIdentityId,
    IntegrationId,
    NormalizedEmail,
    OTPChallengeId,
    SubmissionId,
    TenantId,
)
from models.human_input_v2 import (
    EmailOTPAuthorizationProof,
    FormCanonicalValues,
    FormInputSnapshot,
    HumanInputV2FormAuditEvent,
    HumanInputV2FormSubmission,
)
from repositories.human_input_v2.submission.mappers import (
    audit_event_from_record,
    audit_event_to_record,
    proof_from_record_value,
    proof_to_record_value,
    submission_from_record,
    submission_to_record,
)

_NOW = datetime(2026, 7, 25, 8)
_FORM_REF = FormRef(TenantId("workspace-1"), FormId("form-1"))
_GRANT_ID = ApproverGrantId("grant-1")
_ENDPOINT_ID = DeliveryEndpointId("endpoint-1")
_EMAIL = NormalizedEmail("reviewer@example.com")


def _email_proof() -> VerifiedEmailOTPProof:
    return VerifiedEmailOTPProof(
        challenge_ref=_FORM_REF.grant(_GRANT_ID).challenge(OTPChallengeId("challenge-1")),
        subject=ContactOTPSubject(ContactId("contact-1")),
        normalized_email=_EMAIL,
        verified_at=_NOW,
    )


def _standalone_email_proof() -> VerifiedEmailOTPProof:
    return VerifiedEmailOTPProof(
        challenge_ref=_FORM_REF.grant(_GRANT_ID).challenge(OTPChallengeId("challenge-2")),
        subject=EmailAddressOTPSubject(_EMAIL),
        normalized_email=_EMAIL,
        verified_at=_NOW,
    )


@pytest.mark.parametrize(
    "proof",
    [
        VerifiedAccountSessionProof(AccountId("account-1")),
        VerifiedTrustedEndUserProof(EndUserId("end-user-1"), AppId("app-1")),
        _email_proof(),
        _standalone_email_proof(),
        VerifiedIMIdentityProof(
            integration_id=IntegrationId("integration-1"),
            identity_id=IMIdentityId("identity-1"),
            binding_id=IMBindingId("binding-1"),
            provider=IMProvider.SLACK,
            provider_tenant_id="provider-tenant-1",
            provider_user_id="provider-user-1",
        ),
        VerifiedIMIdentityProof(
            integration_id=IntegrationId("integration-1"),
            identity_id=IMIdentityId("identity-1"),
            binding_id=None,
            provider=IMProvider.SLACK,
            provider_tenant_id="provider-tenant-1",
            provider_user_id="provider-user-1",
        ),
    ],
)
def test_verified_proof_values_round_trip_without_raw_credentials(proof) -> None:
    record_value = proof_to_record_value(proof)

    assert proof_from_record_value(record_value, tenant_id=_FORM_REF.tenant_id) == proof
    assert "token" not in record_value.model_dump()
    assert "plaintext" not in record_value.model_dump()


@pytest.mark.parametrize(
    "actor",
    [
        AccountSubmissionActor(AccountId("account-1")),
        EndUserSubmissionActor(EndUserId("end-user-1")),
        EmailAddressSubmissionActor(_EMAIL),
    ],
)
def test_submission_actor_and_structured_values_round_trip(actor) -> None:
    submission = FormSubmission(
        id=SubmissionId("submission-1"),
        form_ref=_FORM_REF,
        approver_grant_id=_GRANT_ID,
        endpoint_id=_ENDPOINT_ID,
        authorization_audit_event_id=AuditEventId("audit-1"),
        actor=actor,
        selected_action_id="approve",
        input_snapshot={"reason": "Looks good", "score": 3},
        canonical_values={"reason": "Looks good", "score": 3},
        submitted_at=_NOW,
        created_at=_NOW,
        updated_at=_NOW,
    )

    record = submission_to_record(submission)

    assert submission_from_record(record) == submission
    assert record.input_snapshot.root == {"reason": "Looks good", "score": 3}
    assert record.canonical_values.root == {"reason": "Looks good", "score": 3}


def test_submission_mapper_rejects_malformed_actor_columns() -> None:
    record = HumanInputV2FormSubmission(
        tenant_id="workspace-1",
        form_id="form-1",
        approver_grant_id="grant-1",
        actor_type=HumanInputSubmissionActorType.ACCOUNT,
        authorization_audit_event_id="audit-1",
        selected_action_id="approve",
        input_snapshot=FormInputSnapshot({"value": 1}),
        canonical_values=FormCanonicalValues({"value": 1}),
        submitted_at=_NOW,
        actor_account_id="account-1",
        actor_end_user_id="end-user-1",
        actor_normalized_email=None,
        endpoint_id=None,
    )
    record.id = "submission-1"
    record.created_at = _NOW
    record.updated_at = _NOW

    with pytest.raises(ValueError, match="actor columns"):
        submission_from_record(record)

    record.actor_end_user_id = None
    record.actor_type = HumanInputSubmissionActorType.END_USER
    with pytest.raises(ValueError, match="discriminator"):
        submission_from_record(record)


def test_submission_mapper_rejects_malformed_structured_values() -> None:
    submission = FormSubmission(
        id=SubmissionId("submission-1"),
        form_ref=_FORM_REF,
        approver_grant_id=_GRANT_ID,
        endpoint_id=None,
        authorization_audit_event_id=AuditEventId("audit-1"),
        actor=AccountSubmissionActor(AccountId("account-1")),
        selected_action_id="approve",
        input_snapshot={"value": 1},
        canonical_values={"value": 1},
        submitted_at=_NOW,
        created_at=_NOW,
        updated_at=_NOW,
    )
    record = submission_to_record(submission)
    record.input_snapshot = {"value": 1}  # type: ignore[assignment]

    with pytest.raises(ValueError, match="malformed structured values"):
        submission_from_record(record)


@pytest.mark.parametrize(
    "event",
    [
        FormAuthorizationAuditEvent(
            id=AuditEventId("audit-authorized"),
            event_type=FormAuthorizationAuditEventType.SUBMISSION_AUTHORIZED,
            form_ref=_FORM_REF,
            approver_grant_id=_GRANT_ID,
            endpoint_id=_ENDPOINT_ID,
            channel=HumanInputDeliveryChannel.IM,
            reason_code=None,
            reason_message=None,
            authorization_proof=_email_proof(),
            payload={"selected_action_id": "approve"},
            occurred_at=_NOW,
            created_at=_NOW,
            updated_at=_NOW,
        ),
        FormAuthorizationAuditEvent(
            id=AuditEventId("audit-otp-issued"),
            event_type=FormAuthorizationAuditEventType.OTP_CHALLENGE_ISSUED,
            form_ref=_FORM_REF,
            approver_grant_id=_GRANT_ID,
            endpoint_id=None,
            channel=HumanInputDeliveryChannel.EMAIL,
            reason_code=None,
            reason_message=None,
            authorization_proof=None,
            payload=None,
            occurred_at=_NOW,
            created_at=_NOW,
            updated_at=_NOW,
        ),
        FormAuthorizationAuditEvent(
            id=AuditEventId("audit-rejected"),
            event_type=FormAuthorizationAuditEventType.SUBMISSION_REJECTED,
            form_ref=_FORM_REF,
            approver_grant_id=_GRANT_ID,
            endpoint_id=None,
            channel=HumanInputDeliveryChannel.WEB,
            reason_code="stale_identity",
            reason_message="Current identity no longer matches the verified proof.",
            authorization_proof=None,
            payload={"proof_type": "email_otp"},
            occurred_at=_NOW,
            created_at=_NOW,
            updated_at=_NOW,
        ),
    ],
)
def test_authorized_and_rejected_audit_events_have_distinct_round_trips(event) -> None:
    record = audit_event_to_record(event)

    assert audit_event_from_record(record) == event
    assert record.event_type == event.event_type.value


def test_audit_mapper_rejects_authorized_event_without_verified_proof() -> None:
    record = HumanInputV2FormAuditEvent(
        tenant_id="workspace-1",
        form_id="form-1",
        event_type=FormAuthorizationAuditEventType.SUBMISSION_AUTHORIZED.value,
        occurred_at=_NOW,
        approver_grant_id="grant-1",
        endpoint_id=None,
        channel=HumanInputDeliveryChannel.WEB,
        reason_code=None,
        reason_message=None,
        authorization_proof=None,
        event_payload=None,
    )
    record.id = "audit-1"
    record.created_at = _NOW
    record.updated_at = _NOW

    with pytest.raises(ValueError, match="verified proof"):
        audit_event_from_record(record)


@pytest.mark.parametrize(
    ("subject_type", "contact_id", "expected"),
    [
        (HumanInputApproverGrantSubjectType.CONTACT, None, "missing contact_id"),
        (HumanInputApproverGrantSubjectType.EMAIL_ADDRESS, "contact-1", "must not contain contact_id"),
    ],
)
def test_email_proof_mapper_rejects_inconsistent_subject_columns(
    subject_type: HumanInputApproverGrantSubjectType,
    contact_id: str | None,
    expected: str,
) -> None:
    record_value = EmailOTPAuthorizationProof(
        otp_challenge_id="challenge-1",
        tenant_id=str(_FORM_REF.tenant_id),
        form_id="form-1",
        approver_grant_id="grant-1",
        subject_type=subject_type,
        contact_id=contact_id,
        verified_email=str(_EMAIL),
        verified_at=_NOW,
    )

    with pytest.raises(ValueError, match=expected):
        proof_from_record_value(record_value, tenant_id=_FORM_REF.tenant_id)


def test_email_proof_mapper_rejects_unsupported_subject_type() -> None:
    record_value = EmailOTPAuthorizationProof.model_construct(
        otp_challenge_id="challenge-1",
        tenant_id=str(_FORM_REF.tenant_id),
        form_id="form-1",
        approver_grant_id="grant-1",
        subject_type="end_user",
        contact_id=None,
        verified_email=str(_EMAIL),
        verified_at=_NOW,
    )

    with pytest.raises(ValueError, match="unsupported subject type"):
        proof_from_record_value(record_value, tenant_id=_FORM_REF.tenant_id)


@pytest.mark.parametrize(
    ("proof_form_ref", "proof_grant_id"),
    [
        (FormRef(TenantId("workspace-2"), _FORM_REF.form_id), _GRANT_ID),
        (FormRef(_FORM_REF.tenant_id, FormId("form-2")), _GRANT_ID),
        (_FORM_REF, ApproverGrantId("grant-2")),
    ],
)
def test_authorized_email_audit_event_rejects_proof_from_another_owner(
    proof_form_ref: FormRef,
    proof_grant_id: ApproverGrantId,
) -> None:
    proof = VerifiedEmailOTPProof(
        challenge_ref=proof_form_ref.grant(proof_grant_id).challenge(OTPChallengeId("challenge-1")),
        subject=ContactOTPSubject(ContactId("contact-1")),
        normalized_email=_EMAIL,
        verified_at=_NOW,
    )

    with pytest.raises(ValueError, match="proof owner"):
        FormAuthorizationAuditEvent(
            id=AuditEventId("audit-1"),
            event_type=FormAuthorizationAuditEventType.SUBMISSION_AUTHORIZED,
            form_ref=_FORM_REF,
            approver_grant_id=_GRANT_ID,
            endpoint_id=_ENDPOINT_ID,
            channel=HumanInputDeliveryChannel.EMAIL,
            reason_code=None,
            reason_message=None,
            authorization_proof=proof,
            payload=None,
            occurred_at=_NOW,
            created_at=_NOW,
            updated_at=_NOW,
        )


def test_audit_mapper_write_revalidates_authorized_email_proof_owner() -> None:
    event = FormAuthorizationAuditEvent(
        id=AuditEventId("audit-1"),
        event_type=FormAuthorizationAuditEventType.SUBMISSION_AUTHORIZED,
        form_ref=_FORM_REF,
        approver_grant_id=_GRANT_ID,
        endpoint_id=_ENDPOINT_ID,
        channel=HumanInputDeliveryChannel.EMAIL,
        reason_code=None,
        reason_message=None,
        authorization_proof=_email_proof(),
        payload=None,
        occurred_at=_NOW,
        created_at=_NOW,
        updated_at=_NOW,
    )
    object.__setattr__(event, "form_ref", FormRef(TenantId("workspace-2"), _FORM_REF.form_id))

    with pytest.raises(ValueError, match="proof owner"):
        audit_event_to_record(event)


@pytest.mark.parametrize(
    ("proof_tenant_id", "proof_form_id", "proof_grant_id"),
    [
        ("workspace-2", "form-1", "grant-1"),
        ("workspace-1", "form-2", "grant-1"),
        ("workspace-1", "form-1", "grant-2"),
    ],
)
def test_audit_mapper_read_rejects_authorized_email_proof_from_another_owner(
    proof_tenant_id: str,
    proof_form_id: str,
    proof_grant_id: str,
) -> None:
    record = HumanInputV2FormAuditEvent(
        tenant_id="workspace-1",
        form_id="form-1",
        event_type=FormAuthorizationAuditEventType.SUBMISSION_AUTHORIZED.value,
        occurred_at=_NOW,
        approver_grant_id="grant-1",
        endpoint_id=None,
        channel=HumanInputDeliveryChannel.EMAIL,
        reason_code=None,
        reason_message=None,
        authorization_proof=EmailOTPAuthorizationProof(
            otp_challenge_id="challenge-1",
            tenant_id=proof_tenant_id,
            form_id=proof_form_id,
            approver_grant_id=proof_grant_id,
            subject_type=HumanInputApproverGrantSubjectType.CONTACT,
            contact_id="contact-1",
            verified_email=str(_EMAIL),
            verified_at=_NOW,
        ),
        event_payload=None,
    )
    record.id = "audit-1"
    record.created_at = _NOW
    record.updated_at = _NOW

    with pytest.raises(ValueError, match="proof owner"):
        audit_event_from_record(record)


def test_audit_mapper_rejects_unknown_event_type_and_malformed_payload() -> None:
    record = HumanInputV2FormAuditEvent(
        tenant_id="workspace-1",
        form_id="form-1",
        event_type="unknown",
        occurred_at=_NOW,
        approver_grant_id="grant-1",
        endpoint_id=None,
        channel=HumanInputDeliveryChannel.WEB,
        reason_code=None,
        reason_message=None,
        authorization_proof=None,
        event_payload=None,
    )
    record.id = "audit-1"
    record.created_at = _NOW
    record.updated_at = _NOW

    with pytest.raises(ValueError, match="unsupported event type"):
        audit_event_from_record(record)

    record.event_type = FormAuthorizationAuditEventType.SUBMISSION_REJECTED.value
    record.reason_code = "stale_identity"
    record.event_payload = {"proof_type": "email_otp"}  # type: ignore[assignment]
    with pytest.raises(ValueError, match="malformed structured payload"):
        audit_event_from_record(record)


def test_record_values_reject_inconsistent_event_and_submission_invariants() -> None:
    authorized_proof = _email_proof()
    base_event = {
        "id": AuditEventId("audit-1"),
        "event_type": FormAuthorizationAuditEventType.SUBMISSION_AUTHORIZED,
        "form_ref": _FORM_REF,
        "endpoint_id": None,
        "channel": HumanInputDeliveryChannel.EMAIL,
        "reason_message": None,
        "payload": None,
        "occurred_at": _NOW,
        "created_at": _NOW,
        "updated_at": _NOW,
    }

    with pytest.raises(ValueError, match="requires a grant"):
        FormAuthorizationAuditEvent(
            **base_event,
            approver_grant_id=None,
            reason_code=None,
            authorization_proof=authorized_proof,
        )
    with pytest.raises(ValueError, match="verified proof"):
        FormAuthorizationAuditEvent(
            **base_event,
            approver_grant_id=_GRANT_ID,
            reason_code=None,
            authorization_proof=None,
        )
    with pytest.raises(ValueError, match="cannot contain"):
        FormAuthorizationAuditEvent(
            **base_event,
            approver_grant_id=_GRANT_ID,
            reason_code="unexpected",
            authorization_proof=authorized_proof,
        )
    with pytest.raises(ValueError, match="requires a stable reason code"):
        FormAuthorizationAuditEvent(
            **(base_event | {"event_type": FormAuthorizationAuditEventType.SUBMISSION_REJECTED}),
            approver_grant_id=_GRANT_ID,
            reason_code=None,
            authorization_proof=None,
        )
    with pytest.raises(ValueError, match="must not be blank"):
        FormSubmission(
            id=SubmissionId("submission-1"),
            form_ref=_FORM_REF,
            approver_grant_id=_GRANT_ID,
            endpoint_id=None,
            authorization_audit_event_id=AuditEventId("audit-1"),
            actor=AccountSubmissionActor(AccountId("account-1")),
            selected_action_id="  ",
            input_snapshot={},
            canonical_values={},
            submitted_at=_NOW,
            created_at=_NOW,
            updated_at=_NOW,
        )
