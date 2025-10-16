"""
Message repository protocol defining storage operations used by the domain.
"""

from collections.abc import Sequence
from typing import Protocol

from sqlalchemy.orm import Session

from models.model import Message


class MessageRepository(Protocol):
    """
    Abstraction for message persistence operations.
    """

    def get_paginated_messages_by_first_id(
        self,
        conversation_id: str,
        first_id: str | None,
        limit: int,
        session: Session | None = None,
    ) -> tuple[list[Message], bool]:
        """
        Retrieve conversation messages using the first message cursor semantics.
        """
        ...

    def get_paginated_messages_by_last_id(
        self,
        conversation_id: str | None,
        include_ids: Sequence[str] | None,
        last_id: str | None,
        limit: int,
        session: Session | None = None,
    ) -> tuple[list[Message], bool]:
        """
        Retrieve messages for pagination using the last message cursor semantics.
        """
        ...

    def get_message_for_user(
        self,
        app_id: str,
        from_source: str,
        from_end_user_id: str | None,
        from_account_id: str | None,
        message_id: str,
        session: Session | None = None,
    ) -> Message | None:
        """
        Retrieve a message scoped to the provided user context.
        """
        ...

    def get_by_id(self, message_id: str, session: Session | None = None) -> Message | None:
        """
        Retrieve a message by its identifier.
        """
        ...

    def get_latest_for_app(self, app_id: str, session: Session | None = None) -> Message | None:
        """
        Retrieve the most recent message for an application.
        """
        ...

    def get_conversation_messages(
        self,
        conversation_id: str,
        limit: int | None = None,
        order: str = "desc",
        session: Session | None = None,
    ) -> list[Message]:
        """
        Retrieve messages for a conversation with optional limit and ordering.
        """
        ...

    def save(self, message: Message, session: Session | None = None) -> Message:
        """
        Persist a message instance (insert or update).
        """
        ...

    def get_by_conversation_and_workflow_run(
        self,
        conversation_id: str,
        workflow_run_id: str,
        session: Session | None = None,
    ) -> Message | None:
        """
        Retrieve a message by conversation and workflow run identifiers.
        """
        ...
