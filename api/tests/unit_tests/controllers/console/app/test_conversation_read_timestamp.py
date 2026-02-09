from datetime import datetime
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from controllers.console.app.conversation import _get_conversation


def test_get_conversation_mark_read_keeps_updated_at_unchanged():
    app_model = SimpleNamespace(id="app-id")
    account = SimpleNamespace(id="account-id")
    conversation = MagicMock()
    conversation.id = "conversation-id"

    with (
        patch("controllers.console.app.conversation.current_account_with_tenant", return_value=(account, None)),
        patch("controllers.console.app.conversation.naive_utc_now", return_value=datetime(2026, 2, 9, 0, 0, 0)),
        patch("controllers.console.app.conversation.db.session") as mock_session,
    ):
        mock_session.query.return_value.where.return_value.first.return_value = conversation

        _get_conversation(app_model, "conversation-id")

        statement = mock_session.execute.call_args[0][0]
        compiled = statement.compile()
        sql_text = str(compiled).lower()
        compact_sql_text = sql_text.replace(" ", "")
        params = compiled.params

        assert "updated_at=current_timestamp" not in compact_sql_text
        assert "updated_at=conversations.updated_at" in compact_sql_text
        assert "read_at=:read_at" in compact_sql_text
        assert "read_account_id=:read_account_id" in compact_sql_text
        assert params["read_at"] == datetime(2026, 2, 9, 0, 0, 0)
        assert params["read_account_id"] == "account-id"
