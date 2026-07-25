"""Transaction-scoped OTP issuance writer for the shared form audit table.

The writer only adds a mapped record to the caller-owned Session. It never
flushes or commits, so a later OTP challenge failure rolls the audit fact back
with the preceding proof-session transaction.
"""

from sqlalchemy.orm import Session

from core.human_input_v2.approval import (
    FormAuthorizationAuditEvent,
    FormAuthorizationAuditEventType,
    FrozenJSONObject,
)
from core.human_input_v2.entities import HumanInputDeliveryChannel
from core.human_input_v2.shared import AuditEventId
from repositories.human_input_v2.approval import OTPChallengeAuditFact

from .mappers import audit_event_to_record


class SQLAlchemyOTPChallengeAuditWriter:
    """Map one secret-free OTP issuance fact into the caller transaction."""

    def append(self, session: Session, fact: OTPChallengeAuditFact) -> None:
        """Add the shared audit record without changing transaction ownership."""

        event = FormAuthorizationAuditEvent(
            id=AuditEventId(fact.audit_event_id),
            event_type=FormAuthorizationAuditEventType.OTP_CHALLENGE_ISSUED,
            form_ref=fact.challenge_ref.form_ref,
            approver_grant_id=fact.challenge_ref.grant_ref.grant_id,
            endpoint_id=None,
            channel=HumanInputDeliveryChannel.EMAIL,
            reason_code=None,
            reason_message=None,
            authorization_proof=None,
            payload=FrozenJSONObject.from_mapping(
                {
                    "challenge_id": str(fact.challenge_ref.challenge_id),
                    "previous_challenge_id": (
                        str(fact.previous_challenge_id) if fact.previous_challenge_id is not None else None
                    ),
                    "send_count": fact.send_count,
                }
            ),
            occurred_at=fact.occurred_at,
            created_at=fact.occurred_at,
            updated_at=fact.occurred_at,
        )
        session.add(audit_event_to_record(event))


__all__ = ["SQLAlchemyOTPChallengeAuditWriter"]
