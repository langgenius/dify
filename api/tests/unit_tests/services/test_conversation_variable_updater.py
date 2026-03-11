from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from dify_graph.variables import StringVariable
from services.conversation_variable_updater import ConversationVariableNotFoundError, ConversationVariableUpdater


class TestConversationVariableUpdater:
    def test_should_update_conversation_variable_data_and_commit(self):
        """Test update persists serialized variable data when the row exists."""
        conversation_id = "conv-123"
        variable = StringVariable(
            id="var-123",
            name="topic",
            value="new value",
        )
        expected_json = variable.model_dump_json()

        row = SimpleNamespace(data="old value")
        session = MagicMock()
        session.scalar.return_value = row

        session_context = MagicMock()
        session_context.__enter__.return_value = session
        session_context.__exit__.return_value = None

        session_maker = MagicMock(return_value=session_context)
        updater = ConversationVariableUpdater(session_maker)

        updater.update(conversation_id=conversation_id, variable=variable)

        session_maker.assert_called_once_with()
        session.scalar.assert_called_once()
        stmt = session.scalar.call_args.args[0]
        compiled_params = stmt.compile().params
        assert variable.id in compiled_params.values()
        assert conversation_id in compiled_params.values()
        assert row.data == expected_json
        session.commit.assert_called_once()

    def test_should_raise_not_found_error_when_conversation_variable_missing(self):
        """Test update raises ConversationVariableNotFoundError when no matching row exists."""
        conversation_id = "conv-404"
        variable = StringVariable(
            id="var-404",
            name="topic",
            value="value",
        )

        session = MagicMock()
        session.scalar.return_value = None

        session_context = MagicMock()
        session_context.__enter__.return_value = session
        session_context.__exit__.return_value = None

        session_maker = MagicMock(return_value=session_context)
        updater = ConversationVariableUpdater(session_maker)

        with pytest.raises(ConversationVariableNotFoundError, match="conversation variable not found in the database"):
            updater.update(conversation_id=conversation_id, variable=variable)

        session.commit.assert_not_called()

    def test_should_do_nothing_when_flush_is_called(self):
        """Test flush currently behaves as a no-op and returns None."""
        session_maker = MagicMock()
        updater = ConversationVariableUpdater(session_maker)

        result = updater.flush()

        assert result is None
        session_maker.assert_not_called()
