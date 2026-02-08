from datetime import datetime

from sqlalchemy import and_, func, select
from sqlalchemy.orm import Session

from models import App, Message
from models.model import AppMode
from services.message_app_log_service import MessageAppLogServiceBase


class CompletionAppLogService(MessageAppLogServiceBase):
    def get_paginate_completion_app_logs(
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
        Get paginated completion app logs with token consumption information.
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
        """Return the filter condition for completion app mode."""
        return Message.app_mode == AppMode.COMPLETION.value

    def build_log_data(self, session, message, conversation=None):
        """Build log data for completion app."""
        account_obj, end_user_obj, created_from, created_by_role = self._get_creator_info(session, message)

        return {
            "id": str(message.id),
            "message": {
                "id": str(message.id),
                "query": message.query,
                "answer": message.answer,
                "status": message.status,
                "message_tokens": message.message_tokens,
                "total_tokens": message.total_tokens,
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
        """Build the base query for completion apps."""
        return (
            select(Message)
            .where(
                and_(
                    Message.app_id == app_model.id,
                    self.get_app_mode_filter(),
                )
            )
            .order_by(Message.created_at.desc())
        )

    def _build_total_count_query(self, app_model: App):
        """Build the total count query for completion apps."""
        return select(func.count(Message.id)).where(
            and_(
                Message.app_id == app_model.id,
                self.get_app_mode_filter(),
            )
        )
