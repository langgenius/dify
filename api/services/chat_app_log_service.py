from datetime import datetime

from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session

from models import Account, App, Conversation, EndUser, Message
from models.enums import CreatorUserRole
from models.model import AppMode
from services.message_app_log_service import MessageAppLogServiceBase


class ChatAppLogService(MessageAppLogServiceBase):
    def get_paginate_chat_app_logs(
        self,
        *,
        session: Session,
        app_model: App,
        status: str | None = None,
        created_at_before: datetime | None = None,
        created_at_after: datetime | None = None,
        page: int = 1,
        limit: int = 20,
        created_by_end_user_session_id: str | None = None,
        created_by_account: str | None = None,
    ) -> dict:
        """
        Get paginated chat app logs with token consumption information.
        """
        return self.get_paginate_app_logs(
            session=session,
            app_model=app_model,
            status=status,
            created_at_before=created_at_before,
            created_at_after=created_at_after,
            page=page,
            limit=limit,
            created_by_end_user_session_id=created_by_end_user_session_id,
            created_by_account=created_by_account,
        )

    def get_app_mode_filter(self):
        """Return the filter condition for chat app modes."""
        return or_(
            Message.app_mode == AppMode.CHAT.value,
            Message.app_mode == AppMode.AGENT_CHAT.value,
            Message.app_mode == AppMode.ADVANCED_CHAT.value,
        )

    def build_log_data(self, session, message: Message, conversation=None):
        """Build log data for chat app."""
        # For chat apps, we use from_account_id/from_end_user_id instead of created_by_*
        account_obj = None
        end_user_obj = None
        created_from = "api"
        created_by_role = None

        if message.from_account_id:
            account_obj = session.get(Account, message.from_account_id)
            created_from = "web_app"
            created_by_role = CreatorUserRole.ACCOUNT.value
        elif message.from_end_user_id:
            end_user_obj = session.get(EndUser, message.from_end_user_id)
            created_from = "service_api"
            created_by_role = CreatorUserRole.END_USER.value

        return {
            "id": str(message.id),
            "conversation": {
                "id": str(conversation.id) if conversation else None,
                "name": conversation.name if conversation else None,
                "status": conversation.status if conversation else None,
            },
            "message": {
                "id": str(message.id),
                "conversation_id": str(message.conversation_id),
                "query": message.query,
                "answer": message.answer,
                "status": message.status,
                "message_tokens": message.message_tokens,
                "created_at": message.created_at,
                "error": message.error,
                "provider_response_latency": message.provider_response_latency,
                "from_source": message.from_source,
                "from_end_user_id": message.from_end_user_id,
                "from_account_id": message.from_account_id,
            },
            "created_from": created_from,
            "created_by_role": created_by_role,
            "created_by_account": account_obj,
            "created_by_end_user": end_user_obj,
            "created_at": message.created_at,
        }

    def _build_base_query(self, app_model: App):
        """Build the base query for chat apps."""
        return (
            select(Message)
            .join(Conversation, Message.conversation_id == Conversation.id)
            .where(
                and_(
                    Message.app_id == app_model.id,
                    self.get_app_mode_filter(),
                )
            )
            .order_by(Message.created_at.desc())
        )

    def _build_total_count_query(self, app_model: App):
        """Build the total count query for chat apps."""
        return (
            select(func.count(Message.id))
            .join(Conversation, Message.conversation_id == Conversation.id)
            .where(
                and_(
                    Message.app_id == app_model.id,
                    self.get_app_mode_filter(),
                )
            )
        )
