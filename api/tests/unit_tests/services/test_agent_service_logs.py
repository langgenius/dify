"""Regression coverage for historical Classic Agent tool logs."""

from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from sqlalchemy.orm import Session

from models import Account
from services import agent_service


@pytest.mark.parametrize("tool_still_configured", [False, True])
def test_legacy_tool_log_without_provider_metadata_uses_configured_tool_or_blank_icon(
    monkeypatch: pytest.MonkeyPatch, tool_still_configured: bool
) -> None:
    account = Account(name="Executor", email="executor@example.test")
    account.timezone = "UTC"
    monkeypatch.setattr(agent_service, "current_user", account)

    now = datetime(2026, 1, 1, tzinfo=UTC)
    thought = SimpleNamespace(
        tools=["old_tool"],
        tool_labels={},
        tool_meta={"old_tool": {"tool_config": {}}},
        tool_inputs_dict={},
        tool_outputs_dict={},
        tokens=1,
        tool_input="{}",
        observation="{}",
        thought="historical thought",
        created_at=now,
        files=[],
    )
    message = MagicMock()
    message.agent_thoughts_with_session.return_value = [thought]
    message.created_at = now
    message.provider_response_latency = 0.1
    message.answer_tokens = 1
    message.message_tokens = 1
    message.message_files_with_session.return_value = list[object]()

    conversation = SimpleNamespace(from_end_user_id=None, from_account_id="account-id")
    scalar_values = iter([conversation, message, "Executor"])

    app_config = MagicMock()
    app_config.agent_mode_dict = {"strategy": "react"}
    app_config.to_dict.return_value = dict[str, object]()
    app = MagicMock()
    app.id = "app-id"
    app.tenant_id = "tenant-id"
    app.app_model_config_with_session.return_value = app_config

    tool = SimpleNamespace(tool_name="old_tool", provider_type="api", provider_id="provider-id")
    agent_config = SimpleNamespace(tools=[tool] if tool_still_configured else [])
    monkeypatch.setattr(agent_service.AgentConfigManager, "convert", lambda _: agent_config)
    monkeypatch.setattr(agent_service, "load_annotation_reply_config", lambda *_: None)
    get_tool_icon = MagicMock(return_value="icon-url")
    monkeypatch.setattr(agent_service.ToolManager, "get_tool_icon", get_tool_icon)

    with Session() as session:
        monkeypatch.setattr(session, "scalar", lambda _: next(scalar_values))
        result = agent_service.AgentService.get_agent_logs(app, "conversation-id", "message-id", session)

    assert result["iterations"][0]["tool_calls"][0]["tool_icon"] == ("icon-url" if tool_still_configured else "")
    if tool_still_configured:
        get_tool_icon.assert_called_once_with(tenant_id="tenant-id", provider_type="api", provider_id="provider-id")
    else:
        get_tool_icon.assert_not_called()
