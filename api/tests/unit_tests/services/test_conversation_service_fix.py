
import unittest
from unittest.mock import MagicMock, patch
from services.conversation_service import ConversationService
from models.model import Conversation

class TestConversationServiceFix(unittest.TestCase):
    @patch("services.conversation_service.db")
    @patch("services.conversation_service.update")
    @patch("services.conversation_service.naive_utc_now")
    def test_mark_as_read_preserves_updated_at(
        self, mock_naive_utc_now, mock_sa_update, mock_db
    ):
        # Arrange
        conversation_id = "conv_id"
        user = MagicMock()
        user.id = "user_id"
        
        mock_update_stmt = MagicMock()
        mock_sa_update.return_value = mock_update_stmt
        mock_update_stmt.where.return_value = mock_update_stmt
        mock_update_stmt.values.return_value = mock_update_stmt

        # Act
        ConversationService.mark_as_read(conversation_id, user)

        # Assert
        mock_sa_update.assert_called_with(Conversation)
        
        # Verify values() args
        call_args = mock_update_stmt.values.call_args
        assert call_args is not None
        _, kwargs = call_args
        
        assert "updated_at" in kwargs
        assert kwargs["updated_at"] == Conversation.updated_at
        assert kwargs["read_account_id"] == "user_id"
        
        mock_db.session.execute.assert_called()
        mock_db.session.commit.assert_called()
