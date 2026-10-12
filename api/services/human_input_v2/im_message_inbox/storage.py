"""Own short inbox transactions around the persistence repository."""

from datetime import datetime

from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session, sessionmaker

from core.human_input_v2.im_integration.adapters.entities import AuthenticatedIMEvent
from core.human_input_v2.im_message_inbox.contracts import (
    IMInboxRecord,
    IMInboxRecordId,
    InboxAcceptance,
    InboxPersistenceError,
)
from core.human_input_v2.shared import IntegrationId
from repositories.human_input_v2.im_message_inbox.repository import SQLAlchemyIMMessageInboxRepository


class IMInboxStorage:
    """Commit intake before transport ACK, with no Provider I/O in transactions."""

    def __init__(self, session_factory: sessionmaker[Session]) -> None:
        self._session_factory = session_factory

    def insert_or_resolve(
        self, integration_id: IntegrationId, event: AuthenticatedIMEvent, *, now: datetime
    ) -> InboxAcceptance:
        try:
            return self._insert(integration_id, event, now=now)
        except IntegrityError as error:
            if event.event_id is None:
                raise InboxPersistenceError("failed to persist unidentified IM callback") from error
            # A competing intake may insert after the initial lookup. Its commit
            # is visible only after rolling back our failed transaction.
            try:
                return self._insert(integration_id, event, now=now)
            except SQLAlchemyError as retry_error:
                raise InboxPersistenceError("failed to resolve duplicate IM callback") from retry_error
        except SQLAlchemyError as error:
            raise InboxPersistenceError("failed to persist IM callback") from error

    def _insert(self, integration_id: IntegrationId, event: AuthenticatedIMEvent, *, now: datetime) -> InboxAcceptance:
        with self._session_factory() as session, session.begin():
            return SQLAlchemyIMMessageInboxRepository(session).insert_or_resolve(integration_id, event, now=now)

    def get(self, record_id: IMInboxRecordId) -> IMInboxRecord | None:
        try:
            with self._session_factory() as session:
                return SQLAlchemyIMMessageInboxRepository(session).get(record_id)
        except SQLAlchemyError as error:
            raise InboxPersistenceError("failed to load IM callback") from error

    def mark_processed(self, record_id: IMInboxRecordId, *, processed_at: datetime) -> None:
        try:
            with self._session_factory() as session, session.begin():
                SQLAlchemyIMMessageInboxRepository(session).mark_processed(record_id, processed_at=processed_at)
        except SQLAlchemyError as error:
            raise InboxPersistenceError("failed to mark IM callback as processed") from error
