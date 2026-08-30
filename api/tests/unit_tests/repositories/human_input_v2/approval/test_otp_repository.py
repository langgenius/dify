"""Transaction, owner-scope, and rollback contracts for the OTP adapter."""

from __future__ import annotations

from dataclasses import fields
from datetime import datetime, timedelta

import pytest
import sqlalchemy as sa
from pydantic import NaiveDatetime
from sqlalchemy.dialects import postgresql
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from core.human_input_v2.approval import (
    EmailAddressOTPSubject,
    FormRef,
    OTPChallengeRejectionReason,
    OTPCodeHash,
)
from core.human_input_v2.entities import (
    HumanInputApproverGrantSubjectType,
    HumanInputOTPChallengeStatus,
    HumanInputV2FormKind,
    HumanInputV2FormStatus,
)
from core.human_input_v2.shared import (
    ApproverGrantId,
    FormId,
    NormalizedEmail,
    OTPChallengeId,
    TenantId,
)
from models.human_input_v2 import (
    ContactSubjectType,
    FormApproverGrantMatchedSources,
    FormApproverGrantSubjectSnapshot,
    HumanInputContactIdentity,
    HumanInputExternalContactProfile,
    HumanInputV2Form,
    HumanInputV2FormApproverGrant,
    HumanInputV2FormDefinition,
    HumanInputV2FormOTPChallenge,
)
from repositories.human_input_v2.approval.repository import (
    OTPChallengeAuditFact,
    OTPPersistenceError,
    SQLAlchemyOTPChallengeRepository,
)

_NOW = datetime(2026, 7, 25, 8)
_TENANT_ID = TenantId("workspace-1")
_FORM_REF = FormRef(_TENANT_ID, FormId("form-1"))
_GRANT_REF = _FORM_REF.grant(ApproverGrantId("grant-1"))
_RAW_CODE = "123456"
_AUDIT_METADATA = sa.MetaData()
_AUDIT_TABLE = sa.Table(
    "test_human_input_v2_otp_audit_facts",
    _AUDIT_METADATA,
    sa.Column("id", sa.String(64), primary_key=True),
    sa.Column("event_type", sa.String(64), nullable=False),
    sa.Column("challenge_id", sa.String(64), nullable=False),
    sa.Column("previous_challenge_id", sa.String(64), nullable=True),
    sa.Column("send_count", sa.Integer, nullable=False),
    sa.Column("occurred_at", sa.DateTime, nullable=False),
)


class _MutableClock:
    current: NaiveDatetime

    def __init__(self) -> None:
        self.current = _NOW

    def now(self) -> NaiveDatetime:
        return self.current

    def advance(self, delta: timedelta) -> None:
        self.current = self.current + delta


class _DeterministicHasher:
    hash_calls: list[str]
    verify_calls: list[str]
    fail_hash: bool

    def __init__(self) -> None:
        self.hash_calls = []
        self.verify_calls = []
        self.fail_hash = False

    def hash_code(self, plaintext_code: str) -> OTPCodeHash:
        self.hash_calls.append(plaintext_code)
        if self.fail_hash:
            raise RuntimeError("hash failed")
        return OTPCodeHash(f"encoded:{plaintext_code}", "test")

    def verify_code(self, plaintext_code: str, code_hash: OTPCodeHash) -> bool:
        self.verify_calls.append(plaintext_code)
        return code_hash.encoded_value == f"encoded:{plaintext_code}"


class _FailingAuditWriter:
    def append(self, session: Session, fact: OTPChallengeAuditFact) -> None:
        del session, fact
        raise RuntimeError("audit failed")


class _TransactionalAuditWriter:
    """Test-only audit sink proving the port participates in the caller transaction."""

    def append(self, session: Session, fact: OTPChallengeAuditFact) -> None:
        assert session.in_transaction()
        session.execute(
            sa.insert(_AUDIT_TABLE).values(
                id=fact.audit_event_id,
                event_type=("otp_challenge_issued" if fact.previous_challenge_id is None else "otp_challenge_replaced"),
                challenge_id=str(fact.challenge_ref.challenge_id),
                previous_challenge_id=(
                    str(fact.previous_challenge_id) if fact.previous_challenge_id is not None else None
                ),
                send_count=fact.send_count,
                occurred_at=fact.occurred_at,
            )
        )


@pytest.fixture
def repository_context(
    sqlite_engine: Engine,
) -> tuple[
    SQLAlchemyOTPChallengeRepository,
    sessionmaker[Session],
    _MutableClock,
    _DeterministicHasher,
]:
    _AUDIT_TABLE.create(sqlite_engine)
    session_maker = sessionmaker(bind=sqlite_engine, expire_on_commit=False)
    _seed_email_form_and_grant(session_maker)
    clock = _MutableClock()
    hasher = _DeterministicHasher()
    repository = SQLAlchemyOTPChallengeRepository(
        session_maker,
        clock=clock,
        code_hasher=hasher,
        audit_writer=_TransactionalAuditWriter(),
    )
    return repository, session_maker, clock, hasher


def _seed_email_form_and_grant(session_maker: sessionmaker[Session]) -> None:
    form = HumanInputV2Form(
        tenant_id="workspace-1",
        app_id="app-1",
        form_definition=HumanInputV2FormDefinition(),
        rendered_content="Approve",
        node_timeout_at=_NOW + timedelta(hours=1),
        global_expires_at=_NOW + timedelta(hours=2),
        form_kind=HumanInputV2FormKind.DELIVERY_TEST,
        status=HumanInputV2FormStatus.WAITING,
        workflow_pause_id=None,
        node_execution_id=None,
    )
    form.id = "form-1"
    grant = HumanInputV2FormApproverGrant(
        tenant_id="workspace-1",
        form_id="form-1",
        subject_type=HumanInputApproverGrantSubjectType.EMAIL_ADDRESS,
        subject_key="email_address:" + "a" * 64,
        matched_sources=FormApproverGrantMatchedSources(),
        subject_snapshot=FormApproverGrantSubjectSnapshot(email="reviewer@example.com"),
        normalized_email="reviewer@example.com",
    )
    grant.id = "grant-1"
    with session_maker.begin() as session:
        session.add_all([form, grant])


def _issue_initial(repository: SQLAlchemyOTPChallengeRepository, *, token_hash: str = "a" * 64):
    return repository.issue_initial(
        _GRANT_REF,
        challenge_id=OTPChallengeId("challenge-1"),
        audit_event_id="audit-1",
        challenge_token_hash=token_hash,
        plaintext_code=_RAW_CODE,
    )


def test_audit_fact_type_exposes_no_challenge_or_hash_material() -> None:
    assert {field.name for field in fields(OTPChallengeAuditFact)} == {
        "audit_event_id",
        "challenge_ref",
        "previous_challenge_id",
        "send_count",
        "occurred_at",
    }


def test_initial_issue_persists_current_challenge_and_secret_free_audit_without_touching_form(
    repository_context,
) -> None:
    repository, session_maker, _clock, hasher = repository_context

    challenge = _issue_initial(repository)

    assert challenge.subject == EmailAddressOTPSubject(NormalizedEmail("reviewer@example.com"))
    assert challenge.send_count == 1
    assert hasher.hash_calls == [_RAW_CODE]
    assert repository.load(challenge.ref) == challenge
    with session_maker() as session:
        record = session.get_one(HumanInputV2FormOTPChallenge, "challenge-1")
        audit = session.execute(sa.select(_AUDIT_TABLE).where(_AUDIT_TABLE.c.id == "audit-1")).one()._mapping
        assert record.code_hash == f"encoded:{_RAW_CODE}"
        assert _RAW_CODE not in str(dict(audit))
        assert not any("hash" in key or "code" in key for key in audit)
        assert audit["event_type"] == "otp_challenge_issued"
        assert audit["challenge_id"] == "challenge-1"
        assert audit["previous_challenge_id"] is None
        assert audit["send_count"] == 1
        assert session.get_one(HumanInputV2Form, "form-1").status is HumanInputV2FormStatus.WAITING


def test_replacement_at_exact_cooldown_invalidates_previous_and_leaves_one_usable_challenge(
    repository_context,
) -> None:
    repository, session_maker, clock, _hasher = repository_context
    _issue_initial(repository)
    clock.advance(timedelta(seconds=60))

    decision = repository.replace_current(
        _GRANT_REF,
        challenge_id=OTPChallengeId("challenge-2"),
        audit_event_id="audit-2",
        challenge_token_hash="b" * 64,
        plaintext_code=_RAW_CODE,
    )

    assert decision.rejection is None
    assert decision.previous.status is HumanInputOTPChallengeStatus.INVALIDATED
    assert decision.replacement is not None
    assert decision.replacement.send_count == 2
    with session_maker() as session:
        records = session.scalars(
            sa.select(HumanInputV2FormOTPChallenge).order_by(HumanInputV2FormOTPChallenge.id)
        ).all()
        assert [(record.id, record.status) for record in records] == [
            ("challenge-1", HumanInputOTPChallengeStatus.INVALIDATED),
            ("challenge-2", HumanInputOTPChallengeStatus.PENDING),
        ]
        assert sum(record.status is HumanInputOTPChallengeStatus.PENDING for record in records) == 1
        assert session.scalar(sa.select(_AUDIT_TABLE.c.event_type).where(_AUDIT_TABLE.c.id == "audit-2")) == (
            "otp_challenge_replaced"
        )


def test_cooldown_rejection_preserves_counters_and_does_not_hash_write_or_audit(repository_context) -> None:
    repository, session_maker, clock, hasher = repository_context
    initial = _issue_initial(repository)
    clock.advance(timedelta(seconds=59, microseconds=999999))
    previous_hash_calls = len(hasher.hash_calls)

    decision = repository.replace_current(
        _GRANT_REF,
        challenge_id=OTPChallengeId("challenge-2"),
        audit_event_id="audit-2",
        challenge_token_hash="b" * 64,
        plaintext_code=_RAW_CODE,
    )

    assert decision.rejection is OTPChallengeRejectionReason.RESEND_COOLDOWN
    assert decision.previous == initial
    assert len(hasher.hash_calls) == previous_hash_calls
    with session_maker() as session:
        assert session.scalar(sa.select(sa.func.count(HumanInputV2FormOTPChallenge.id))) == 1
        assert _audit_count(session) == 1


@pytest.mark.parametrize(
    "elapsed",
    [timedelta(minutes=10), timedelta(minutes=10, microseconds=1)],
    ids=["exact-boundary", "past-boundary"],
)
def test_expired_replacement_persists_expired_without_hash_write_or_audit(
    repository_context,
    elapsed: timedelta,
) -> None:
    repository, session_maker, clock, hasher = repository_context
    initial = _issue_initial(repository)
    clock.advance(elapsed)
    previous_hash_calls = len(hasher.hash_calls)

    decision = repository.replace_current(
        _GRANT_REF,
        challenge_id=OTPChallengeId("challenge-2"),
        audit_event_id="audit-2",
        challenge_token_hash="b" * 64,
        plaintext_code=_RAW_CODE,
    )

    assert decision.rejection is OTPChallengeRejectionReason.EXPIRED
    assert decision.previous.status is HumanInputOTPChallengeStatus.EXPIRED
    assert decision.previous.send_count == initial.send_count
    assert decision.previous.attempt_count == initial.attempt_count
    assert decision.replacement is None
    assert len(hasher.hash_calls) == previous_hash_calls
    with session_maker() as session:
        records = session.scalars(sa.select(HumanInputV2FormOTPChallenge)).all()
        assert len(records) == 1
        assert records[0].status is HumanInputOTPChallengeStatus.EXPIRED
        assert records[0].send_count == initial.send_count
        assert records[0].attempt_count == initial.attempt_count
        assert records[0].code_hash == initial.code_hash.encoded_value
        assert _audit_count(session) == 1


def test_verification_persists_attempts_and_returns_limited_proof_without_form_transition(repository_context) -> None:
    repository, session_maker, clock, hasher = repository_context
    challenge = _issue_initial(repository)
    clock.advance(timedelta(seconds=10))

    invalid = repository.verify(challenge.ref, plaintext_code="000000")
    verified = repository.verify(challenge.ref, plaintext_code=_RAW_CODE)

    assert invalid.rejection is OTPChallengeRejectionReason.INVALID_CODE
    assert invalid.challenge.attempt_count == 1
    assert verified.rejection is None
    assert verified.challenge.attempt_count == 2
    assert verified.proof is not None
    assert verified.proof.subject == EmailAddressOTPSubject(NormalizedEmail("reviewer@example.com"))
    assert hasher.verify_calls == ["000000", _RAW_CODE]
    with session_maker() as session:
        record = session.get_one(HumanInputV2FormOTPChallenge, "challenge-1")
        assert record.status is HumanInputOTPChallengeStatus.VERIFIED
        assert record.attempt_count == 2
        assert session.get_one(HumanInputV2Form, "form-1").status is HumanInputV2FormStatus.WAITING


def test_attempt_limit_rejection_preserves_fifth_count_and_avoids_hash_work(repository_context) -> None:
    repository, _session_maker, _clock, hasher = repository_context
    challenge = _issue_initial(repository)
    for _index in range(5):
        decision = repository.verify(challenge.ref, plaintext_code="000000")
        assert decision.rejection is OTPChallengeRejectionReason.INVALID_CODE

    previous_verify_calls = len(hasher.verify_calls)
    rejected = repository.verify(challenge.ref, plaintext_code="000000")

    assert rejected.rejection is OTPChallengeRejectionReason.ATTEMPT_LIMIT_REACHED
    assert rejected.challenge.attempt_count == 5
    assert len(hasher.verify_calls) == previous_verify_calls


def test_expired_verification_persists_terminal_state_without_consuming_attempt(repository_context) -> None:
    repository, session_maker, clock, hasher = repository_context
    challenge = _issue_initial(repository)
    clock.advance(timedelta(minutes=10))

    decision = repository.verify(challenge.ref, plaintext_code=_RAW_CODE)

    assert decision.rejection is OTPChallengeRejectionReason.EXPIRED
    assert decision.challenge.attempt_count == 0
    assert hasher.verify_calls == []
    with session_maker() as session:
        assert session.get_one(HumanInputV2FormOTPChallenge, "challenge-1").status is (
            HumanInputOTPChallengeStatus.EXPIRED
        )


def test_explicit_invalidation_is_grant_scoped_and_preserves_counters(repository_context) -> None:
    repository, session_maker, _clock, _hasher = repository_context
    challenge = _issue_initial(repository)

    invalidated = repository.invalidate_current(_GRANT_REF)

    assert invalidated is not None
    assert invalidated.status is HumanInputOTPChallengeStatus.INVALIDATED
    assert invalidated.send_count == challenge.send_count
    assert invalidated.attempt_count == challenge.attempt_count
    with session_maker() as session:
        assert session.get_one(HumanInputV2FormOTPChallenge, "challenge-1").status is (
            HumanInputOTPChallengeStatus.INVALIDATED
        )


def test_owner_mismatch_fails_closed_without_loading_or_mutating_challenge(repository_context) -> None:
    repository, session_maker, _clock, _hasher = repository_context
    challenge = _issue_initial(repository)
    wrong_ref = FormRef(TenantId("other-workspace"), FormId("form-1")).grant(ApproverGrantId("grant-1"))

    assert repository.load(wrong_ref.challenge(challenge.ref.challenge_id)) is None
    with pytest.raises(ValueError, match="grant scope"):
        repository.replace_current(
            wrong_ref,
            challenge_id=OTPChallengeId("challenge-2"),
            audit_event_id="audit-2",
            challenge_token_hash="b" * 64,
            plaintext_code=_RAW_CODE,
        )
    with session_maker() as session:
        assert session.get_one(HumanInputV2FormOTPChallenge, "challenge-1").status is (
            HumanInputOTPChallengeStatus.PENDING
        )


def test_hash_failure_rolls_back_without_invalidating_previous_or_appending_audit(repository_context) -> None:
    repository, session_maker, clock, hasher = repository_context
    _issue_initial(repository)
    clock.advance(timedelta(seconds=60))
    hasher.fail_hash = True

    with pytest.raises(RuntimeError, match="hash failed"):
        repository.replace_current(
            _GRANT_REF,
            challenge_id=OTPChallengeId("challenge-2"),
            audit_event_id="audit-2",
            challenge_token_hash="b" * 64,
            plaintext_code=_RAW_CODE,
        )

    _assert_only_initial_pending(session_maker)


def test_audit_failure_rolls_back_invalidation_and_replacement(repository_context) -> None:
    initial_repository, session_maker, clock, hasher = repository_context
    _issue_initial(initial_repository)
    repository = SQLAlchemyOTPChallengeRepository(
        session_maker,
        clock=clock,
        code_hasher=hasher,
        audit_writer=_FailingAuditWriter(),
    )
    clock.advance(timedelta(seconds=60))

    with pytest.raises(RuntimeError, match="audit failed"):
        repository.replace_current(
            _GRANT_REF,
            challenge_id=OTPChallengeId("challenge-2"),
            audit_event_id="audit-2",
            challenge_token_hash="b" * 64,
            plaintext_code=_RAW_CODE,
        )

    _assert_only_initial_pending(session_maker)


def test_replacement_write_failure_rolls_back_invalidation_and_audit(repository_context) -> None:
    repository, session_maker, clock, _hasher = repository_context
    _issue_initial(repository)
    clock.advance(timedelta(seconds=60))

    with pytest.raises(OTPPersistenceError):
        repository.replace_current(
            _GRANT_REF,
            challenge_id=OTPChallengeId("challenge-2"),
            audit_event_id="audit-2",
            challenge_token_hash="a" * 64,
            plaintext_code=_RAW_CODE,
        )

    _assert_only_initial_pending(session_maker)


def test_initial_issue_rejects_existing_challenge_without_hashing_or_audit(repository_context) -> None:
    repository, session_maker, _clock, hasher = repository_context
    _issue_initial(repository)
    previous_hash_calls = len(hasher.hash_calls)

    with pytest.raises(ValueError, match="already exists"):
        repository.issue_initial(
            _GRANT_REF,
            challenge_id=OTPChallengeId("challenge-2"),
            audit_event_id="audit-2",
            challenge_token_hash="b" * 64,
            plaintext_code=_RAW_CODE,
        )

    assert len(hasher.hash_calls) == previous_hash_calls
    with session_maker() as session:
        assert session.scalar(sa.select(sa.func.count(HumanInputV2FormOTPChallenge.id))) == 1
        assert _audit_count(session) == 1


def test_initial_issue_fails_closed_for_contact_grant_even_when_current_contact_has_email(repository_context) -> None:
    repository, session_maker, _clock, hasher = repository_context
    with session_maker.begin() as session:
        identity = HumanInputContactIdentity(subject_type=ContactSubjectType.EXTERNAL)
        identity.id = "contact-1"
        identity.created_at = _NOW
        identity.updated_at = _NOW
        profile = HumanInputExternalContactProfile(
            contact_id="contact-1",
            tenant_id="workspace-1",
            name="Reviewer",
            normalized_name="reviewer",
            email="reviewer@example.com",
            normalized_email="reviewer@example.com",
        )
        profile.created_at = _NOW
        profile.updated_at = _NOW
        grant = session.get_one(HumanInputV2FormApproverGrant, "grant-1")
        grant.subject_type = HumanInputApproverGrantSubjectType.CONTACT
        grant.subject_key = "contact:contact-1"
        grant.contact_id = "contact-1"
        grant.normalized_email = None
        session.add_all((identity, profile))

    with pytest.raises(ValueError, match="no current Email identity"):
        _issue_initial(repository)

    assert hasher.hash_calls == []
    with session_maker() as session:
        assert session.scalar(sa.select(sa.func.count(HumanInputV2FormOTPChallenge.id))) == 0


def test_replace_verify_and_invalidate_fail_closed_when_challenge_is_missing(repository_context) -> None:
    repository, _session_maker, _clock, _hasher = repository_context
    missing_ref = _GRANT_REF.challenge(OTPChallengeId("missing-challenge"))

    with pytest.raises(ValueError, match="current OTP challenge"):
        repository.replace_current(
            _GRANT_REF,
            challenge_id=OTPChallengeId("challenge-2"),
            audit_event_id="audit-2",
            challenge_token_hash="b" * 64,
            plaintext_code=_RAW_CODE,
        )
    with pytest.raises(ValueError, match="does not exist"):
        repository.verify(missing_ref, plaintext_code=_RAW_CODE)
    assert repository.invalidate_current(_GRANT_REF) is None


def test_email_address_grant_remains_usable(repository_context) -> None:
    repository, _session_maker, _clock, _hasher = repository_context
    challenge = _issue_initial(repository)

    assert challenge.normalized_email == NormalizedEmail("reviewer@example.com")
    assert challenge.subject == EmailAddressOTPSubject(challenge.normalized_email)


def _assert_only_initial_pending(session_maker: sessionmaker[Session]) -> None:
    with session_maker() as session:
        records = session.scalars(sa.select(HumanInputV2FormOTPChallenge)).all()
        assert [(record.id, record.status) for record in records] == [
            ("challenge-1", HumanInputOTPChallengeStatus.PENDING)
        ]
        assert _audit_count(session) == 1


def _audit_count(session: Session) -> int:
    return session.scalar(sa.select(sa.func.count()).select_from(_AUDIT_TABLE)) or 0


def test_locked_grant_statement_has_complete_owner_predicates_and_for_update() -> None:
    statement = SQLAlchemyOTPChallengeRepository._locked_grant_statement(_GRANT_REF)
    compiled = str(statement.compile(dialect=postgresql.dialect(), compile_kwargs={"literal_binds": True}))

    assert "human_input_v2_form_approver_grants.tenant_id = 'workspace-1'" in compiled
    assert "human_input_v2_form_approver_grants.form_id = 'form-1'" in compiled
    assert "human_input_v2_form_approver_grants.id = 'grant-1'" in compiled
    assert compiled.endswith("FOR UPDATE")
