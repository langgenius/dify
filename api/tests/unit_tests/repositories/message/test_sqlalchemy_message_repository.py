"""
Unit tests for SQLAlchemyMessageRepository.
"""

from datetime import datetime
from unittest.mock import MagicMock

import pytest

from core.message.exceptions import FirstMessageNotFoundError, LastMessageNotFoundError
from core.repositories.sqlalchemy_message_repository import SQLAlchemyMessageRepository
from models.model import Message


class TestSQLAlchemyMessageRepository:
    """Tests for SQLAlchemyMessageRepository using mocked SQLAlchemy sessions."""

    def create_mock_session_factory(self) -> tuple[MagicMock, MagicMock]:
        """
        Create a mock session factory that returns a context manager yielding a mock session.
        """
        mock_session = MagicMock()
        mock_session_factory = MagicMock()
        mock_session_factory.return_value.__enter__.return_value = mock_session
        mock_session_factory.return_value.__exit__.return_value = None
        return mock_session_factory, mock_session

    def create_repository(self) -> tuple[SQLAlchemyMessageRepository, MagicMock]:
        """
        Helper to instantiate the repository with mocked dependencies.
        """
        session_factory, session = self.create_mock_session_factory()
        repository = SQLAlchemyMessageRepository(session_maker=session_factory)
        return repository, session

    def build_messages(self, count: int) -> list[MagicMock]:
        """
        Build a list of mocked Message instances with ordered created_at timestamps.
        """
        messages: list[MagicMock] = []
        base_time = datetime(2024, 1, 1, 12, 0, 0)
        for index in range(count):
            message = MagicMock(spec=Message)
            message.created_at = base_time.replace(minute=base_time.minute + index)
            messages.append(message)
        return messages

    def test_get_paginated_messages_by_first_id_without_first_id(self):
        repository, session = self.create_repository()

        base_query = MagicMock()
        session.query.return_value = base_query

        conversation_query = MagicMock()
        base_query.where.return_value = conversation_query

        order_query = MagicMock()
        history_query = MagicMock()
        conversation_query.where.return_value = conversation_query
        conversation_query.order_by.return_value = order_query
        order_query.limit.return_value = history_query

        messages = self.build_messages(3)
        history_query.all.return_value = messages

        result, has_more = repository.get_paginated_messages_by_first_id(
            conversation_id="conv-1",
            first_id=None,
            limit=2,
        )

        assert result == messages[:2]
        assert has_more is True
        session.query.assert_called_once_with(Message)
        order_query.limit.assert_called_once_with(3)

    def test_get_paginated_messages_by_first_id_with_missing_first_message(self):
        repository, session = self.create_repository()

        base_query = MagicMock()
        session.query.return_value = base_query

        conversation_query = MagicMock()
        base_query.where.return_value = conversation_query

        first_query = MagicMock()
        history_query = MagicMock()
        conversation_query.where.side_effect = [first_query, history_query]

        first_query.first.return_value = None

        with pytest.raises(FirstMessageNotFoundError):
            repository.get_paginated_messages_by_first_id(
                conversation_id="conv-1",
                first_id="msg-1",
                limit=2,
            )

        assert conversation_query.where.call_count == 1

    def test_get_paginated_messages_by_first_id_with_first_id(self):
        repository, session = self.create_repository()

        base_query = MagicMock()
        session.query.return_value = base_query

        conversation_query = MagicMock()
        base_query.where.return_value = conversation_query

        first_query = MagicMock()
        history_query = MagicMock()
        conversation_query.where.side_effect = [first_query, history_query]

        first_message = MagicMock(spec=Message)
        first_message.created_at = datetime(2024, 1, 1, 12, 0, 0)
        first_query.first.return_value = first_message

        order_query = MagicMock()
        history_limit = MagicMock()
        history_query.order_by.return_value = order_query
        order_query.limit.return_value = history_limit

        messages = self.build_messages(1)
        history_limit.all.return_value = messages

        result, has_more = repository.get_paginated_messages_by_first_id(
            conversation_id="conv-1",
            first_id="msg-0",
            limit=2,
        )

        assert result == messages
        assert has_more is False
        order_query.limit.assert_called_once_with(3)

    def test_get_paginated_messages_by_last_id_without_last_id(self):
        repository, session = self.create_repository()

        base_query = MagicMock()
        session.query.return_value = base_query

        conversation_query = MagicMock()
        base_query.where.return_value = conversation_query
        conversation_query.where.return_value = conversation_query

        order_query = MagicMock()
        limit_query = MagicMock()
        conversation_query.order_by.return_value = order_query
        order_query.limit.return_value = limit_query

        messages = self.build_messages(1)
        limit_query.all.return_value = messages

        result, has_more = repository.get_paginated_messages_by_last_id(
            conversation_id="conv-1",
            include_ids=None,
            last_id=None,
            limit=2,
        )

        assert result == messages
        assert has_more is False
        order_query.limit.assert_called_once_with(3)

    def test_get_paginated_messages_by_last_id_with_missing_last_message(self):
        repository, session = self.create_repository()

        base_query = MagicMock()
        session.query.return_value = base_query

        conversation_query = MagicMock()
        base_query.where.return_value = conversation_query

        last_query = MagicMock()
        history_query = MagicMock()
        conversation_query.where.side_effect = [last_query, history_query]
        last_query.first.return_value = None

        with pytest.raises(LastMessageNotFoundError):
            repository.get_paginated_messages_by_last_id(
                conversation_id="conv-1",
                include_ids=None,
                last_id="msg-1",
                limit=2,
            )

        assert conversation_query.where.call_count == 1

    def test_get_paginated_messages_by_last_id_with_last_id(self):
        repository, session = self.create_repository()

        base_query = MagicMock()
        session.query.return_value = base_query

        conversation_query = MagicMock()
        base_query.where.return_value = conversation_query

        last_query = MagicMock()
        history_query = MagicMock()
        conversation_query.where.side_effect = [last_query, history_query]

        last_message = MagicMock(spec=Message)
        last_message.created_at = datetime(2024, 1, 1, 12, 0, 0)
        last_query.first.return_value = last_message

        order_query = MagicMock()
        limit_query = MagicMock()
        history_query.order_by.return_value = order_query
        order_query.limit.return_value = limit_query

        messages = self.build_messages(2)
        limit_query.all.return_value = messages

        result, has_more = repository.get_paginated_messages_by_last_id(
            conversation_id="conv-1",
            include_ids=None,
            last_id="msg-1",
            limit=1,
        )

        assert result == messages[:1]
        assert has_more is True
        order_query.limit.assert_called_once_with(2)

    def test_get_paginated_messages_by_last_id_with_empty_include_ids(self):
        repository, session = self.create_repository()

        result, has_more = repository.get_paginated_messages_by_last_id(
            conversation_id="conv-1",
            include_ids=[],
            last_id=None,
            limit=2,
        )

        assert result == []
        assert has_more is False
        session.query.assert_not_called()

    def test_get_message_for_user(self):
        repository, session = self.create_repository()

        base_query = MagicMock()
        session.query.return_value = base_query

        filtered_query = MagicMock()
        base_query.where.return_value = filtered_query

        expected_message = MagicMock(spec=Message)
        filtered_query.first.return_value = expected_message

        message = repository.get_message_for_user(
            app_id="app-1",
            from_source="api",
            from_end_user_id="user-1",
            from_account_id=None,
            message_id="msg-1",
        )

        assert message is expected_message
        filtered_query.first.assert_called_once_with()
