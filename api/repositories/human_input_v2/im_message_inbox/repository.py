"""SQLAlchemy persistence for callbacks within caller-owned transactions."""

from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from core.human_input_v2.im_integration.adapters.entities import AuthenticatedIMEvent
from core.human_input_v2.im_message_inbox.contracts import (
    AcceptanceKind,
    IMInboxRecord,
    IMInboxRecordId,
    InboxAcceptance,
    InboxPersistenceError,
    canonicalize_inbox_event,
    validate_inbox_event,
)
from core.human_input_v2.shared import IntegrationId
from libs.uuid_utils import uuidv7
from models.human_input_v2 import IMMessageInbox

from .mappers import event_record, inbox_record_from_model


def _naive_utc(timestamp: datetime) -> datetime:
    if timestamp.tzinfo is None or timestamp.utcoffset() is None:
        raise ValueError("timestamp must be timezone-aware")
    return timestamp.astimezone(UTC).replace(tzinfo=None)


class SQLAlchemyIMMessageInboxRepository:
    """Flush callback changes without owning Session or transaction lifetimes."""

    def __init__(self, session: Session) -> None:
        self._session = session

    def insert_or_resolve(
        self, integration_id: IntegrationId, event: AuthenticatedIMEvent, *, now: datetime
    ) -> InboxAcceptance:
        event = canonicalize_inbox_event(event)
        validate_inbox_event(event)
        if event.event_id is not None:
            existing_id = self._session.scalar(
                select(IMMessageInbox.id).where(
                    IMMessageInbox.provider == event.provider,
                    IMMessageInbox.provider_tenant_id == event.provider_tenant_id,
                    IMMessageInbox.provider_event_id == event.event_id,
                )
            )
            if existing_id is not None:
                return InboxAcceptance(IMInboxRecordId(existing_id), AcceptanceKind.DUPLICATE)
        record_id = IMInboxRecordId(str(uuidv7()))
        self._session.add(event_record(record_id=record_id, integration_id=integration_id, event=event, now=now))
        self._session.flush()
        return InboxAcceptance(record_id, AcceptanceKind.NEW)

    def get(self, record_id: IMInboxRecordId) -> IMInboxRecord | None:
        record = self._session.get(IMMessageInbox, str(record_id))
        return inbox_record_from_model(record) if record is not None else None

    def mark_processed(self, record_id: IMInboxRecordId, *, processed_at: datetime) -> None:
        record = self._session.scalar(
            select(IMMessageInbox).where(IMMessageInbox.id == str(record_id)).with_for_update()
        )
        if record is None:
            raise InboxPersistenceError("IM callback record does not exist")
        if record.processed_at is None:
            record.processed_at = _naive_utc(processed_at)
