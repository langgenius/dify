from typing import Optional

from libs.infinite_scroll_pagination import InfiniteScrollPagination
from extensions.ext_database import db
from models.model import App, EndUser
from models.web import SavedMessage
from services.message_service import MessageService


class SavedMessageService:
    @classmethod
    def pagination_by_last_id(cls, app_model: App, end_user: Optional[EndUser],
                              last_id: Optional[str], limit: int) -> InfiniteScrollPagination:
        saved_messages = db.session.query(SavedMessage).filter(
            SavedMessage.app_id == app_model.id,
            SavedMessage.created_by == end_user.id
        ).order_by(SavedMessage.created_at.desc()).all()
        message_ids = [sm.message_id for sm in saved_messages]

        return MessageService.pagination_by_last_id(
            app_model=app_model,
            user=end_user,
            last_id=last_id,
            limit=limit,
            include_ids=message_ids
        )

    @classmethod
    def save(cls, app_model: App, user: Optional[EndUser], message_id: str):
        saved_message = db.session.query(SavedMessage).filter(
            SavedMessage.app_id == app_model.id,
            SavedMessage.message_id == message_id,
            SavedMessage.created_by == user.id
        ).first()

        if saved_message:
            return

        message = MessageService.get_message(
            app_model=app_model,
            user=user,
            message_id=message_id
        )

        saved_message = SavedMessage(
            app_id=app_model.id,
            message_id=message.id,
            created_by=user.id
        )

        db.session.add(saved_message)
        db.session.commit()

    @classmethod
    def delete(cls, app_model: App, user: Optional[EndUser], message_id: str):
        saved_message = db.session.query(SavedMessage).filter(
            SavedMessage.app_id == app_model.id,
            SavedMessage.message_id == message_id,
            SavedMessage.created_by == user.id
        ).first()

        if not saved_message:
            return

        db.session.delete(saved_message)
        db.session.commit()
