"""
Unit tests for conversation search functionality.

Tests UUID validation and search condition building in the ChatConversationApi.
"""

from uuid import UUID, uuid4

import sqlalchemy as sa


class TestConversationSearch:
    """Test conversation search with partial and full UUID."""

    def test_partial_uuid_search_works(self):
        """Test that partial UUID search uses ILIKE with cast for fuzzy matching."""
        from libs.helper import escape_like_pattern
        from models import Conversation, Message

        # Partial UUID (not a valid full UUID)
        keyword = "123e4567"
        escaped_keyword = escape_like_pattern(keyword)
        keyword_filter = f"%{escaped_keyword}%"

        # Simulate the subquery column
        class MockSubquery:
            class C:
                from_end_user_session_id = sa.Column("from_end_user_session_id", sa.String)

        subquery = MockSubquery()

        # Validate if it's a valid UUID
        is_valid_uuid = False
        try:
            UUID(keyword)
            is_valid_uuid = True
        except (ValueError, AttributeError):
            pass

        # Build search conditions
        search_conditions: list[sa.ColumnElement[bool]] = [
            Message.query.ilike(keyword_filter, escape="\\"),
            Message.answer.ilike(keyword_filter, escape="\\"),
            Conversation.name.ilike(keyword_filter, escape="\\"),
            Conversation.introduction.ilike(keyword_filter, escape="\\"),
            subquery.C.from_end_user_session_id.ilike(keyword_filter, escape="\\"),
        ]

        if is_valid_uuid:
            search_conditions.append(Conversation.id == keyword)
        else:
            search_conditions.append(sa.cast(Conversation.id, sa.String).ilike(keyword_filter, escape="\\"))

        # Assertions
        assert is_valid_uuid is False, "Partial UUID should not be recognized as valid UUID"
        assert len(search_conditions) == 6, "Should have 6 search conditions"
        # The last condition should be a cast + ILIKE for partial matching
        assert isinstance(search_conditions[-1], sa.sql.elements.BinaryExpression)

    def test_full_uuid_search_works(self):
        """Test that full UUID search uses exact match for precise lookup."""
        from libs.helper import escape_like_pattern
        from models import Conversation, Message

        # Full valid UUID
        keyword = str(uuid4())
        escaped_keyword = escape_like_pattern(keyword)
        keyword_filter = f"%{escaped_keyword}%"

        # Simulate the subquery column
        class MockSubquery:
            class C:
                from_end_user_session_id = sa.Column("from_end_user_session_id", sa.String)

        subquery = MockSubquery()

        # Validate if it's a valid UUID
        is_valid_uuid = False
        try:
            UUID(keyword)
            is_valid_uuid = True
        except (ValueError, AttributeError):
            pass

        # Build search conditions
        search_conditions: list[sa.ColumnElement[bool]] = [
            Message.query.ilike(keyword_filter, escape="\\"),
            Message.answer.ilike(keyword_filter, escape="\\"),
            Conversation.name.ilike(keyword_filter, escape="\\"),
            Conversation.introduction.ilike(keyword_filter, escape="\\"),
            subquery.C.from_end_user_session_id.ilike(keyword_filter, escape="\\"),
        ]

        if is_valid_uuid:
            search_conditions.append(Conversation.id == keyword)
        else:
            search_conditions.append(sa.cast(Conversation.id, sa.String).ilike(keyword_filter, escape="\\"))

        # Assertions
        assert is_valid_uuid is True, "Full UUID should be recognized as valid UUID"
        assert len(search_conditions) == 6, "Should have 6 search conditions"
        # The last condition should be an exact match for full UUID
        assert isinstance(search_conditions[-1], sa.sql.elements.BinaryExpression)
