"""Independent Email OTP proof-session lifecycle and limited proof boundary.

The aggregate owns only challenge expiry, cooldown, counters, verification, and
invalidation. It never reads or mutates :class:`HumanInputForm`; submission code
must separately compare a verified proof with coherent current identity facts.
Plaintext codes are transient method inputs and are never retained or serialized.
"""

from __future__ import annotations

from dataclasses import dataclass, field, replace
from datetime import timedelta
from enum import StrEnum
from typing import Protocol, TypedDict

from core.human_input_v2.entities import HumanInputAuthorizationProofType, HumanInputOTPChallengeStatus
from core.human_input_v2.shared import ContactId, NormalizedEmail, OTPChallengeId, UtcTimestamp

from .grants import ApproverGrantRef, OTPChallengeRef

OTP_EXPIRY = timedelta(minutes=10)
OTP_RESEND_COOLDOWN = timedelta(seconds=60)
OTP_MAX_SEND_COUNT = 5
OTP_MAX_ATTEMPT_COUNT = 5


def _validate_sha256(value: str, *, label: str) -> None:
    if len(value) != 64 or any(character not in "0123456789abcdef" for character in value):
        raise ValueError(f"{label} must be a lower-case SHA-256 digest")


class Clock(Protocol):
    """Narrow clock port used to make all lifecycle boundaries deterministic."""

    def now(self) -> UtcTimestamp: ...


@dataclass(frozen=True, slots=True)
class OTPCodeHash:
    """Opaque encoded code digest plus the verifier algorithm discriminator."""

    encoded_value: str
    algorithm: str

    def __post_init__(self) -> None:
        if not self.encoded_value or not self.algorithm.strip():
            raise ValueError("OTP code hash values must not be blank")


class OTPCodeHasher(Protocol):
    """Hash and verify transient plaintext without exposing implementation policy."""

    def hash_code(self, plaintext_code: str) -> OTPCodeHash: ...

    def verify_code(self, plaintext_code: str, code_hash: OTPCodeHash) -> bool: ...


@dataclass(frozen=True, slots=True)
class ContactOTPSubject:
    """Contact incarnation captured when an OTP challenge is issued."""

    contact_id: ContactId


@dataclass(frozen=True, slots=True)
class EmailAddressOTPSubject:
    """Standalone normalized Email subject captured from a one-time grant."""

    normalized_email: NormalizedEmail


type EmailOTPSubject = ContactOTPSubject | EmailAddressOTPSubject


class OTPChallengeRejectionReason(StrEnum):
    """Transport-neutral reason for a rejected OTP or proof operation."""

    EXPIRED = "expired"
    RESEND_COOLDOWN = "resend_cooldown"
    SEND_LIMIT_REACHED = "send_limit_reached"
    ATTEMPT_LIMIT_REACHED = "attempt_limit_reached"
    ALREADY_VERIFIED = "already_verified"
    INVALIDATED = "invalidated"
    INVALID_CODE = "invalid_code"
    RAW_CODE_NOT_VERIFIED = "raw_code_not_verified"
    GRANT_MISMATCH = "grant_mismatch"
    STALE_IDENTITY = "stale_identity"


class OTPChallengePublicPrimitive(TypedDict):
    """Secret-free diagnostic form of challenge state."""

    otp_challenge_id: str
    form_id: str
    approver_grant_id: str
    status: str
    email: str
    send_count: int
    attempt_count: int
    expires_at: str
    resend_after: str
    verified_at: str | None
    invalidated_at: str | None


class VerifiedEmailOTPProofPrimitive(TypedDict):
    """Primitive proof shape safe for authorization and audit boundaries."""

    type: str
    otp_challenge_id: str
    form_id: str
    approver_grant_id: str
    subject_type: str
    contact_id: str | None
    verified_email: str
    verified_at: str


@dataclass(frozen=True, slots=True)
class VerifiedEmailOTPProof:
    """Immutable Email verification fact that carries no submission authority."""

    challenge_ref: OTPChallengeRef
    subject: EmailOTPSubject
    normalized_email: NormalizedEmail
    verified_at: UtcTimestamp

    def __post_init__(self) -> None:
        if isinstance(self.subject, EmailAddressOTPSubject) and self.subject.normalized_email != self.normalized_email:
            raise ValueError("OTP proof subject email must match the verified email")

    def to_primitive(self) -> VerifiedEmailOTPProofPrimitive:
        contact_id: str | None = None
        subject_type = "email_address"
        if isinstance(self.subject, ContactOTPSubject):
            subject_type = "contact"
            contact_id = str(self.subject.contact_id)
        return {
            "type": HumanInputAuthorizationProofType.EMAIL_OTP.value,
            "otp_challenge_id": str(self.challenge_ref.challenge_id),
            "form_id": str(self.challenge_ref.form_ref.form_id),
            "approver_grant_id": str(self.challenge_ref.grant_ref.grant_id),
            "subject_type": subject_type,
            "contact_id": contact_id,
            "verified_email": str(self.normalized_email),
            "verified_at": self.verified_at.to_primitive(),
        }


@dataclass(frozen=True, slots=True)
class OTPChallengeState:
    """Stable current usability result independent from transport status codes."""

    status: HumanInputOTPChallengeStatus
    rejection: OTPChallengeRejectionReason | None

    @property
    def is_usable(self) -> bool:
        return self.rejection is None


@dataclass(frozen=True, slots=True)
class OTPReplacementDecision:
    """Immutable replacement result; persistence commits both states atomically."""

    previous: OTPChallenge
    replacement: OTPChallenge | None
    rejection: OTPChallengeRejectionReason | None


@dataclass(frozen=True, slots=True)
class OTPVerificationDecision:
    """Verification result containing either one limited proof or one rejection."""

    challenge: OTPChallenge
    proof: VerifiedEmailOTPProof | None
    rejection: OTPChallengeRejectionReason | None


@dataclass(frozen=True, slots=True)
class OTPChallenge:
    """Grant-scoped proof session whose counters never touch Form lifecycle state."""

    ref: OTPChallengeRef
    subject: EmailOTPSubject
    normalized_email: NormalizedEmail
    challenge_token_hash: str = field(repr=False)
    code_hash: OTPCodeHash = field(repr=False)
    status: HumanInputOTPChallengeStatus
    expires_at: UtcTimestamp
    resend_after: UtcTimestamp
    send_count: int
    attempt_count: int
    verified_at: UtcTimestamp | None
    invalidated_at: UtcTimestamp | None
    created_at: UtcTimestamp
    updated_at: UtcTimestamp

    def __post_init__(self) -> None:
        _validate_sha256(self.challenge_token_hash, label="challenge token hash")
        if isinstance(self.subject, EmailAddressOTPSubject) and self.subject.normalized_email != self.normalized_email:
            raise ValueError("OTP challenge subject email must match the destination email")
        if not 1 <= self.send_count <= OTP_MAX_SEND_COUNT:
            raise ValueError("OTP send count is outside the supported range")
        if not 0 <= self.attempt_count <= OTP_MAX_ATTEMPT_COUNT:
            raise ValueError("OTP attempt count is outside the supported range")
        if self.expires_at.value <= self.created_at.value or self.resend_after.value <= self.created_at.value:
            raise ValueError("OTP expiry and resend timestamps must follow creation")
        if self.updated_at.value < self.created_at.value:
            raise ValueError("OTP updated_at must not precede created_at")
        if self.status is HumanInputOTPChallengeStatus.VERIFIED:
            if self.verified_at is None or self.invalidated_at is not None:
                raise ValueError("verified OTP challenge requires only verified_at")
        elif self.status is HumanInputOTPChallengeStatus.INVALIDATED:
            if self.invalidated_at is None or self.verified_at is not None:
                raise ValueError("invalidated OTP challenge requires only invalidated_at")
        elif self.verified_at is not None or self.invalidated_at is not None:
            raise ValueError("pending and expired OTP challenges cannot have terminal timestamps")

    @classmethod
    def issue(
        cls,
        *,
        challenge_ref: OTPChallengeRef,
        subject: EmailOTPSubject,
        normalized_email: NormalizedEmail,
        challenge_token_hash: str,
        plaintext_code: str,
        send_count: int,
        clock: Clock,
        code_hasher: OTPCodeHasher,
    ) -> OTPChallenge:
        """Hash a transient code and create one pending proof session."""

        now = clock.now()
        return cls(
            ref=challenge_ref,
            subject=subject,
            normalized_email=normalized_email,
            challenge_token_hash=challenge_token_hash,
            code_hash=code_hasher.hash_code(plaintext_code),
            status=HumanInputOTPChallengeStatus.PENDING,
            expires_at=UtcTimestamp(now.value + OTP_EXPIRY),
            resend_after=UtcTimestamp(now.value + OTP_RESEND_COOLDOWN),
            send_count=send_count,
            attempt_count=0,
            verified_at=None,
            invalidated_at=None,
            created_at=now,
            updated_at=now,
        )

    def state_at(self, now: UtcTimestamp) -> OTPChallengeState:
        match self.status:
            case HumanInputOTPChallengeStatus.VERIFIED:
                return OTPChallengeState(self.status, OTPChallengeRejectionReason.ALREADY_VERIFIED)
            case HumanInputOTPChallengeStatus.INVALIDATED:
                return OTPChallengeState(self.status, OTPChallengeRejectionReason.INVALIDATED)
            case HumanInputOTPChallengeStatus.EXPIRED:
                return OTPChallengeState(self.status, OTPChallengeRejectionReason.EXPIRED)
            case HumanInputOTPChallengeStatus.PENDING:
                if now.value >= self.expires_at.value:
                    return OTPChallengeState(HumanInputOTPChallengeStatus.EXPIRED, OTPChallengeRejectionReason.EXPIRED)
                return OTPChallengeState(self.status, None)
        raise AssertionError(f"unsupported OTP challenge status: {self.status}")

    def replace(
        self,
        *,
        challenge_ref: OTPChallengeRef,
        challenge_token_hash: str,
        plaintext_code: str,
        clock: Clock,
        code_hasher: OTPCodeHasher,
    ) -> OTPReplacementDecision:
        """Prepare an eligible replacement without persisting either state."""

        now = clock.now()
        state = self.state_at(now)
        if state.rejection is not None:
            return OTPReplacementDecision(self, None, state.rejection)
        if self.send_count >= OTP_MAX_SEND_COUNT:
            return OTPReplacementDecision(self, None, OTPChallengeRejectionReason.SEND_LIMIT_REACHED)
        if now.value < self.resend_after.value:
            return OTPReplacementDecision(self, None, OTPChallengeRejectionReason.RESEND_COOLDOWN)
        replacement_challenge = self.issue(
            challenge_ref=challenge_ref,
            subject=self.subject,
            normalized_email=self.normalized_email,
            challenge_token_hash=challenge_token_hash,
            plaintext_code=plaintext_code,
            send_count=self.send_count + 1,
            clock=clock,
            code_hasher=code_hasher,
        )
        invalidated = replace(
            self,
            status=HumanInputOTPChallengeStatus.INVALIDATED,
            invalidated_at=now,
            updated_at=now,
        )
        return OTPReplacementDecision(invalidated, replacement_challenge, None)

    def verify(
        self,
        *,
        plaintext_code: str,
        clock: Clock,
        code_hasher: OTPCodeHasher,
    ) -> OTPVerificationDecision:
        """Verify one transient code while preserving exact attempt boundaries."""

        now = clock.now()
        state = self.state_at(now)
        if (
            state.rejection is OTPChallengeRejectionReason.EXPIRED
            and self.status is HumanInputOTPChallengeStatus.PENDING
        ):
            expired = replace(
                self,
                status=HumanInputOTPChallengeStatus.EXPIRED,
                updated_at=now,
            )
            return OTPVerificationDecision(expired, None, OTPChallengeRejectionReason.EXPIRED)
        if state.rejection is not None:
            return OTPVerificationDecision(self, None, state.rejection)
        if self.attempt_count >= OTP_MAX_ATTEMPT_COUNT:
            return OTPVerificationDecision(self, None, OTPChallengeRejectionReason.ATTEMPT_LIMIT_REACHED)
        attempt_count = self.attempt_count + 1
        if not code_hasher.verify_code(plaintext_code, self.code_hash):
            attempted = replace(self, attempt_count=attempt_count, updated_at=now)
            return OTPVerificationDecision(attempted, None, OTPChallengeRejectionReason.INVALID_CODE)
        verified = replace(
            self,
            status=HumanInputOTPChallengeStatus.VERIFIED,
            attempt_count=attempt_count,
            verified_at=now,
            updated_at=now,
        )
        proof = VerifiedEmailOTPProof(
            challenge_ref=self.ref,
            subject=self.subject,
            normalized_email=self.normalized_email,
            verified_at=now,
        )
        return OTPVerificationDecision(verified, proof, None)

    def invalidate(self, *, clock: Clock) -> OTPChallenge:
        """Make a pending proof session unusable without changing its counters."""

        if self.status is not HumanInputOTPChallengeStatus.PENDING:
            return self
        now = clock.now()
        return replace(
            self,
            status=HumanInputOTPChallengeStatus.INVALIDATED,
            invalidated_at=now,
            updated_at=now,
        )

    def to_public_primitive(self) -> OTPChallengePublicPrimitive:
        """Return state diagnostics while deliberately excluding all hashes."""

        return {
            "otp_challenge_id": str(self.ref.challenge_id),
            "form_id": str(self.ref.form_ref.form_id),
            "approver_grant_id": str(self.ref.grant_ref.grant_id),
            "status": self.status.value,
            "email": str(self.normalized_email),
            "send_count": self.send_count,
            "attempt_count": self.attempt_count,
            "expires_at": self.expires_at.to_primitive(),
            "resend_after": self.resend_after.to_primitive(),
            "verified_at": self.verified_at.to_primitive() if self.verified_at is not None else None,
            "invalidated_at": self.invalidated_at.to_primitive() if self.invalidated_at is not None else None,
        }


@dataclass(frozen=True, slots=True)
class CurrentEmailOTPIdentity:
    """Coherent current grant subject and Email facts loaded by submission persistence."""

    grant_ref: ApproverGrantRef
    subject: EmailOTPSubject | None
    normalized_email: NormalizedEmail | None


@dataclass(frozen=True, slots=True)
class EmailOTPProofAuthorizationDecision:
    """OTP-specific proof decision consumed by the later Submission authorizer."""

    proof: VerifiedEmailOTPProof | None
    rejection: OTPChallengeRejectionReason | None


class OTPChallengeRepository(Protocol):
    """Grant-scoped atomic persistence operations for OTP proof sessions."""

    def issue_initial(
        self,
        grant_ref: ApproverGrantRef,
        *,
        challenge_id: OTPChallengeId,
        audit_event_id: str,
        challenge_token_hash: str,
        plaintext_code: str,
    ) -> OTPChallenge: ...

    def replace_current(
        self,
        grant_ref: ApproverGrantRef,
        *,
        challenge_id: OTPChallengeId,
        audit_event_id: str,
        challenge_token_hash: str,
        plaintext_code: str,
    ) -> OTPReplacementDecision: ...

    def verify(self, challenge_ref: OTPChallengeRef, *, plaintext_code: str) -> OTPVerificationDecision: ...

    def invalidate_current(self, grant_ref: ApproverGrantRef) -> OTPChallenge | None: ...

    def load(self, challenge_ref: OTPChallengeRef) -> OTPChallenge | None: ...


def authorize_email_otp_proof(
    candidate: object,
    *,
    current_identity: CurrentEmailOTPIdentity,
) -> EmailOTPProofAuthorizationDecision:
    """Reject raw codes and stale identity incarnations without authorizing submission."""

    if not isinstance(candidate, VerifiedEmailOTPProof):
        return EmailOTPProofAuthorizationDecision(None, OTPChallengeRejectionReason.RAW_CODE_NOT_VERIFIED)
    if candidate.challenge_ref.grant_ref != current_identity.grant_ref:
        return EmailOTPProofAuthorizationDecision(None, OTPChallengeRejectionReason.GRANT_MISMATCH)
    if (
        current_identity.subject is None
        or current_identity.normalized_email is None
        or candidate.subject != current_identity.subject
        or candidate.normalized_email != current_identity.normalized_email
    ):
        return EmailOTPProofAuthorizationDecision(None, OTPChallengeRejectionReason.STALE_IDENTITY)
    return EmailOTPProofAuthorizationDecision(candidate, None)
