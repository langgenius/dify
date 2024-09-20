from typing import Optional, Union

from extensions.ext_database import db
from libs.infinite_scroll_pagination import InfiniteScrollPagination
from models.account import Account
from models.model import App, EndUser
from models.web import SavedMessage
from services.message_service import MessageService


class SavedMessageService:
    @classmethod
    def pagination_by_last_id(
        cls, app_model: App, user: Optional[Union[Account, EndUser]], last_id: Optional[str], limit: int
    ) -> InfiniteScrollPagination:
        saved_messages = (
            db.session.query(SavedMessage)
            .filter(
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
    def save(cls, app_model: App, user: Optional[Union[Account, EndUser]], message_id: str):
        saved_message = (
            db.session.query(SavedMessage)
            .filter(
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

        db.session.add(saved_message)
        db.session.commit()

    @classmethod
    def delete(cls, app_model: App, user: Optional[Union[Account, EndUser]], message_id: str):
        saved_message = (
            db.session.query(SavedMessage)
            .filter(
                SavedMessage.app_id == app_model.id,
                SavedMessage.message_id == message_id,
                SavedMessage.created_by_role == ("account" if isinstance(user, Account) else "end_user"),
                SavedMessage.created_by == user.id,
            )
            .first()
        )

        if not saved_message:
            return

        db.session.delete(saved_message)
        db.session.commit()
