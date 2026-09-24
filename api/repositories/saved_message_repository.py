from typing import cast, override

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from models.enums import CreatorUserRole
from models.model import Message
from models.web import SavedMessage
from services.errors.message import LastMessageNotExistsError, MessageNotExistsError
from services.saved_message_service import (
    SavedMessageActor,
    SavedMessageFeedback,
    SavedMessageFileRecord,
    SavedMessageInputValue,
    SavedMessagePage,
    SavedMessageRecord,
    SavedMessageStore,
)


class SQLAlchemySavedMessageRepository(SavedMessageStore):
    def __init__(self, *, session_factory: sessionmaker[Session]) -> None:
        self._session_factory = session_factory

    @override
    def pagination_by_last_id(
        self,
        *,
        app_id: str,
        actor: SavedMessageActor,
        last_id: str | None,
        limit: int,
    ) -> SavedMessagePage:
        with self._session_factory() as session:
            message_ids = session.scalars(
                select(SavedMessage.message_id)
                .where(
                    SavedMessage.app_id == app_id,
                    SavedMessage.created_by_role == actor.role,
                    SavedMessage.created_by == actor.id,
                )
                .order_by(SavedMessage.created_at.desc())
            ).all()
            if not message_ids:
                return SavedMessagePage(limit=limit, has_more=False, data=())

            stmt = select(Message).where(Message.id.in_(message_ids))
            fetch_limit = limit + 1
            if last_id:
                last_message = session.scalar(stmt.where(Message.id == last_id).limit(1))
                if last_message is None:
                    raise LastMessageNotExistsError("The last_id cursor does not belong to the current saved messages.")
                stmt = stmt.where(Message.created_at < last_message.created_at, Message.id != last_message.id)

            messages = list(session.scalars(stmt.order_by(Message.created_at.desc()).limit(fetch_limit)).all())
            has_more = len(messages) > limit
            if has_more:
                messages = messages[:limit]

            return SavedMessagePage(
                limit=limit,
                has_more=has_more,
                data=tuple(self._to_record(message=message, session=session) for message in messages),
            )

    @override
    def save(self, *, app_id: str, actor: SavedMessageActor, message_id: str) -> None:
        with self._session_factory() as session:
            saved_message = session.scalar(
                select(SavedMessage)
                .where(
                    SavedMessage.app_id == app_id,
                    SavedMessage.message_id == message_id,
                    SavedMessage.created_by_role == actor.role,
                    SavedMessage.created_by == actor.id,
                )
                .limit(1)
            )
            if saved_message is not None:
                return

            message = session.scalar(
                select(Message)
                .where(
                    Message.id == message_id,
                    Message.app_id == app_id,
                    Message.from_source == ("console" if actor.role == "account" else "api"),
                    Message.from_end_user_id == (actor.id if actor.role == "end_user" else None),
                    Message.from_account_id == (actor.id if actor.role == "account" else None),
                )
                .limit(1)
            )
            if message is None:
                raise MessageNotExistsError()

            session.add(
                SavedMessage(
                    app_id=app_id,
                    message_id=message.id,
                    created_by_role=CreatorUserRole(actor.role),
                    created_by=actor.id,
                )
            )
            session.commit()

    @override
    def delete(self, *, app_id: str, actor: SavedMessageActor, message_id: str) -> None:
        with self._session_factory() as session:
            saved_message = session.scalar(
                select(SavedMessage)
                .where(
                    SavedMessage.app_id == app_id,
                    SavedMessage.message_id == message_id,
                    SavedMessage.created_by_role == actor.role,
                    SavedMessage.created_by == actor.id,
                )
                .limit(1)
            )
            if saved_message is None:
                return

            session.delete(saved_message)
            session.commit()

    @staticmethod
    def _to_record(*, message: Message, session: Session) -> SavedMessageRecord:
        inputs = cast(dict[str, SavedMessageInputValue], message.inputs_with_session(session=session))
        message_files = SQLAlchemySavedMessageRepository._message_files(message=message, session=session)
        feedback = message.user_feedback_with_session(session=session)
        return SavedMessageRecord(
            id=message.id,
            inputs=inputs,
            query=message.query,
            answer=message.answer,
            message_files=message_files,
            user_feedback=SavedMessageFeedback(rating=feedback.rating.value) if feedback is not None else None,
            created_at=message.created_at,
        )

    @staticmethod
    def _message_files(*, message: Message, session: Session) -> list[SavedMessageFileRecord]:
        return [
            SavedMessageFileRecord(
                id=file["id"],
                filename=cast(str, file["filename"]),
                type=file["type"],
                url=file.get("url"),
                mime_type=file.get("mime_type"),
                size=file.get("size"),
                transfer_method=file["transfer_method"],
                belongs_to=file.get("belongs_to"),
                upload_file_id=file.get("upload_file_id"),
            )
            for file in message.message_files_with_session(session=session)
        ]
