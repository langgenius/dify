"""
SQLAlchemy implementation of the MessageRepository protocol.
"""

from collections.abc import Sequence
from contextlib import contextmanager

from sqlalchemy import asc, desc, select
from sqlalchemy.orm import Session, sessionmaker

from core.message.exceptions import FirstMessageNotFoundError, LastMessageNotFoundError
from core.message.repositories.message_repository import MessageRepository
from models.model import Message


class SQLAlchemyMessageRepository(MessageRepository):
    """
    SQLAlchemy-based repository for message persistence operations.

    The repository supports dependency injection via sessionmaker and can
    participate in existing transactions by accepting an optional Session.
    """

    def __init__(self, session_maker: sessionmaker):
        self._session_maker = session_maker

    @contextmanager
    def _session_scope(self, provided_session: Session | None):
        if provided_session is not None:
            yield provided_session
        else:
            with self._session_maker() as session:
                yield session

    def get_paginated_messages_by_first_id(
        self,
        conversation_id: str,
        first_id: str | None,
        limit: int,
        session: Session | None = None,
    ) -> tuple[list[Message], bool]:
        fetch_limit = limit + 1

        with self._session_scope(session) as db_session:
            conversation_query = db_session.query(Message).where(Message.conversation_id == conversation_id)

            if first_id:
                first_message = conversation_query.where(Message.id == first_id).first()
                if not first_message:
                    raise FirstMessageNotFoundError()

                history_query = conversation_query.where(
                    Message.created_at < first_message.created_at,
                    Message.id != first_message.id,
                )
            else:
                history_query = conversation_query

            history_messages = history_query.order_by(Message.created_at.desc()).limit(fetch_limit).all()

        has_more = len(history_messages) > limit
        if has_more:
            history_messages = history_messages[:-1]

        return history_messages, has_more

    def get_paginated_messages_by_last_id(
        self,
        conversation_id: str | None,
        include_ids: Sequence[str] | None,
        last_id: str | None,
        limit: int,
        session: Session | None = None,
    ) -> tuple[list[Message], bool]:
        if include_ids is not None and len(include_ids) == 0:
            return [], False

        fetch_limit = limit + 1

        with self._session_scope(session) as db_session:
            base_query = db_session.query(Message)

            if conversation_id is not None:
                base_query = base_query.where(Message.conversation_id == conversation_id)

            if include_ids is not None:
                base_query = base_query.where(Message.id.in_(include_ids))

            if last_id:
                last_message = base_query.where(Message.id == last_id).first()
                if not last_message:
                    raise LastMessageNotFoundError()

                history_query = base_query.where(
                    Message.created_at < last_message.created_at,
                    Message.id != last_message.id,
                )
            else:
                history_query = base_query

            history_messages = history_query.order_by(Message.created_at.desc()).limit(fetch_limit).all()

        has_more = len(history_messages) > limit
        if has_more:
            history_messages = history_messages[:-1]

        return history_messages, has_more

    def get_message_for_user(
        self,
        app_id: str,
        from_source: str,
        from_end_user_id: str | None,
        from_account_id: str | None,
        message_id: str,
        session: Session | None = None,
    ) -> Message | None:
        with self._session_scope(session) as db_session:
            return (
                db_session.query(Message)
                .where(
                    Message.id == message_id,
                    Message.app_id == app_id,
                    Message.from_source == from_source,
                    Message.from_end_user_id == from_end_user_id,
                    Message.from_account_id == from_account_id,
                )
                .first()
            )

    def get_by_id(self, message_id: str, session: Session | None = None) -> Message | None:
        with self._session_scope(session) as db_session:
            return db_session.scalar(select(Message).where(Message.id == message_id))

    def get_latest_for_app(self, app_id: str, session: Session | None = None) -> Message | None:
        with self._session_scope(session) as db_session:
            return db_session.query(Message).where(Message.app_id == app_id).order_by(Message.created_at.desc()).first()

    def get_conversation_messages(
        self,
        conversation_id: str,
        limit: int | None = None,
        order: str = "desc",
        session: Session | None = None,
    ) -> list[Message]:
        ordering = desc(Message.created_at) if order.lower() == "desc" else asc(Message.created_at)

        with self._session_scope(session) as db_session:
            query = db_session.query(Message).where(Message.conversation_id == conversation_id).order_by(ordering)

            if limit is not None:
                query = query.limit(limit)

            return query.all()

    def save(self, message: Message, session: Session | None = None) -> Message:
        with self._session_scope(session) as db_session:
            persisted = db_session.merge(message)
            if session is None:
                db_session.commit()
            return persisted

    def get_by_conversation_and_workflow_run(
        self,
        conversation_id: str,
        workflow_run_id: str,
        session: Session | None = None,
    ) -> Message | None:
        with self._session_scope(session) as db_session:
            return (
                db_session.query(Message)
                .where(
                    Message.conversation_id == conversation_id,
                    Message.workflow_run_id == workflow_run_id,
                )
                .first()
            )
