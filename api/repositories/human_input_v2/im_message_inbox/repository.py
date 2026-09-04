"""Transactional SQLAlchemy adapter for durable IM callback records."""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session, sessionmaker

from core.human_input_v2.im_integration.adapters.entities import AuthenticatedIMEvent
from core.human_input_v2.im_message_inbox import (
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
    """Persist callback facts and their successful processing timestamp."""

    def __init__(self, session_maker: sessionmaker[Session]) -> None:
        self._session_maker = session_maker

    def insert_or_resolve(
        self, integration_id: IntegrationId, event: AuthenticatedIMEvent, *, now: datetime
    ) -> InboxAcceptance:
        """Commit all callback facts, resolving only real Provider event IDs."""

        event = canonicalize_inbox_event(event)
        validate_inbox_event(event)
        record_id = IMInboxRecordId(str(uuidv7()))
        try:
            with self._session_maker() as session, session.begin():
                session.add(event_record(record_id=record_id, integration_id=integration_id, event=event, now=now))
                session.flush()
        except IntegrityError as error:
            if event.event_id is None:
                raise InboxPersistenceError("failed to persist unidentified IM callback") from error
            return self._resolve_duplicate(event)
        except (SQLAlchemyError, TypeError, ValueError) as error:
            raise InboxPersistenceError("failed to persist IM callback") from error
        return InboxAcceptance(record_id, AcceptanceKind.NEW)

    def _resolve_duplicate(self, event: AuthenticatedIMEvent) -> InboxAcceptance:
        try:
            with self._session_maker() as session:
                existing_id = session.scalar(
                    select(IMMessageInbox.id).where(
                        IMMessageInbox.provider == event.provider,
                        IMMessageInbox.provider_tenant_id == event.provider_tenant_id,
                        IMMessageInbox.provider_event_id == event.event_id,
                    )
                )
        except SQLAlchemyError as error:
            raise InboxPersistenceError("failed to resolve duplicate IM callback") from error
        if existing_id is None:
            raise InboxPersistenceError("duplicate IM callback could not be resolved")
        return InboxAcceptance(IMInboxRecordId(existing_id), AcceptanceKind.DUPLICATE)

    def get(self, record_id: IMInboxRecordId) -> IMInboxRecord | None:
        """Load one callback without creating execution ownership state."""

        try:
            with self._session_maker() as session:
                record = session.get(IMMessageInbox, str(record_id))
                return inbox_record_from_model(record) if record is not None else None
        except (SQLAlchemyError, TypeError, ValueError) as error:
            raise InboxPersistenceError("failed to load IM callback") from error

    def mark_processed(self, record_id: IMInboxRecordId, *, processed_at: datetime) -> None:
        """Idempotently record successful processing without worker metadata."""

        processed_at_value = _naive_utc(processed_at)
        try:
            with self._session_maker() as session, session.begin():
                record = session.scalar(
                    select(IMMessageInbox).where(IMMessageInbox.id == str(record_id)).with_for_update()
                )
                if record is None:
                    raise InboxPersistenceError("IM callback record does not exist")
                if record.processed_at is None:
                    record.processed_at = processed_at_value
        except InboxPersistenceError:
            raise
        except (SQLAlchemyError, TypeError, ValueError) as error:
            raise InboxPersistenceError("failed to mark IM callback as processed") from error
