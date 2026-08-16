"""Explicit mapping between OTP proof-session values and ORM records.

Hash material crosses only this persistence boundary. Public challenge and proof
serialization deliberately omit every code and token digest.
"""

from __future__ import annotations

from datetime import datetime
from hashlib import sha256

from pydantic import NaiveDatetime

from core.human_input_v2.approval import (
    ContactOTPSubject,
    EmailAddressOTPSubject,
    EmailOTPSubject,
    FormRef,
    OTPChallenge,
    OTPCodeHash,
    VerifiedEmailOTPProof,
)
from core.human_input_v2.entities import HumanInputApproverGrantSubjectType, HumanInputOTPChallengeStatus
from core.human_input_v2.shared import (
    ApproverGrantId,
    ContactId,
    FormId,
    NormalizedEmail,
    OTPChallengeId,
    TenantId,
)
from libs.datetime_utils import ensure_naive_utc
from models.human_input_v2 import EmailOTPAuthorizationProof, HumanInputV2FormOTPChallenge


def _timestamp(value: datetime) -> NaiveDatetime:
    return ensure_naive_utc(value)


def _email_hash(normalized_email: NormalizedEmail) -> str:
    return sha256(str(normalized_email).encode()).hexdigest()


def challenge_to_record(challenge: OTPChallenge) -> HumanInputV2FormOTPChallenge:
    """Map one detached aggregate into a record without plaintext secrets."""

    contact_id: str | None = None
    if isinstance(challenge.subject, ContactOTPSubject):
        subject_type = HumanInputApproverGrantSubjectType.CONTACT
        contact_id = str(challenge.subject.contact_id)
    else:
        subject_type = HumanInputApproverGrantSubjectType.EMAIL_ADDRESS
    record = HumanInputV2FormOTPChallenge(
        tenant_id=str(challenge.ref.form_ref.tenant_id),
        form_id=str(challenge.ref.form_ref.form_id),
        approver_grant_id=str(challenge.ref.grant_ref.grant_id),
        subject_type=subject_type,
        contact_id=contact_id,
        challenge_token_hash=challenge.challenge_token_hash,
        code_hash=challenge.code_hash.encoded_value,
        code_hash_algorithm=challenge.code_hash.algorithm,
        email_hash=_email_hash(challenge.normalized_email),
        email=str(challenge.normalized_email),
        status=challenge.status,
        expires_at=challenge.expires_at,
        resend_after=challenge.resend_after,
        send_count=challenge.send_count,
        attempt_count=challenge.attempt_count,
        verified_at=challenge.verified_at if challenge.verified_at is not None else None,
        invalidated_at=challenge.invalidated_at if challenge.invalidated_at is not None else None,
    )
    record.id = str(challenge.ref.challenge_id)
    record.created_at = challenge.created_at
    record.updated_at = challenge.updated_at
    return record


def challenge_from_record(record: HumanInputV2FormOTPChallenge) -> OTPChallenge:
    """Rebuild one aggregate while rejecting malformed or secret-unsafe rows."""

    try:
        normalized_email = NormalizedEmail(record.email)
    except ValueError as error:
        raise ValueError("OTP challenge record has an invalid email") from error
    if record.email_hash != _email_hash(normalized_email):
        raise ValueError("OTP challenge record email hash does not match its normalized email")
    try:
        code_hash = OTPCodeHash(record.code_hash, record.code_hash_algorithm)
    except ValueError as error:
        raise ValueError("OTP challenge record has invalid code hash metadata") from error

    subject: EmailOTPSubject
    if record.subject_type is HumanInputApproverGrantSubjectType.CONTACT:
        if record.contact_id is None:
            raise ValueError("contact OTP challenge record is missing contact_id")
        subject = ContactOTPSubject(ContactId(record.contact_id))
    elif record.subject_type is HumanInputApproverGrantSubjectType.EMAIL_ADDRESS:
        if record.contact_id is not None:
            raise ValueError("email-address OTP challenge record must not contain contact_id")
        subject = EmailAddressOTPSubject(normalized_email)
    else:
        raise ValueError("OTP challenge record has an unsupported subject type")
    if not isinstance(record.status, HumanInputOTPChallengeStatus):
        raise ValueError("OTP challenge record has an unsupported status")

    challenge_ref = (
        FormRef(TenantId(record.tenant_id), FormId(record.form_id))
        .grant(ApproverGrantId(record.approver_grant_id))
        .challenge(OTPChallengeId(record.id))
    )
    return OTPChallenge(
        ref=challenge_ref,
        subject=subject,
        normalized_email=normalized_email,
        challenge_token_hash=record.challenge_token_hash,
        code_hash=code_hash,
        status=record.status,
        expires_at=_timestamp(record.expires_at),
        resend_after=_timestamp(record.resend_after),
        send_count=record.send_count,
        attempt_count=record.attempt_count,
        verified_at=_timestamp(record.verified_at) if record.verified_at is not None else None,
        invalidated_at=_timestamp(record.invalidated_at) if record.invalidated_at is not None else None,
        created_at=_timestamp(record.created_at),
        updated_at=_timestamp(record.updated_at),
    )


def proof_to_record_value(proof: VerifiedEmailOTPProof) -> EmailOTPAuthorizationProof:
    """Serialize one verified proof without code, token, or hash material."""

    contact_id: str | None = None
    if isinstance(proof.subject, ContactOTPSubject):
        subject_type = HumanInputApproverGrantSubjectType.CONTACT
        contact_id = str(proof.subject.contact_id)
    else:
        subject_type = HumanInputApproverGrantSubjectType.EMAIL_ADDRESS
    return EmailOTPAuthorizationProof(
        otp_challenge_id=str(proof.challenge_ref.challenge_id),
        tenant_id=str(proof.challenge_ref.form_ref.tenant_id),
        form_id=str(proof.challenge_ref.form_ref.form_id),
        approver_grant_id=str(proof.challenge_ref.grant_ref.grant_id),
        subject_type=subject_type,
        contact_id=contact_id,
        verified_email=str(proof.normalized_email),
        verified_at=proof.verified_at,
    )


def proof_from_record_value(
    record_value: EmailOTPAuthorizationProof,
    *,
    tenant_id: TenantId,
) -> VerifiedEmailOTPProof:
    """Rebuild one proof value after validating its captured subject shape."""

    if record_value.tenant_id != str(tenant_id):
        raise ValueError("OTP proof owner does not match the requested workspace")
    normalized_email = NormalizedEmail(record_value.verified_email)
    subject: EmailOTPSubject
    if record_value.subject_type is HumanInputApproverGrantSubjectType.CONTACT:
        if record_value.contact_id is None:
            raise ValueError("contact OTP proof is missing contact_id")
        subject = ContactOTPSubject(ContactId(record_value.contact_id))
    elif record_value.subject_type is HumanInputApproverGrantSubjectType.EMAIL_ADDRESS:
        if record_value.contact_id is not None:
            raise ValueError("email-address OTP proof must not contain contact_id")
        subject = EmailAddressOTPSubject(normalized_email)
    else:
        raise ValueError("OTP proof has an unsupported subject type")
    challenge_ref = (
        FormRef(tenant_id, FormId(record_value.form_id))
        .grant(ApproverGrantId(record_value.approver_grant_id))
        .challenge(OTPChallengeId(record_value.otp_challenge_id))
    )
    return VerifiedEmailOTPProof(
        challenge_ref=challenge_ref,
        subject=subject,
        normalized_email=normalized_email,
        verified_at=_timestamp(record_value.verified_at),
    )
