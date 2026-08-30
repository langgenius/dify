"""PostgreSQL-only concurrency coverage for grant-scoped OTP replacement."""

from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from threading import Barrier

import pytest
import sqlalchemy as sa
from pydantic import NaiveDatetime
from sqlalchemy.orm import Session, sessionmaker

from core.human_input_v2.approval import FormRef, OTPChallengeRejectionReason, OTPCodeHash
from core.human_input_v2.entities import (
    HumanInputApproverGrantSubjectType,
    HumanInputOTPChallengeStatus,
    HumanInputV2FormKind,
    HumanInputV2FormStatus,
)
from core.human_input_v2.shared import ApproverGrantId, FormId, OTPChallengeId, TenantId
from extensions.ext_database import db
from libs.datetime_utils import naive_utc_now
from libs.uuid_utils import uuidv7
from models.human_input_v2 import (
    FormApproverGrantMatchedSources,
    FormApproverGrantSubjectSnapshot,
    HumanInputV2Form,
    HumanInputV2FormApproverGrant,
    HumanInputV2FormDefinition,
    HumanInputV2FormOTPChallenge,
)
from repositories.human_input_v2.approval.repository import (
    OTPChallengeAuditFact,
    SQLAlchemyOTPChallengeRepository,
)


class _FixedClock:
    def __init__(self, now: NaiveDatetime) -> None:
        self._now = now

    def now(self) -> NaiveDatetime:
        return self._now


class _StatelessHasher:
    def hash_code(self, plaintext_code: str) -> OTPCodeHash:
        return OTPCodeHash(f"integration:{plaintext_code}", "test")

    def verify_code(self, plaintext_code: str, code_hash: OTPCodeHash) -> bool:
        return code_hash.encoded_value == f"integration:{plaintext_code}"


class _TransactionOnlyAuditWriter:
    """Concurrency test seam; unit tests cover the concrete audit-row writer."""

    def append(self, session: Session, fact: OTPChallengeAuditFact) -> None:
        session.execute(sa.select(sa.literal(fact.audit_event_id)))


def _require_postgresql() -> None:
    if db.engine.dialect.name != "postgresql":
        pytest.skip("requires the CI PostgreSQL integration database")


def test_concurrent_resend_leaves_exactly_one_usable_challenge(flask_req_ctx) -> None:
    _require_postgresql()
    session_maker = sessionmaker(bind=db.engine, expire_on_commit=False)
    tenant_id = str(uuidv7())
    form_id = str(uuidv7())
    grant_id = str(uuidv7())
    initial_challenge_id = str(uuidv7())
    replacement_ids = (str(uuidv7()), str(uuidv7()))
    issued_at = naive_utc_now()
    grant_ref = FormRef(TenantId(tenant_id), FormId(form_id)).grant(ApproverGrantId(grant_id))
    email = f"otp-{uuidv7()}@example.com"
    form = HumanInputV2Form(
        tenant_id=tenant_id,
        app_id=str(uuidv7()),
        form_definition=HumanInputV2FormDefinition(),
        rendered_content="Approve",
        node_timeout_at=issued_at + timedelta(hours=1),
        global_expires_at=issued_at + timedelta(hours=2),
        form_kind=HumanInputV2FormKind.DELIVERY_TEST,
        status=HumanInputV2FormStatus.WAITING,
        workflow_pause_id=None,
        node_execution_id=None,
    )
    form.id = form_id
    grant = HumanInputV2FormApproverGrant(
        tenant_id=tenant_id,
        form_id=form_id,
        subject_type=HumanInputApproverGrantSubjectType.EMAIL_ADDRESS,
        subject_key="email_address:" + "a" * 64,
        matched_sources=FormApproverGrantMatchedSources(),
        subject_snapshot=FormApproverGrantSubjectSnapshot(email=email),
        normalized_email=email,
    )
    grant.id = grant_id
    with session_maker.begin() as session:
        session.add_all([form, grant])

    audit_writer = _TransactionOnlyAuditWriter()
    SQLAlchemyOTPChallengeRepository(
        session_maker,
        clock=_FixedClock(issued_at),
        code_hasher=_StatelessHasher(),
        audit_writer=audit_writer,
    ).issue_initial(
        grant_ref,
        challenge_id=OTPChallengeId(initial_challenge_id),
        audit_event_id=str(uuidv7()),
        challenge_token_hash="a" * 64,
        plaintext_code="123456",
    )
    resend_clock = _FixedClock(issued_at + timedelta(seconds=60))
    barrier = Barrier(2)

    def resend(index: int):
        barrier.wait()
        return SQLAlchemyOTPChallengeRepository(
            session_maker,
            clock=resend_clock,
            code_hasher=_StatelessHasher(),
            audit_writer=audit_writer,
        ).replace_current(
            grant_ref,
            challenge_id=OTPChallengeId(replacement_ids[index]),
            audit_event_id=str(uuidv7()),
            challenge_token_hash=("b" if index == 0 else "c") * 64,
            plaintext_code="123456",
        )

    try:
        with ThreadPoolExecutor(max_workers=2) as executor:
            results = list(executor.map(resend, range(2)))

        assert sum(result.replacement is not None for result in results) == 1
        assert [result.rejection for result in results].count(OTPChallengeRejectionReason.RESEND_COOLDOWN) == 1
        with session_maker() as session:
            records = session.scalars(
                sa.select(HumanInputV2FormOTPChallenge).where(
                    HumanInputV2FormOTPChallenge.tenant_id == tenant_id,
                    HumanInputV2FormOTPChallenge.form_id == form_id,
                    HumanInputV2FormOTPChallenge.approver_grant_id == grant_id,
                )
            ).all()
        assert len(records) == 2
        assert sum(record.status is HumanInputOTPChallengeStatus.PENDING for record in records) == 1
    finally:
        with session_maker.begin() as session:
            session.execute(
                sa.delete(HumanInputV2FormOTPChallenge).where(
                    HumanInputV2FormOTPChallenge.approver_grant_id == grant_id
                )
            )
            session.execute(
                sa.delete(HumanInputV2FormApproverGrant).where(HumanInputV2FormApproverGrant.id == grant_id)
            )
            session.execute(sa.delete(HumanInputV2Form).where(HumanInputV2Form.id == form_id))
