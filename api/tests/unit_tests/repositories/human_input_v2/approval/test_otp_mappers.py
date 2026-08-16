"""Explicit mapping contracts for OTP proof-session persistence."""

from __future__ import annotations

from datetime import datetime, timedelta

import pytest
from pydantic import NaiveDatetime

from core.human_input_v2.approval import (
    ContactOTPSubject,
    EmailAddressOTPSubject,
    FormRef,
    OTPChallenge,
    OTPCodeHash,
    VerifiedEmailOTPProof,
)
from core.human_input_v2.entities import HumanInputApproverGrantSubjectType
from core.human_input_v2.shared import (
    ApproverGrantId,
    ContactId,
    FormId,
    NormalizedEmail,
    OTPChallengeId,
    TenantId,
)
from repositories.human_input_v2.approval.mappers import (
    challenge_from_record,
    challenge_to_record,
    proof_from_record_value,
    proof_to_record_value,
)

_NOW = datetime(2026, 7, 25, 8)
_FORM_REF = FormRef(TenantId("workspace-1"), FormId("form-1"))
_GRANT_REF = _FORM_REF.grant(ApproverGrantId("grant-1"))
_CONTACT_SUBJECT = ContactOTPSubject(ContactId("contact-1"))


class _Clock:
    current: NaiveDatetime

    def __init__(self, current: NaiveDatetime = _NOW) -> None:
        self.current = current

    def now(self) -> NaiveDatetime:
        return self.current


class _Hasher:
    def hash_code(self, plaintext_code: str) -> OTPCodeHash:
        assert plaintext_code == "123456"
        return OTPCodeHash("encoded-test-hash", "argon2id")

    def verify_code(self, plaintext_code: str, code_hash: OTPCodeHash) -> bool:
        return plaintext_code == "123456" and code_hash.encoded_value == "encoded-test-hash"


def _pending(*, subject=_CONTACT_SUBJECT, email: str = "reviewer@example.com") -> OTPChallenge:
    return OTPChallenge.issue(
        challenge_ref=_GRANT_REF.challenge(OTPChallengeId("challenge-1")),
        subject=subject,
        normalized_email=NormalizedEmail(email),
        challenge_token_hash="a" * 64,
        plaintext_code="123456",
        send_count=1,
        clock=_Clock(),
        code_hasher=_Hasher(),
    )


def _status_cases() -> tuple[OTPChallenge, ...]:
    pending = _pending()
    verified_clock = _Clock(_NOW + timedelta(seconds=30))
    expired_clock = _Clock(_NOW + timedelta(minutes=10))
    return (
        pending,
        pending.verify(plaintext_code="123456", clock=verified_clock, code_hasher=_Hasher()).challenge,
        pending.invalidate(clock=verified_clock),
        pending.verify(plaintext_code="123456", clock=expired_clock, code_hasher=_Hasher()).challenge,
    )


@pytest.mark.parametrize("challenge", _status_cases(), ids=lambda challenge: challenge.status.value)
def test_challenge_mapper_round_trips_state_counters_timestamps_and_hash_metadata(challenge: OTPChallenge) -> None:
    record = challenge_to_record(challenge)

    assert record.code_hash == "encoded-test-hash"
    assert record.code_hash_algorithm == "argon2id"
    assert record.challenge_token_hash == "a" * 64
    assert record.email_hash == "18717f7f1f60f92207bd02972c16aec92f52b31c2a8442444df988d8e8503c5e"
    assert challenge_from_record(record) == challenge


def test_email_address_subject_round_trips_without_contact_identity() -> None:
    email = NormalizedEmail("standalone@example.com")
    challenge = _pending(subject=EmailAddressOTPSubject(email), email=str(email))

    record = challenge_to_record(challenge)

    assert record.subject_type is HumanInputApproverGrantSubjectType.EMAIL_ADDRESS
    assert record.contact_id is None
    assert challenge_from_record(record) == challenge


def test_contact_subject_round_trips_its_identity_incarnation() -> None:
    record = challenge_to_record(_pending())

    assert record.subject_type is HumanInputApproverGrantSubjectType.CONTACT
    assert record.contact_id == "contact-1"
    assert challenge_from_record(record).subject == _CONTACT_SUBJECT


@pytest.mark.parametrize(
    ("field_name", "field_value", "message"),
    [
        ("email", "not-an-email", "invalid email"),
        ("email_hash", "b" * 64, "email hash"),
        ("code_hash", "", "code hash"),
        ("code_hash_algorithm", "", "code hash"),
        ("send_count", 6, "send count"),
        ("attempt_count", 6, "attempt count"),
        ("resend_after", _NOW + timedelta(seconds=59, microseconds=999999), "resend_after"),
        ("resend_after", _NOW + timedelta(seconds=60, microseconds=1), "resend_after"),
        ("expires_at", _NOW + timedelta(minutes=10, microseconds=-1), "expires_at"),
        ("expires_at", _NOW + timedelta(minutes=10, microseconds=1), "expires_at"),
        ("subject_type", HumanInputApproverGrantSubjectType.END_USER, "subject type"),
        ("status", "unknown", "status"),
    ],
)
def test_challenge_mapper_rejects_malformed_persisted_values(
    field_name: str,
    field_value: object,
    message: str,
) -> None:
    record = challenge_to_record(_pending())
    setattr(record, field_name, field_value)

    with pytest.raises(ValueError, match=message):
        challenge_from_record(record)


def test_challenge_mapper_rejects_contact_subject_without_contact_id() -> None:
    record = challenge_to_record(_pending())
    record.contact_id = None

    with pytest.raises(ValueError, match="contact_id"):
        challenge_from_record(record)


def test_challenge_mapper_rejects_email_subject_with_contact_id() -> None:
    email = NormalizedEmail("standalone@example.com")
    record = challenge_to_record(_pending(subject=EmailAddressOTPSubject(email), email=str(email)))
    record.contact_id = "contact-1"

    with pytest.raises(ValueError, match="contact_id"):
        challenge_from_record(record)


def test_verified_proof_mapper_preserves_scope_email_identity_and_timestamp_without_hashes() -> None:
    proof = VerifiedEmailOTPProof(
        challenge_ref=_GRANT_REF.challenge(OTPChallengeId("challenge-1")),
        subject=_CONTACT_SUBJECT,
        normalized_email=NormalizedEmail("reviewer@example.com"),
        verified_at=_NOW + timedelta(seconds=30),
    )

    record_value = proof_to_record_value(proof)

    assert record_value.model_dump(mode="json") == {
        "type": "email_otp",
        "otp_challenge_id": "challenge-1",
        "tenant_id": "workspace-1",
        "form_id": "form-1",
        "approver_grant_id": "grant-1",
        "subject_type": "contact",
        "contact_id": "contact-1",
        "verified_email": "reviewer@example.com",
        "verified_at": "2026-07-25T08:00:30",
    }
    assert not any("hash" in key or "code" in key for key in type(record_value).model_fields)
    assert proof_from_record_value(record_value, tenant_id=TenantId("workspace-1")) == proof


def test_verified_proof_mapper_rejects_a_record_from_another_workspace() -> None:
    proof = VerifiedEmailOTPProof(
        challenge_ref=_GRANT_REF.challenge(OTPChallengeId("challenge-1")),
        subject=_CONTACT_SUBJECT,
        normalized_email=NormalizedEmail("reviewer@example.com"),
        verified_at=_NOW,
    )
    record_value = proof_to_record_value(proof).model_copy(update={"tenant_id": "workspace-2"})

    with pytest.raises(ValueError, match="proof owner"):
        proof_from_record_value(record_value, tenant_id=TenantId("workspace-1"))


def test_verified_proof_mapper_rejects_malformed_subject_values() -> None:
    proof = VerifiedEmailOTPProof(
        challenge_ref=_GRANT_REF.challenge(OTPChallengeId("challenge-1")),
        subject=_CONTACT_SUBJECT,
        normalized_email=NormalizedEmail("reviewer@example.com"),
        verified_at=_NOW,
    )
    record_value = proof_to_record_value(proof).model_copy(update={"contact_id": None})

    with pytest.raises(ValueError, match="contact_id"):
        proof_from_record_value(record_value, tenant_id=TenantId("workspace-1"))


def test_proof_mapper_rebuilds_email_address_subject_without_contact_id() -> None:
    email = NormalizedEmail("standalone@example.com")
    proof = VerifiedEmailOTPProof(
        challenge_ref=_GRANT_REF.challenge(OTPChallengeId("challenge-1")),
        subject=EmailAddressOTPSubject(email),
        normalized_email=email,
        verified_at=_NOW,
    )

    assert (
        proof_from_record_value(
            proof_to_record_value(proof),
            tenant_id=TenantId("workspace-1"),
        )
        == proof
    )


@pytest.mark.parametrize(
    ("updates", "message"),
    [
        ({"subject_type": HumanInputApproverGrantSubjectType.EMAIL_ADDRESS, "contact_id": "contact-1"}, "contact_id"),
        ({"subject_type": HumanInputApproverGrantSubjectType.END_USER}, "subject type"),
    ],
)
def test_verified_proof_mapper_rejects_unsupported_persisted_subject_shapes(
    updates: dict[str, object],
    message: str,
) -> None:
    proof = VerifiedEmailOTPProof(
        challenge_ref=_GRANT_REF.challenge(OTPChallengeId("challenge-1")),
        subject=_CONTACT_SUBJECT,
        normalized_email=NormalizedEmail("reviewer@example.com"),
        verified_at=_NOW,
    )
    record_value = proof_to_record_value(proof).model_copy(update=updates)

    with pytest.raises(ValueError, match=message):
        proof_from_record_value(record_value, tenant_id=TenantId("workspace-1"))
