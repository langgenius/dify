"""Explicit mappings for verified proof, actor, submission, and audit records."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime
from typing import assert_never

from pydantic import JsonValue, NaiveDatetime, TypeAdapter

from core.human_input_v2.approval import (
    AccountSubmissionActor,
    ContactOTPSubject,
    EmailAddressOTPSubject,
    EmailAddressSubmissionActor,
    EmailOTPSubject,
    EndUserSubmissionActor,
    FormAuthorizationAuditEvent,
    FormAuthorizationAuditEventType,
    FormRef,
    FormSubmission,
    SubmissionActor,
    VerifiedAccountSessionProof,
    VerifiedEmailOTPProof,
    VerifiedIMIdentityProof,
    VerifiedSubmissionProof,
    VerifiedTrustedEndUserProof,
)
from core.human_input_v2.entities import (
    HumanInputApproverGrantSubjectType,
    HumanInputSubmissionActorType,
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
from libs.datetime_utils import ensure_naive_utc
from models.human_input_v2 import (
    AccountSessionAuthorizationProof,
    EmailOTPAuthorizationProof,
    FormAuditEventPayload,
    FormAuthorizationProof,
    FormCanonicalValues,
    FormInputSnapshot,
    HumanInputV2FormAuditEvent,
    HumanInputV2FormSubmission,
    IMIdentityAuthorizationProof,
    TrustedEndUserAuthorizationProof,
)

_JSON_OBJECT_ADAPTER: TypeAdapter[dict[str, JsonValue]] = TypeAdapter(dict[str, JsonValue])


def _timestamp(value: datetime) -> NaiveDatetime:
    return ensure_naive_utc(value)


def proof_to_record_value(proof: VerifiedSubmissionProof) -> FormAuthorizationProof:
    """Serialize verified evidence without introducing reusable credentials."""

    match proof:
        case VerifiedAccountSessionProof(account_id=account_id):
            return AccountSessionAuthorizationProof(account_id=str(account_id))
        case VerifiedTrustedEndUserProof(end_user_id=end_user_id, app_id=app_id):
            return TrustedEndUserAuthorizationProof(app_id=str(app_id), end_user_id=str(end_user_id))
        case VerifiedEmailOTPProof() as email_proof:
            subject_type = HumanInputApproverGrantSubjectType.EMAIL_ADDRESS
            contact_id: str | None = None
            if isinstance(email_proof.subject, ContactOTPSubject):
                subject_type = HumanInputApproverGrantSubjectType.CONTACT
                contact_id = str(email_proof.subject.contact_id)
            return EmailOTPAuthorizationProof(
                otp_challenge_id=str(email_proof.challenge_ref.challenge_id),
                tenant_id=str(email_proof.challenge_ref.form_ref.tenant_id),
                form_id=str(email_proof.challenge_ref.form_ref.form_id),
                approver_grant_id=str(email_proof.challenge_ref.grant_ref.grant_id),
                subject_type=subject_type,
                contact_id=contact_id,
                verified_email=str(email_proof.normalized_email),
                verified_at=email_proof.verified_at,
            )
        case VerifiedIMIdentityProof() as im_proof:
            return IMIdentityAuthorizationProof(
                integration_id=str(im_proof.integration_id),
                im_identity_id=str(im_proof.identity_id),
                im_binding_id=str(im_proof.binding_id) if im_proof.binding_id is not None else None,
                provider=im_proof.provider,
                provider_tenant_id=im_proof.provider_tenant_id,
                provider_user_id=im_proof.provider_user_id,
            )
    assert_never(proof)


def proof_from_record_value(
    record_value: FormAuthorizationProof,
    *,
    tenant_id: TenantId,
) -> VerifiedSubmissionProof:
    """Rebuild verified evidence using the owner scope from its audit record."""

    match record_value:
        case AccountSessionAuthorizationProof(account_id=account_id):
            return VerifiedAccountSessionProof(AccountId(account_id))
        case TrustedEndUserAuthorizationProof(app_id=app_id, end_user_id=end_user_id):
            return VerifiedTrustedEndUserProof(EndUserId(end_user_id), AppId(app_id))
        case EmailOTPAuthorizationProof() as email_proof:
            if email_proof.tenant_id != str(tenant_id):
                raise ValueError("authorized Email proof owner does not match the audit event")
            normalized_email = NormalizedEmail(email_proof.verified_email)
            subject: EmailOTPSubject
            if email_proof.subject_type is HumanInputApproverGrantSubjectType.CONTACT:
                if email_proof.contact_id is None:
                    raise ValueError("contact Email proof record is missing contact_id")
                subject = ContactOTPSubject(ContactId(email_proof.contact_id))
            elif email_proof.subject_type is HumanInputApproverGrantSubjectType.EMAIL_ADDRESS:
                if email_proof.contact_id is not None:
                    raise ValueError("EmailAddress proof record must not contain contact_id")
                subject = EmailAddressOTPSubject(normalized_email)
            else:
                raise ValueError("Email proof record has an unsupported subject type")
            challenge_ref = (
                FormRef(tenant_id, FormId(email_proof.form_id))
                .grant(ApproverGrantId(email_proof.approver_grant_id))
                .challenge(OTPChallengeId(email_proof.otp_challenge_id))
            )
            return VerifiedEmailOTPProof(
                challenge_ref=challenge_ref,
                subject=subject,
                normalized_email=normalized_email,
                verified_at=_timestamp(email_proof.verified_at),
            )
        case IMIdentityAuthorizationProof() as im_proof:
            return VerifiedIMIdentityProof(
                integration_id=IntegrationId(im_proof.integration_id),
                identity_id=IMIdentityId(im_proof.im_identity_id),
                binding_id=IMBindingId(im_proof.im_binding_id) if im_proof.im_binding_id is not None else None,
                provider=im_proof.provider,
                provider_tenant_id=im_proof.provider_tenant_id,
                provider_user_id=im_proof.provider_user_id,
            )
    assert_never(record_value)


@dataclass(frozen=True, slots=True)
class SubmissionActorRecordFields:
    """Exactly one populated actor column selected by its discriminator."""

    actor_type: HumanInputSubmissionActorType
    account_id: str | None
    end_user_id: str | None
    normalized_email: str | None


def _actor_to_record_fields(actor: SubmissionActor) -> SubmissionActorRecordFields:
    match actor:
        case AccountSubmissionActor(account_id=account_id):
            return SubmissionActorRecordFields(HumanInputSubmissionActorType.ACCOUNT, str(account_id), None, None)
        case EndUserSubmissionActor(end_user_id=end_user_id):
            return SubmissionActorRecordFields(HumanInputSubmissionActorType.END_USER, None, str(end_user_id), None)
        case EmailAddressSubmissionActor(normalized_email=normalized_email):
            return SubmissionActorRecordFields(
                HumanInputSubmissionActorType.EMAIL_ADDRESS,
                None,
                None,
                str(normalized_email),
            )
    assert_never(actor)


def _actor_from_record(record: HumanInputV2FormSubmission) -> SubmissionActor:
    actor_columns = (
        record.actor_account_id is not None,
        record.actor_end_user_id is not None,
        record.actor_normalized_email is not None,
    )
    if sum(actor_columns) != 1:
        raise ValueError("submission actor columns must contain exactly one identity")
    if record.actor_type is HumanInputSubmissionActorType.ACCOUNT and record.actor_account_id is not None:
        return AccountSubmissionActor(AccountId(record.actor_account_id))
    if record.actor_type is HumanInputSubmissionActorType.END_USER and record.actor_end_user_id is not None:
        return EndUserSubmissionActor(EndUserId(record.actor_end_user_id))
    if record.actor_type is HumanInputSubmissionActorType.EMAIL_ADDRESS and record.actor_normalized_email is not None:
        return EmailAddressSubmissionActor(NormalizedEmail(record.actor_normalized_email))
    raise ValueError("submission actor discriminator does not match its actor columns")


def submission_to_record(submission: FormSubmission) -> HumanInputV2FormSubmission:
    """Map one detached winning submission to an ORM record."""

    actor_fields = _actor_to_record_fields(submission.actor)
    record = HumanInputV2FormSubmission(
        tenant_id=str(submission.form_ref.tenant_id),
        form_id=str(submission.form_ref.form_id),
        approver_grant_id=str(submission.approver_grant_id),
        actor_type=actor_fields.actor_type,
        authorization_audit_event_id=str(submission.authorization_audit_event_id),
        selected_action_id=submission.selected_action_id,
        input_snapshot=FormInputSnapshot(_json_object(submission.input_snapshot)),
        canonical_values=FormCanonicalValues(_json_object(submission.canonical_values)),
        submitted_at=submission.submitted_at,
        actor_account_id=actor_fields.account_id,
        actor_end_user_id=actor_fields.end_user_id,
        actor_normalized_email=actor_fields.normalized_email,
        endpoint_id=str(submission.endpoint_id) if submission.endpoint_id is not None else None,
    )
    record.id = str(submission.id)
    record.created_at = submission.created_at
    record.updated_at = submission.updated_at
    return record


def submission_from_record(record: HumanInputV2FormSubmission) -> FormSubmission:
    """Rebuild one submission while validating its actor and structured values."""

    if not isinstance(record.input_snapshot, FormInputSnapshot) or not isinstance(
        record.canonical_values, FormCanonicalValues
    ):
        raise ValueError("submission record has malformed structured values")
    return FormSubmission(
        id=SubmissionId(record.id),
        form_ref=FormRef(TenantId(record.tenant_id), FormId(record.form_id)),
        approver_grant_id=ApproverGrantId(record.approver_grant_id),
        endpoint_id=DeliveryEndpointId(record.endpoint_id) if record.endpoint_id is not None else None,
        authorization_audit_event_id=AuditEventId(record.authorization_audit_event_id),
        actor=_actor_from_record(record),
        selected_action_id=record.selected_action_id,
        input_snapshot=record.input_snapshot.root,
        canonical_values=record.canonical_values.root,
        submitted_at=_timestamp(record.submitted_at),
        created_at=_timestamp(record.created_at),
        updated_at=_timestamp(record.updated_at),
    )


def audit_event_to_record(event: FormAuthorizationAuditEvent) -> HumanInputV2FormAuditEvent:
    """Map one shared audit fact to its append-only record."""

    event.validate_authorization_proof_owner()
    record = HumanInputV2FormAuditEvent(
        tenant_id=str(event.form_ref.tenant_id),
        form_id=str(event.form_ref.form_id),
        event_type=event.event_type.value,
        occurred_at=event.occurred_at,
        approver_grant_id=str(event.approver_grant_id) if event.approver_grant_id is not None else None,
        endpoint_id=str(event.endpoint_id) if event.endpoint_id is not None else None,
        channel=event.channel,
        reason_code=event.reason_code,
        reason_message=event.reason_message,
        authorization_proof=(
            proof_to_record_value(event.authorization_proof) if event.authorization_proof is not None else None
        ),
        event_payload=FormAuditEventPayload(_json_object(event.payload)) if event.payload is not None else None,
    )
    record.id = str(event.id)
    record.created_at = event.created_at
    record.updated_at = event.updated_at
    return record


def audit_event_from_record(record: HumanInputV2FormAuditEvent) -> FormAuthorizationAuditEvent:
    """Rebuild one audit fact while enforcing authorized/rejected semantics."""

    try:
        event_type = FormAuthorizationAuditEventType(record.event_type)
    except ValueError as error:
        raise ValueError("audit record has an unsupported event type") from error
    proof = (
        proof_from_record_value(record.authorization_proof, tenant_id=TenantId(record.tenant_id))
        if record.authorization_proof is not None
        else None
    )
    if event_type is FormAuthorizationAuditEventType.SUBMISSION_AUTHORIZED and proof is None:
        raise ValueError("authorized audit record requires verified proof")
    if record.event_payload is not None and not isinstance(record.event_payload, FormAuditEventPayload):
        raise ValueError("audit record has a malformed structured payload")
    return FormAuthorizationAuditEvent(
        id=AuditEventId(record.id),
        event_type=event_type,
        form_ref=FormRef(TenantId(record.tenant_id), FormId(record.form_id)),
        approver_grant_id=(ApproverGrantId(record.approver_grant_id) if record.approver_grant_id is not None else None),
        endpoint_id=DeliveryEndpointId(record.endpoint_id) if record.endpoint_id is not None else None,
        channel=record.channel,
        reason_code=record.reason_code,
        reason_message=record.reason_message,
        authorization_proof=proof,
        payload=record.event_payload.root if record.event_payload is not None else None,
        occurred_at=_timestamp(record.occurred_at),
        created_at=_timestamp(record.created_at),
        updated_at=_timestamp(record.updated_at),
    )


def _json_object(value: Mapping[str, JsonValue]) -> dict[str, JsonValue]:
    return _JSON_OBJECT_ADAPTER.validate_python(value)


__all__ = [
    "audit_event_from_record",
    "audit_event_to_record",
    "proof_from_record_value",
    "proof_to_record_value",
    "submission_from_record",
    "submission_to_record",
]
