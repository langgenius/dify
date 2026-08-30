"""Grant-locked SQLAlchemy adapter for Email OTP proof sessions.

Every write locks the stable approver-grant row with its complete owner chain.
Replacement hashing completes before tracked rows are mutated; invalidation,
replacement insertion, and an injected audit append then share one short
transaction. The Submission Runtime persistence layer owns the concrete shared
form-audit writer and table; this module owns only the transaction-scoped port.
An elapsed pending challenge is committed as expired without hashing, audit, or
replacement side effects. The adapter never loads or writes Form lifecycle fields.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

import sqlalchemy as sa
from pydantic import NaiveDatetime
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session, sessionmaker

from core.human_input_v2.approval import (
    ApproverGrantRef,
    Clock,
    CurrentEmailOTPIdentity,
    EmailAddressOTPSubject,
    OTPChallenge,
    OTPChallengeRef,
    OTPChallengeRejectionReason,
    OTPCodeHasher,
    OTPReplacementDecision,
    OTPVerificationDecision,
)
from core.human_input_v2.entities import HumanInputApproverGrantSubjectType
from core.human_input_v2.shared import NormalizedEmail, OTPChallengeId
from models.human_input_v2 import (
    HumanInputV2FormApproverGrant,
    HumanInputV2FormOTPChallenge,
)

from .mappers import challenge_from_record, challenge_to_record


class OTPPersistenceError(RuntimeError):
    """An OTP write failed before its complete transaction could commit."""


@dataclass(frozen=True, slots=True)
class OTPChallengeAuditFact:
    """Secret-free issuance fact appended in the replacement transaction."""

    audit_event_id: str
    challenge_ref: OTPChallengeRef
    previous_challenge_id: OTPChallengeId | None
    send_count: int
    occurred_at: NaiveDatetime


class OTPChallengeAuditWriter(Protocol):
    """Append one audit fact through the caller-owned SQLAlchemy transaction.

    The concrete shared audit mapping belongs to Submission Runtime persistence.
    """

    def append(self, session: Session, fact: OTPChallengeAuditFact) -> None:
        """Add the fact without committing, flushing, or retaining the session."""

        ...


class SQLAlchemyOTPChallengeRepository:
    """Operation-oriented OTP adapter serialized by one grant row lock."""

    _session_maker: sessionmaker[Session]
    _clock: Clock
    _code_hasher: OTPCodeHasher
    _audit_writer: OTPChallengeAuditWriter

    def __init__(
        self,
        session_maker: sessionmaker[Session],
        *,
        clock: Clock,
        code_hasher: OTPCodeHasher,
        audit_writer: OTPChallengeAuditWriter,
    ) -> None:
        self._session_maker = session_maker
        self._clock = clock
        self._code_hasher = code_hasher
        self._audit_writer = audit_writer

    def issue_initial(
        self,
        grant_ref: ApproverGrantRef,
        *,
        challenge_id: OTPChallengeId,
        audit_event_id: str,
        challenge_token_hash: str,
        plaintext_code: str,
    ) -> OTPChallenge:
        """Issue the first challenge for a grant scope and append its audit fact."""

        try:
            with self._session_maker() as session, session.begin():
                grant_record = self._lock_grant(session, grant_ref)
                if self._load_latest_record(session, grant_ref) is not None:
                    raise ValueError("OTP challenge already exists for the grant scope")
                current_identity = self._current_identity(session, grant_record, grant_ref)
                if current_identity.subject is None or current_identity.normalized_email is None:
                    raise ValueError("grant scope has no current Email identity")
                challenge = OTPChallenge.issue(
                    challenge_ref=grant_ref.challenge(challenge_id),
                    subject=current_identity.subject,
                    normalized_email=current_identity.normalized_email,
                    challenge_token_hash=challenge_token_hash,
                    plaintext_code=plaintext_code,
                    send_count=1,
                    clock=self._clock,
                    code_hasher=self._code_hasher,
                )
                session.add(challenge_to_record(challenge))
                self._append_audit(
                    session,
                    challenge=challenge,
                    previous_challenge_id=None,
                    audit_event_id=audit_event_id,
                )
                session.flush()
                return challenge
        except SQLAlchemyError as error:
            raise OTPPersistenceError("failed to issue initial OTP challenge") from error

    def replace_current(
        self,
        grant_ref: ApproverGrantRef,
        *,
        challenge_id: OTPChallengeId,
        audit_event_id: str,
        challenge_token_hash: str,
        plaintext_code: str,
    ) -> OTPReplacementDecision:
        """Atomically expire or replace the latest challenge after policy checks."""

        try:
            with self._session_maker() as session, session.begin():
                grant_record = self._lock_grant(session, grant_ref)
                current_record = self._load_latest_record(session, grant_ref)
                if current_record is None:
                    raise ValueError("current OTP challenge does not exist for the grant scope")
                current = challenge_from_record(current_record)
                current_identity = self._current_identity(session, grant_record, grant_ref)
                if not self._identity_matches(current, current_identity):
                    invalidated = current.invalidate(clock=self._clock)
                    self._apply_state(current_record, invalidated)
                    session.flush()
                    return OTPReplacementDecision(
                        invalidated,
                        None,
                        OTPChallengeRejectionReason.STALE_IDENTITY,
                    )
                decision = current.replace(
                    challenge_ref=grant_ref.challenge(challenge_id),
                    challenge_token_hash=challenge_token_hash,
                    plaintext_code=plaintext_code,
                    clock=self._clock,
                    code_hasher=self._code_hasher,
                )
                if decision.replacement is None:
                    if decision.previous != current:
                        self._apply_state(current_record, decision.previous)
                        session.flush()
                    return decision
                self._apply_state(current_record, decision.previous)
                session.add(challenge_to_record(decision.replacement))
                self._append_audit(
                    session,
                    challenge=decision.replacement,
                    previous_challenge_id=current.ref.challenge_id,
                    audit_event_id=audit_event_id,
                )
                session.flush()
                return decision
        except SQLAlchemyError as error:
            raise OTPPersistenceError("failed to replace current OTP challenge") from error

    def verify(self, challenge_ref: OTPChallengeRef, *, plaintext_code: str) -> OTPVerificationDecision:
        """Verify one current challenge under its grant lock and persist counters."""

        try:
            with self._session_maker() as session, session.begin():
                grant_record = self._lock_grant(session, challenge_ref.grant_ref)
                record = self._load_record(session, challenge_ref)
                if record is None:
                    raise ValueError("OTP challenge does not exist in the requested owner scope")
                challenge = challenge_from_record(record)
                current_identity = self._current_identity(session, grant_record, challenge_ref.grant_ref)
                if not self._identity_matches(challenge, current_identity):
                    invalidated = challenge.invalidate(clock=self._clock)
                    self._apply_state(record, invalidated)
                    session.flush()
                    return OTPVerificationDecision(
                        invalidated,
                        None,
                        OTPChallengeRejectionReason.STALE_IDENTITY,
                    )
                decision = challenge.verify(
                    plaintext_code=plaintext_code,
                    clock=self._clock,
                    code_hasher=self._code_hasher,
                )
                self._apply_state(record, decision.challenge)
                session.flush()
                return decision
        except SQLAlchemyError as error:
            raise OTPPersistenceError("failed to verify OTP challenge") from error

    def invalidate_current(self, grant_ref: ApproverGrantRef) -> OTPChallenge | None:
        """Invalidate the latest challenge in one grant scope without Form mutation."""

        try:
            with self._session_maker() as session, session.begin():
                self._lock_grant(session, grant_ref)
                record = self._load_latest_record(session, grant_ref)
                if record is None:
                    return None
                invalidated = challenge_from_record(record).invalidate(clock=self._clock)
                self._apply_state(record, invalidated)
                session.flush()
                return invalidated
        except SQLAlchemyError as error:
            raise OTPPersistenceError("failed to invalidate current OTP challenge") from error

    def load(self, challenge_ref: OTPChallengeRef) -> OTPChallenge | None:
        """Load one challenge only when every owner predicate matches."""

        try:
            with self._session_maker() as session, session.begin():
                record = self._load_record(session, challenge_ref)
                return challenge_from_record(record) if record is not None else None
        except SQLAlchemyError as error:
            raise OTPPersistenceError("failed to load OTP challenge") from error

    @staticmethod
    def _locked_grant_statement(grant_ref: ApproverGrantRef) -> sa.Select[tuple[HumanInputV2FormApproverGrant]]:
        return (
            select(HumanInputV2FormApproverGrant)
            .where(
                HumanInputV2FormApproverGrant.tenant_id == str(grant_ref.form_ref.tenant_id),
                HumanInputV2FormApproverGrant.form_id == str(grant_ref.form_ref.form_id),
                HumanInputV2FormApproverGrant.id == str(grant_ref.grant_id),
            )
            .with_for_update()
        )

    def _lock_grant(self, session: Session, grant_ref: ApproverGrantRef) -> HumanInputV2FormApproverGrant:
        grant_record = session.scalar(self._locked_grant_statement(grant_ref))
        if grant_record is None:
            raise ValueError("approver grant scope does not exist")
        return grant_record

    @staticmethod
    def _load_latest_record(
        session: Session,
        grant_ref: ApproverGrantRef,
    ) -> HumanInputV2FormOTPChallenge | None:
        return session.scalar(
            select(HumanInputV2FormOTPChallenge)
            .where(
                HumanInputV2FormOTPChallenge.tenant_id == str(grant_ref.form_ref.tenant_id),
                HumanInputV2FormOTPChallenge.form_id == str(grant_ref.form_ref.form_id),
                HumanInputV2FormOTPChallenge.approver_grant_id == str(grant_ref.grant_id),
            )
            .order_by(HumanInputV2FormOTPChallenge.created_at.desc(), HumanInputV2FormOTPChallenge.id.desc())
            .limit(1)
        )

    @staticmethod
    def _load_record(session: Session, challenge_ref: OTPChallengeRef) -> HumanInputV2FormOTPChallenge | None:
        return session.scalar(
            select(HumanInputV2FormOTPChallenge).where(
                HumanInputV2FormOTPChallenge.tenant_id == str(challenge_ref.form_ref.tenant_id),
                HumanInputV2FormOTPChallenge.form_id == str(challenge_ref.form_ref.form_id),
                HumanInputV2FormOTPChallenge.approver_grant_id == str(challenge_ref.grant_ref.grant_id),
                HumanInputV2FormOTPChallenge.id == str(challenge_ref.challenge_id),
            )
        )

    @staticmethod
    def _current_identity(
        session: Session,
        grant_record: HumanInputV2FormApproverGrant,
        grant_ref: ApproverGrantRef,
    ) -> CurrentEmailOTPIdentity:
        del session
        if grant_record.subject_type is HumanInputApproverGrantSubjectType.CONTACT:
            if grant_record.contact_id is None:
                raise ValueError("contact grant is missing contact_id")
            return CurrentEmailOTPIdentity(grant_ref, None, None)
        if grant_record.subject_type is HumanInputApproverGrantSubjectType.EMAIL_ADDRESS:
            if grant_record.normalized_email is None:
                raise ValueError("email-address grant is missing normalized_email")
            normalized_email = NormalizedEmail(grant_record.normalized_email)
            return CurrentEmailOTPIdentity(
                grant_ref,
                EmailAddressOTPSubject(normalized_email),
                normalized_email,
            )
        raise ValueError("approver grant subject does not support Email OTP")

    @staticmethod
    def _identity_matches(challenge: OTPChallenge, current_identity: CurrentEmailOTPIdentity) -> bool:
        return (
            current_identity.subject is not None
            and current_identity.normalized_email is not None
            and challenge.subject == current_identity.subject
            and challenge.normalized_email == current_identity.normalized_email
        )

    @staticmethod
    def _apply_state(record: HumanInputV2FormOTPChallenge, challenge: OTPChallenge) -> None:
        record.status = challenge.status
        record.send_count = challenge.send_count
        record.attempt_count = challenge.attempt_count
        record.verified_at = challenge.verified_at if challenge.verified_at is not None else None
        record.invalidated_at = challenge.invalidated_at if challenge.invalidated_at is not None else None
        record.updated_at = challenge.updated_at

    def _append_audit(
        self,
        session: Session,
        *,
        challenge: OTPChallenge,
        previous_challenge_id: OTPChallengeId | None,
        audit_event_id: str,
    ) -> None:
        self._audit_writer.append(
            session,
            OTPChallengeAuditFact(
                audit_event_id=audit_event_id,
                challenge_ref=challenge.ref,
                previous_challenge_id=previous_challenge_id,
                send_count=challenge.send_count,
                occurred_at=challenge.created_at,
            ),
        )
