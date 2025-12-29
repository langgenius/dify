from abc import ABC, abstractmethod
from datetime import datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from models import Account, App, Conversation, EndUser, Message
from models.enums import CreatorUserRole


class MessageAppLogServiceBase(ABC):
    """Base service for message app logs with common functionality."""

    @abstractmethod
    def get_app_mode_filter(self) -> Any:
        """Return the filter conditions for the specific app mode."""
        pass

    @abstractmethod
    def build_log_data(self, session: Session, message, conversation=None) -> dict:
        """Build the log data dictionary for a specific app type."""
        pass

    @abstractmethod
    def _build_base_query(self, app_model: App) -> Any:
        """Build the base query for the specific app type."""
        pass

    @abstractmethod
    def _build_total_count_query(self, app_model: App) -> Any:
        """Build the total count query for the specific app type."""
        pass

    def _apply_base_filters(
        self,
        session,
        query,
        status,
        created_at_before,
        created_at_after,
        created_by_end_user_session_id,
        created_by_account,
    ):
        """Apply common filters to the query."""
        # Keyword search removed due to performance limitations
        # ILIKE with wildcards cannot use B-tree indexes effectively

        if status:
            query = query.where(Message.status == status)

        if created_at_before:
            query = query.where(Message.created_at <= created_at_before)

        if created_at_after:
            query = query.where(Message.created_at >= created_at_after)

        if created_by_end_user_session_id:
            query = query.where(Message.from_end_user_id == created_by_end_user_session_id)

        if created_by_account:
            account = self._get_account_by_email(session, created_by_account)
            if not account:
                return None, True  # Signal that account was not found
            query = query.where(Message.from_account_id == account.id)

        return query, False

    def _get_account_by_email(self, session, email):
        """Get account by email from the database."""
        return session.scalar(select(Account).where(Account.email == email))

    def _get_creator_info(self, session, message: Message):
        """Get creator information for a message."""
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

        return account_obj, end_user_obj, created_from, created_by_role

    def get_paginate_app_logs(
        self,
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
        Get paginated app logs with token consumption information.
        This is the main method that coordinates the log retrieval process.
        """
        # Build base query
        query = self._build_base_query(app_model)

        # Apply filters
        query, account_not_found = self._apply_base_filters(
            session,
            query,
            status,
            created_at_before,
            created_at_after,
            created_by_end_user_session_id,
            created_by_account,
        )

        # If account not found, return empty results
        if account_not_found or query is None:
            return self._empty_result(page, limit)

        # Build and execute total count query
        total_query = self._build_total_count_query(app_model)
        total_query, account_not_found = self._apply_base_filters(
            session,
            total_query,
            status,
            created_at_before,
            created_at_after,
            created_by_end_user_session_id,
            created_by_account,
        )

        # If account not found in count query, return empty results
        if account_not_found or total_query is None:
            return self._empty_result(page, limit)

        # Get total count
        total_result = session.execute(total_query).scalar()
        total = total_result if total_result is not None else 0

        # Apply pagination
        offset = (page - 1) * limit
        query = query.offset(offset).limit(limit)

        # Execute query
        messages = session.execute(query).scalars().all()

        # Transform to log format
        logs = []

        conversation_ids = {msg.conversation_id for msg in messages if msg.conversation_id}
        conversations = {}
        if conversation_ids:
            conversation_results = session.query(Conversation).where(Conversation.id.in_(conversation_ids)).all()
            conversations = {conv.id: conv for conv in conversation_results}

        for message in messages:
            conversation = conversations.get(message.conversation_id)
            log_data = self.build_log_data(session, message, conversation)
            logs.append(log_data)

        has_more = offset + limit < total

        return {
            "data": logs,
            "has_more": has_more,
            "limit": limit,
            "total": total,
            "page": page,
        }

    def _empty_result(self, page, limit):
        """Return empty result set."""
        return {
            "data": [],
            "has_more": False,
            "limit": limit,
            "total": 0,
            "page": page,
        }
