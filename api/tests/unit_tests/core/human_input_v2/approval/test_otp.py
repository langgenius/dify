"""Behavior contracts for the independent Email OTP proof-session aggregate."""

from __future__ import annotations

from dataclasses import replace
from datetime import datetime, timedelta

import pytest
from pydantic import NaiveDatetime

from core.human_input_v2.approval import (
    ContactOTPSubject,
    CurrentEmailOTPIdentity,
    EmailAddressOTPSubject,
    FormRef,
    OTPChallenge,
    OTPChallengeRejectionReason,
    OTPCodeHash,
    VerifiedEmailOTPProof,
    authorize_email_otp_proof,
)
from core.human_input_v2.entities import HumanInputOTPChallengeStatus
from core.human_input_v2.shared import (
    ApproverGrantId,
    ContactId,
    FormId,
    NormalizedEmail,
    OTPChallengeId,
    TenantId,
)

_ISSUED_AT = datetime(2026, 7, 25, 8)
_EXPIRES_AT = _ISSUED_AT + timedelta(minutes=10)
_RESEND_AFTER = _ISSUED_AT + timedelta(seconds=60)
_RAW_CODE = "123456"
_ENCODED_HASH = "test-sha256$8d969eef6ecad3c29a3a629280e686cff8ca4a8d"
_TOKEN_HASH = "a" * 64
_EMAIL = NormalizedEmail("Reviewer@Example.com")
_FORM_REF = FormRef(TenantId("workspace-1"), FormId("form-1"))
_GRANT_REF = _FORM_REF.grant(ApproverGrantId("grant-1"))
_SUBJECT = ContactOTPSubject(ContactId("contact-1"))


class _MutableClock:
    current: NaiveDatetime

    def __init__(self, current: NaiveDatetime = _ISSUED_AT) -> None:
        self.current = current

    def now(self) -> NaiveDatetime:
        return self.current

    def advance(self, delta: timedelta) -> None:
        self.current = self.current + delta


class _DeterministicHasher:
    hash_calls: list[str]
    verify_calls: list[tuple[str, OTPCodeHash]]

    def __init__(self) -> None:
        self.hash_calls = []
        self.verify_calls = []

    def hash_code(self, plaintext_code: str) -> OTPCodeHash:
        self.hash_calls.append(plaintext_code)
        return OTPCodeHash(encoded_value=_ENCODED_HASH, algorithm="test-sha256")

    def verify_code(self, plaintext_code: str, code_hash: OTPCodeHash) -> bool:
        self.verify_calls.append((plaintext_code, code_hash))
        return plaintext_code == _RAW_CODE and code_hash.encoded_value == _ENCODED_HASH


def _issue(
    *,
    clock: _MutableClock | None = None,
    hasher: _DeterministicHasher | None = None,
    challenge_number: int = 1,
    send_count: int = 1,
) -> OTPChallenge:
    active_clock = clock or _MutableClock()
    active_hasher = hasher or _DeterministicHasher()
    return OTPChallenge.issue(
        challenge_ref=_GRANT_REF.challenge(OTPChallengeId(f"challenge-{challenge_number}")),
        subject=_SUBJECT,
        normalized_email=_EMAIL,
        challenge_token_hash=_TOKEN_HASH,
        plaintext_code=_RAW_CODE,
        send_count=send_count,
        clock=active_clock,
        code_hasher=active_hasher,
    )


def _construct_challenge(
    *,
    expires_at: NaiveDatetime = _EXPIRES_AT,
    resend_after: NaiveDatetime = _RESEND_AFTER,
) -> OTPChallenge:
    return OTPChallenge(
        ref=_GRANT_REF.challenge(OTPChallengeId("challenge-direct")),
        subject=_SUBJECT,
        normalized_email=_EMAIL,
        challenge_token_hash=_TOKEN_HASH,
        code_hash=OTPCodeHash(encoded_value=_ENCODED_HASH, algorithm="test-sha256"),
        status=HumanInputOTPChallengeStatus.PENDING,
        expires_at=expires_at,
        resend_after=resend_after,
        send_count=1,
        attempt_count=0,
        verified_at=None,
        invalidated_at=None,
        created_at=_ISSUED_AT,
        updated_at=_ISSUED_AT,
    )


def test_issue_uses_injected_clock_and_hash_port_without_retaining_plaintext() -> None:
    clock = _MutableClock()
    hasher = _DeterministicHasher()

    challenge = _issue(clock=clock, hasher=hasher)

    assert hasher.hash_calls == [_RAW_CODE]
    assert challenge.created_at == clock.now()
    assert challenge.expires_at == _ISSUED_AT + timedelta(minutes=10)
    assert challenge.resend_after == _ISSUED_AT + timedelta(seconds=60)
    assert _RAW_CODE not in repr(challenge)
    assert _RAW_CODE not in challenge.to_public_primitive().values()
    assert "code_hash" not in challenge.to_public_primitive()
    assert "challenge_token_hash" not in challenge.to_public_primitive()


def test_challenge_expires_at_the_exact_ten_minute_boundary() -> None:
    challenge = _issue()

    before = challenge.state_at(_ISSUED_AT + timedelta(minutes=10, microseconds=-1))
    exact = challenge.state_at(_ISSUED_AT + timedelta(minutes=10))

    assert before.rejection is None
    assert exact.rejection is OTPChallengeRejectionReason.EXPIRED


def test_replacement_rejects_before_cooldown_without_incrementing_send_count() -> None:
    clock = _MutableClock(_ISSUED_AT + timedelta(seconds=59, microseconds=999999))
    challenge = _issue()

    decision = challenge.replace(
        challenge_ref=_GRANT_REF.challenge(OTPChallengeId("challenge-2")),
        challenge_token_hash="b" * 64,
        plaintext_code=_RAW_CODE,
        clock=clock,
        code_hasher=_DeterministicHasher(),
    )

    assert decision.rejection is OTPChallengeRejectionReason.RESEND_COOLDOWN
    assert decision.previous is challenge
    assert decision.replacement is None
    assert decision.previous.send_count == 1


def test_replacement_is_allowed_at_exact_cooldown_and_invalidates_previous() -> None:
    clock = _MutableClock(_ISSUED_AT + timedelta(seconds=60))
    challenge = _issue()

    decision = challenge.replace(
        challenge_ref=_GRANT_REF.challenge(OTPChallengeId("challenge-2")),
        challenge_token_hash="b" * 64,
        plaintext_code=_RAW_CODE,
        clock=clock,
        code_hasher=_DeterministicHasher(),
    )

    assert decision.rejection is None
    assert decision.previous.status is HumanInputOTPChallengeStatus.INVALIDATED
    assert decision.previous.invalidated_at == clock.now()
    assert decision.replacement is not None
    assert decision.replacement.status is HumanInputOTPChallengeStatus.PENDING
    assert decision.replacement.send_count == 2
    assert decision.replacement.attempt_count == 0


@pytest.mark.parametrize(
    "elapsed",
    [timedelta(minutes=10), timedelta(minutes=10, microseconds=1)],
    ids=["exact-boundary", "past-boundary"],
)
def test_expired_replacement_returns_expired_previous_without_hashing(elapsed: timedelta) -> None:
    clock = _MutableClock(_ISSUED_AT + elapsed)
    hasher = _DeterministicHasher()
    challenge = _issue()

    decision = challenge.replace(
        challenge_ref=_GRANT_REF.challenge(OTPChallengeId("challenge-2")),
        challenge_token_hash="b" * 64,
        plaintext_code=_RAW_CODE,
        clock=clock,
        code_hasher=hasher,
    )

    assert decision.rejection is OTPChallengeRejectionReason.EXPIRED
    assert decision.previous.status is HumanInputOTPChallengeStatus.EXPIRED
    assert decision.previous.updated_at == clock.now()
    assert decision.previous.send_count == challenge.send_count
    assert decision.previous.attempt_count == challenge.attempt_count
    assert decision.replacement is None
    assert hasher.hash_calls == []


def test_fifth_send_is_allowed_and_further_send_is_rejected_without_hashing() -> None:
    clock = _MutableClock(_ISSUED_AT + timedelta(seconds=60))
    fourth = _issue(send_count=4)
    fifth_hasher = _DeterministicHasher()

    fifth = fourth.replace(
        challenge_ref=_GRANT_REF.challenge(OTPChallengeId("challenge-5")),
        challenge_token_hash="e" * 64,
        plaintext_code=_RAW_CODE,
        clock=clock,
        code_hasher=fifth_hasher,
    )

    assert fifth.replacement is not None
    assert fifth.replacement.send_count == 5
    rejected_hasher = _DeterministicHasher()
    clock.advance(timedelta(seconds=60))
    rejected = fifth.replacement.replace(
        challenge_ref=_GRANT_REF.challenge(OTPChallengeId("challenge-6")),
        challenge_token_hash="f" * 64,
        plaintext_code=_RAW_CODE,
        clock=clock,
        code_hasher=rejected_hasher,
    )
    assert rejected.rejection is OTPChallengeRejectionReason.SEND_LIMIT_REACHED
    assert rejected.previous.send_count == 5
    assert rejected_hasher.hash_calls == []


@pytest.mark.parametrize(
    ("terminal_status", "expected_reason"),
    [
        (HumanInputOTPChallengeStatus.VERIFIED, OTPChallengeRejectionReason.ALREADY_VERIFIED),
        (HumanInputOTPChallengeStatus.INVALIDATED, OTPChallengeRejectionReason.INVALIDATED),
        (HumanInputOTPChallengeStatus.EXPIRED, OTPChallengeRejectionReason.EXPIRED),
    ],
)
def test_terminal_challenge_rejects_replacement_without_incrementing_counters(
    terminal_status: HumanInputOTPChallengeStatus,
    expected_reason: OTPChallengeRejectionReason,
) -> None:
    clock = _MutableClock(_ISSUED_AT + timedelta(seconds=60))
    pending = _issue()
    if terminal_status is HumanInputOTPChallengeStatus.VERIFIED:
        challenge = pending.verify(
            plaintext_code=_RAW_CODE,
            clock=clock,
            code_hasher=_DeterministicHasher(),
        ).challenge
    elif terminal_status is HumanInputOTPChallengeStatus.INVALIDATED:
        challenge = pending.invalidate(clock=clock)
    else:
        expiry_clock = _MutableClock(_ISSUED_AT + timedelta(minutes=10))
        challenge = pending.verify(
            plaintext_code=_RAW_CODE,
            clock=expiry_clock,
            code_hasher=_DeterministicHasher(),
        ).challenge
    previous_attempt_count = challenge.attempt_count
    hasher = _DeterministicHasher()

    decision = challenge.replace(
        challenge_ref=_GRANT_REF.challenge(OTPChallengeId("challenge-2")),
        challenge_token_hash="b" * 64,
        plaintext_code=_RAW_CODE,
        clock=clock,
        code_hasher=hasher,
    )

    assert decision.rejection is expected_reason
    assert decision.previous.send_count == 1
    assert decision.previous.attempt_count == previous_attempt_count
    assert hasher.hash_calls == []


def test_five_invalid_attempts_are_consumed_and_sixth_is_rejected_without_hashing() -> None:
    clock = _MutableClock()
    hasher = _DeterministicHasher()
    challenge = _issue(clock=clock, hasher=hasher)

    for expected_count in range(1, 6):
        decision = challenge.verify(plaintext_code="000000", clock=clock, code_hasher=hasher)
        assert decision.rejection is OTPChallengeRejectionReason.INVALID_CODE
        assert decision.challenge.attempt_count == expected_count
        challenge = decision.challenge

    verify_call_count = len(hasher.verify_calls)
    rejected = challenge.verify(plaintext_code="000000", clock=clock, code_hasher=hasher)
    assert rejected.rejection is OTPChallengeRejectionReason.ATTEMPT_LIMIT_REACHED
    assert rejected.challenge.attempt_count == 5
    assert len(hasher.verify_calls) == verify_call_count


def test_successful_verification_consumes_one_attempt_and_returns_immutable_limited_proof() -> None:
    clock = _MutableClock(_ISSUED_AT + timedelta(seconds=30))
    hasher = _DeterministicHasher()
    challenge = _issue()

    decision = challenge.verify(plaintext_code=_RAW_CODE, clock=clock, code_hasher=hasher)

    assert decision.rejection is None
    assert decision.challenge.status is HumanInputOTPChallengeStatus.VERIFIED
    assert decision.challenge.attempt_count == 1
    assert decision.proof is not None
    assert decision.proof == VerifiedEmailOTPProof(
        challenge_ref=challenge.ref,
        subject=_SUBJECT,
        normalized_email=_EMAIL,
        verified_at=clock.now(),
    )
    assert _RAW_CODE not in repr(decision.proof)
    serialized = decision.proof.to_primitive()
    assert serialized == {
        "type": "email_otp",
        "otp_challenge_id": "challenge-1",
        "form_id": "form-1",
        "approver_grant_id": "grant-1",
        "subject_type": "contact",
        "contact_id": "contact-1",
        "verified_email": "reviewer@example.com",
        "verified_at": "2026-07-25T08:00:30Z",
    }
    assert not any("hash" in key or "code" in key for key in serialized)
    attribute_name = "normalized_email"
    with pytest.raises((AttributeError, TypeError)):
        setattr(decision.proof, attribute_name, NormalizedEmail("other@example.com"))


def test_verified_and_invalidated_challenges_reject_further_verification_without_counter_changes() -> None:
    clock = _MutableClock(_ISSUED_AT + timedelta(seconds=30))
    hasher = _DeterministicHasher()
    verified = _issue().verify(plaintext_code=_RAW_CODE, clock=clock, code_hasher=hasher).challenge
    invalidated = _issue().invalidate(clock=clock)

    verified_result = verified.verify(plaintext_code=_RAW_CODE, clock=clock, code_hasher=hasher)
    invalidated_result = invalidated.verify(plaintext_code=_RAW_CODE, clock=clock, code_hasher=hasher)

    assert verified_result.rejection is OTPChallengeRejectionReason.ALREADY_VERIFIED
    assert invalidated_result.rejection is OTPChallengeRejectionReason.INVALIDATED
    assert verified_result.challenge.attempt_count == 1
    assert invalidated_result.challenge.attempt_count == 0


def test_expired_verification_does_not_consume_an_attempt_or_call_hash_port() -> None:
    clock = _MutableClock(_ISSUED_AT + timedelta(minutes=10))
    hasher = _DeterministicHasher()
    challenge = _issue()

    decision = challenge.verify(plaintext_code=_RAW_CODE, clock=clock, code_hasher=hasher)

    assert decision.rejection is OTPChallengeRejectionReason.EXPIRED
    assert decision.challenge.status is HumanInputOTPChallengeStatus.EXPIRED
    assert decision.challenge.attempt_count == 0
    assert hasher.verify_calls == []


def test_submission_boundary_rejects_raw_code_and_accepts_only_current_verified_identity() -> None:
    clock = _MutableClock(_ISSUED_AT + timedelta(seconds=30))
    proof = _issue().verify(plaintext_code=_RAW_CODE, clock=clock, code_hasher=_DeterministicHasher()).proof
    assert proof is not None
    current_identity = CurrentEmailOTPIdentity(_GRANT_REF, _SUBJECT, _EMAIL)

    raw_result = authorize_email_otp_proof(_RAW_CODE, current_identity=current_identity)
    accepted = authorize_email_otp_proof(proof, current_identity=current_identity)

    assert raw_result.rejection is OTPChallengeRejectionReason.RAW_CODE_NOT_VERIFIED
    assert accepted.rejection is None
    assert accepted.proof is proof


@pytest.mark.parametrize(
    ("current_identity", "expected_reason"),
    [
        (
            CurrentEmailOTPIdentity(
                _GRANT_REF,
                _SUBJECT,
                NormalizedEmail("changed@example.com"),
            ),
            OTPChallengeRejectionReason.STALE_IDENTITY,
        ),
        (CurrentEmailOTPIdentity(_GRANT_REF, None, None), OTPChallengeRejectionReason.STALE_IDENTITY),
        (
            CurrentEmailOTPIdentity(
                _GRANT_REF,
                ContactOTPSubject(ContactId("recreated-contact")),
                _EMAIL,
            ),
            OTPChallengeRejectionReason.STALE_IDENTITY,
        ),
        (
            CurrentEmailOTPIdentity(
                _FORM_REF.grant(ApproverGrantId("other-grant")),
                _SUBJECT,
                _EMAIL,
            ),
            OTPChallengeRejectionReason.GRANT_MISMATCH,
        ),
    ],
)
def test_submission_boundary_rejects_changed_deleted_recreated_or_wrong_grant_identity(
    current_identity: CurrentEmailOTPIdentity,
    expected_reason: OTPChallengeRejectionReason,
) -> None:
    clock = _MutableClock(_ISSUED_AT + timedelta(seconds=30))
    proof = _issue().verify(plaintext_code=_RAW_CODE, clock=clock, code_hasher=_DeterministicHasher()).proof
    assert proof is not None

    decision = authorize_email_otp_proof(proof, current_identity=current_identity)

    assert decision.rejection is expected_reason


def test_email_address_subject_requires_the_same_normalized_email() -> None:
    with pytest.raises(ValueError, match="subject email"):
        OTPChallenge.issue(
            challenge_ref=_GRANT_REF.challenge(OTPChallengeId("challenge-email")),
            subject=EmailAddressOTPSubject(NormalizedEmail("recipient@example.com")),
            normalized_email=NormalizedEmail("other@example.com"),
            challenge_token_hash="c" * 64,
            plaintext_code=_RAW_CODE,
            send_count=1,
            clock=_MutableClock(),
            code_hasher=_DeterministicHasher(),
        )


def test_email_address_proof_requires_matching_email_and_serializes_without_contact_identity() -> None:
    email = NormalizedEmail("recipient@example.com")
    proof = VerifiedEmailOTPProof(
        challenge_ref=_GRANT_REF.challenge(OTPChallengeId("challenge-email")),
        subject=EmailAddressOTPSubject(email),
        normalized_email=email,
        verified_at=_ISSUED_AT,
    )

    assert proof.to_primitive()["subject_type"] == "email_address"
    assert proof.to_primitive()["contact_id"] is None
    with pytest.raises(ValueError, match="subject email"):
        VerifiedEmailOTPProof(
            challenge_ref=proof.challenge_ref,
            subject=proof.subject,
            normalized_email=NormalizedEmail("other@example.com"),
            verified_at=proof.verified_at,
        )


def test_state_result_exposes_usable_and_rejected_branches() -> None:
    challenge = _issue()

    assert challenge.state_at(_ISSUED_AT).is_usable is True
    assert challenge.state_at(_ISSUED_AT + timedelta(minutes=10)).is_usable is False


def test_challenge_rejects_malformed_persistence_state() -> None:
    challenge = _issue()

    with pytest.raises(ValueError, match="challenge token hash"):
        replace(challenge, challenge_token_hash="A" * 64)
    with pytest.raises(ValueError, match="expires_at"):
        replace(challenge, expires_at=_ISSUED_AT)
    with pytest.raises(ValueError, match="updated_at"):
        replace(challenge, updated_at=_ISSUED_AT - timedelta(seconds=1))
    with pytest.raises(ValueError, match="requires only verified_at"):
        replace(challenge, status=HumanInputOTPChallengeStatus.VERIFIED)
    with pytest.raises(ValueError, match="requires only invalidated_at"):
        replace(challenge, status=HumanInputOTPChallengeStatus.INVALIDATED)
    with pytest.raises(ValueError, match="cannot have terminal timestamps"):
        replace(challenge, verified_at=_ISSUED_AT)


@pytest.mark.parametrize(
    "resend_after",
    [
        _ISSUED_AT + timedelta(seconds=59, microseconds=999999),
        _ISSUED_AT + timedelta(seconds=60, microseconds=1),
    ],
    ids=["short", "long"],
)
def test_direct_construction_requires_exact_resend_cooldown(resend_after: NaiveDatetime) -> None:
    with pytest.raises(ValueError, match="resend_after"):
        _construct_challenge(resend_after=resend_after)


@pytest.mark.parametrize(
    "expires_at",
    [
        _ISSUED_AT + timedelta(minutes=10, microseconds=-1),
        _ISSUED_AT + timedelta(minutes=10, microseconds=1),
    ],
    ids=["short", "long"],
)
def test_direct_construction_requires_exact_expiry(expires_at: NaiveDatetime) -> None:
    with pytest.raises(ValueError, match="expires_at"):
        _construct_challenge(expires_at=expires_at)


def test_invalidating_a_terminal_challenge_is_idempotent() -> None:
    clock = _MutableClock(_ISSUED_AT + timedelta(seconds=30))
    verified = (
        _issue()
        .verify(
            plaintext_code=_RAW_CODE,
            clock=clock,
            code_hasher=_DeterministicHasher(),
        )
        .challenge
    )

    assert verified.invalidate(clock=clock) is verified
