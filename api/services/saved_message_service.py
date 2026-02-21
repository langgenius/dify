from typing import Union

from core.db.session_factory import session_factory
from libs.infinite_scroll_pagination import InfiniteScrollPagination
from models import Account
from models.model import App, EndUser
from models.web import SavedMessage
from services.message_service import MessageService


class SavedMessageService:
    @classmethod
    def pagination_by_last_id(
        cls, app_model: App, user: Union[Account, EndUser] | None, last_id: str | None, limit: int
    ) -> InfiniteScrollPagination:
        if not user:
            raise ValueError("User is required")
        with session_factory.create_session() as session:
            saved_messages = (
                session.query(SavedMessage)
                .where(
                    SavedMessage.app_id == app_model.id,
                    SavedMessage.created_by_role == ("account" if isinstance(user, Account) else "end_user"),
                    SavedMessage.created_by == user.id,
                )
                .order_by(SavedMessage.created_at.desc())
                .all()
            )
        message_ids = [sm.message_id for sm in saved_messages]

        return MessageService.pagination_by_last_id(
            app_model=app_model, user=user, last_id=last_id, limit=limit, include_ids=message_ids
        )

    @classmethod
    def save(cls, app_model: App, user: Union[Account, EndUser] | None, message_id: str):
        if not user:
            return

        with session_factory.create_session() as session, session.begin():
            saved_message = (
                session.query(SavedMessage)
                .where(
                    SavedMessage.app_id == app_model.id,
                    SavedMessage.message_id == message_id,
                    SavedMessage.created_by_role == ("account" if isinstance(user, Account) else "end_user"),
                    SavedMessage.created_by == user.id,
                )
                .first()
            )

            if saved_message:
                return

            message = MessageService.get_message(app_model=app_model, user=user, message_id=message_id)

            saved_message = SavedMessage(
                app_id=app_model.id,
                message_id=message.id,
                created_by_role="account" if isinstance(user, Account) else "end_user",
                created_by=user.id,
            )

            session.add(saved_message)

    @classmethod
    def delete(cls, app_model: App, user: Union[Account, EndUser] | None, message_id: str):
        if not user:
            return
        with session_factory.create_session() as session, session.begin():
            saved_message = (
                session.query(SavedMessage)
                .where(
                    SavedMessage.app_id == app_model.id,
                    SavedMessage.message_id == message_id,
                    SavedMessage.created_by_role == ("account" if isinstance(user, Account) else "end_user"),
                    SavedMessage.created_by == user.id,
                )
                .first()
            )

            if not saved_message:
                return

            session.delete(saved_message)
