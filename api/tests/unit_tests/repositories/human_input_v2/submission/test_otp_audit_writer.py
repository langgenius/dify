"""Concrete shared-audit writer contracts for the preceding OTP adapter port."""

from datetime import datetime

import pytest
import sqlalchemy as sa
from sqlalchemy import select
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from core.human_input_v2.approval import FormAuthorizationAuditEventType, FormRef
from core.human_input_v2.shared import (
    ApproverGrantId,
    FormId,
    OTPChallengeId,
    TenantId,
)
from models.human_input_v2 import HumanInputV2FormAuditEvent
from repositories.human_input_v2.approval import OTPChallengeAuditFact
from repositories.human_input_v2.submission.otp_audit_writer import SQLAlchemyOTPChallengeAuditWriter

_NOW = datetime(2026, 7, 25, 8)
_GRANT_REF = FormRef(TenantId("workspace-1"), FormId("form-1")).grant(ApproverGrantId("grant-1"))


@pytest.fixture
def audit_engine(sqlite_engine: Engine) -> Engine:
    HumanInputV2FormAuditEvent.metadata.create_all(sqlite_engine, tables=[HumanInputV2FormAuditEvent.__table__])
    return sqlite_engine


def _fact(*, audit_event_id: str = "audit-1") -> OTPChallengeAuditFact:
    return OTPChallengeAuditFact(
        audit_event_id=audit_event_id,
        challenge_ref=_GRANT_REF.challenge(OTPChallengeId("challenge-1")),
        previous_challenge_id=OTPChallengeId("previous-challenge"),
        send_count=2,
        occurred_at=_NOW,
    )


def test_writer_appends_secret_free_structured_fact_through_the_caller_session(audit_engine: Engine) -> None:
    writer = SQLAlchemyOTPChallengeAuditWriter()

    with Session(audit_engine) as session, session.begin():
        writer.append(session, _fact())

    with Session(audit_engine) as session:
        record = session.get_one(HumanInputV2FormAuditEvent, "audit-1")
        assert record.event_type == FormAuthorizationAuditEventType.OTP_CHALLENGE_ISSUED.value
        assert record.tenant_id == "workspace-1"
        assert record.form_id == "form-1"
        assert record.approver_grant_id == "grant-1"
        assert record.authorization_proof is None
        assert record.event_payload is not None
        assert record.event_payload.root == {
            "challenge_id": "challenge-1",
            "previous_challenge_id": "previous-challenge",
            "send_count": 2,
        }


def test_writer_fact_rolls_back_with_any_later_failure_in_the_same_session(audit_engine: Engine) -> None:
    writer = SQLAlchemyOTPChallengeAuditWriter()

    def append_duplicate_fact() -> None:
        with Session(audit_engine) as session, session.begin():
            writer.append(session, _fact())
            writer.append(session, _fact())

    with pytest.raises(sa.exc.IntegrityError):
        append_duplicate_fact()

    with Session(audit_engine) as session:
        assert session.scalar(select(sa.func.count(HumanInputV2FormAuditEvent.id))) == 0
