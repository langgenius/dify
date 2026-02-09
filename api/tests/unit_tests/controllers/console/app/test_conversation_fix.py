import unittest
from unittest.mock import MagicMock, patch

from controllers.console.app.conversation import _get_conversation


class TestConversationControllerFix(unittest.TestCase):
    @patch("controllers.console.app.conversation.ConversationService")
    @patch("controllers.console.app.conversation.db")
    @patch("controllers.console.app.conversation.current_account_with_tenant")
    def test_get_conversation_calls_mark_as_read(self, mock_current_account, mock_db, mock_conversation_service):
        # Arrange
        app_model = MagicMock()
        app_model.id = "app_id"
        conversation_id = "conv_id"

        mock_user = MagicMock()
        mock_user.id = "user_id"
        mock_current_account.return_value = (mock_user, "tenant_id")

        mock_conversation = MagicMock()
        mock_db.session.query.return_value.where.return_value.first.return_value = mock_conversation

        # Act
        _get_conversation(app_model, conversation_id)

        # Assert
        mock_conversation_service.mark_as_read.assert_called_with("conv_id", mock_user)
