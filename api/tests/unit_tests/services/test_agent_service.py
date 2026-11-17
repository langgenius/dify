"""Regression coverage for persisted historical Classic Agent tool logs."""

from __future__ import annotations

import json
from datetime import datetime

import pytest
from sqlalchemy.orm import Session

from models import App
from models.enums import CreatorUserRole
from models.model import AppMode, AppModelConfig, Conversation, ConversationFromSource, Message, MessageAgentThought
from services import agent_service
from tests.helpers.unit.model_factories import make_account, make_app, make_conversation, make_end_user, make_message

_NOW = datetime(2026, 1, 1)


def _persist_log(
    session: Session, monkeypatch: pytest.MonkeyPatch, *, tool_still_configured: bool = False, end_user: bool = False
) -> App:
    account = make_account(name="Executor", timezone="UTC")
    config = AppModelConfig(
        app_id="app-1",
        model=json.dumps({"provider": "openai", "name": "gpt-4", "mode": "chat"}),
        agent_mode=json.dumps(
            {
                "enabled": True,
                "strategy": "react",
                "tools": [
                    {"enabled": True, "tool_name": "old_tool", "provider_type": "api", "provider_id": "provider-id"}
                ]
                if tool_still_configured
                else [],
            }
        ),
    )
    app = make_app(app_model_config_id=config.id, mode=AppMode.AGENT_CHAT)
    source = ConversationFromSource.API if end_user else ConversationFromSource.CONSOLE
    conversation = make_conversation(
        mode=AppMode.AGENT_CHAT,
        from_source=source,
        from_account_id=None if end_user else account.id,
        from_end_user_id="end-user-1" if end_user else None,
    )
    message = make_message(
        from_source=source,
        from_account_id=None if end_user else account.id,
        from_end_user_id="end-user-1" if end_user else None,
        inputs={},
        query="Question",
        message=[],
        answer="Answer",
        provider_response_latency=0.1,
        answer_tokens=1,
        message_tokens=1,
        created_at=_NOW,
    )
    thought = MessageAgentThought(
        message_id=message.id,
        position=1,
        created_by_role=CreatorUserRole.END_USER if end_user else CreatorUserRole.ACCOUNT,
        created_by="end-user-1" if end_user else account.id,
        tool="old_tool",
        tool_meta_str=json.dumps({"old_tool": {"tool_config": {}}}),
        tool_input="{}",
        observation="{}",
        thought="historical thought",
        tokens=1,
    )
    session.add_all([account, config, app, conversation, message, thought])
    if end_user:
        session.add(make_end_user(app_id=app.id, name="Visitor"))
    session.commit()
    session.expire_all()
    monkeypatch.setattr(agent_service, "current_user", account)
    return app


@pytest.mark.parametrize("tool_still_configured", [False, True])
@pytest.mark.parametrize("end_user", [False, True])
def test_legacy_tool_log_without_provider_metadata_uses_configured_tool_or_blank_icon(
    monkeypatch: pytest.MonkeyPatch, sqlite_session: Session, tool_still_configured: bool, end_user: bool
) -> None:
    app = _persist_log(sqlite_session, monkeypatch, tool_still_configured=tool_still_configured, end_user=end_user)
    calls: list[dict[str, str]] = []

    def get_tool_icon(*, tenant_id: str, provider_type: str, provider_id: str) -> str:
        calls.append({"tenant_id": tenant_id, "provider_type": provider_type, "provider_id": provider_id})
        return "icon-url"

    monkeypatch.setattr(agent_service.ToolManager, "get_tool_icon", get_tool_icon)

    result = agent_service.AgentService.get_agent_logs(app, "conversation-1", "message-1", sqlite_session)

    assert result["iterations"][0]["tool_calls"][0]["tool_icon"] == ("icon-url" if tool_still_configured else "")
    assert result["meta"]["executor"] == ("Visitor" if end_user else "Executor")
    assert result["meta"]["total_tokens"] == 2
    assert result["meta"]["iterations"] == 1
    expected_calls: list[dict[str, str]] = (
        [{"tenant_id": "tenant-1", "provider_type": "api", "provider_id": "provider-id"}]
        if tool_still_configured
        else []
    )
    assert calls == expected_calls


@pytest.mark.parametrize("missing", ["conversation", "message"])
def test_agent_logs_reject_missing_records(
    monkeypatch: pytest.MonkeyPatch, sqlite_session: Session, missing: str
) -> None:
    app = _persist_log(sqlite_session, monkeypatch)
    conversation_id = "missing" if missing == "conversation" else "conversation-1"
    message_id = "missing" if missing == "message" else "message-1"

    with pytest.raises(
        ValueError, match="Conversation not found" if missing == "conversation" else "Message not found"
    ):
        agent_service.AgentService.get_agent_logs(app, conversation_id, message_id, sqlite_session)


@pytest.mark.parametrize("foreign", ["conversation", "message"])
def test_agent_logs_reject_records_outside_the_requested_owner_chain(
    monkeypatch: pytest.MonkeyPatch, sqlite_session: Session, foreign: str
) -> None:
    app = _persist_log(sqlite_session, monkeypatch)
    other_app = make_app(app_id="other-app")
    other_conversation = make_conversation(
        conversation_id="other-conversation", app_id=other_app.id, from_source=ConversationFromSource.CONSOLE
    )
    sqlite_session.add_all([other_app, other_conversation])
    message = sqlite_session.get(Message, "message-1")
    assert message is not None
    message.app_id = other_app.id
    if foreign == "conversation":
        conversation = sqlite_session.get(Conversation, "conversation-1")
        assert conversation is not None
        conversation.app_id = other_app.id
    else:
        message.conversation_id = other_conversation.id
    sqlite_session.commit()
    sqlite_session.expire_all()

    with pytest.raises(
        ValueError, match="Conversation not found" if foreign == "conversation" else "Message not found"
    ):
        agent_service.AgentService.get_agent_logs(app, "conversation-1", "message-1", sqlite_session)


def test_agent_logs_read_only_the_messages_thoughts_in_position_order(
    monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    app = _persist_log(sqlite_session, monkeypatch)
    other_message = make_message(
        message_id="other-message",
        query="Other",
        message=[],
        answer="Other",
        from_source=ConversationFromSource.CONSOLE,
    )
    sqlite_session.add(other_message)
    for message_id, position, text in [
        ("message-1", 3, "last"),
        (other_message.id, 0, "foreign"),
        ("message-1", 2, "middle"),
    ]:
        sqlite_session.add(
            MessageAgentThought(
                message_id=message_id,
                position=position,
                created_by_role=CreatorUserRole.ACCOUNT,
                created_by="account-1",
                thought=text,
            )
        )
    sqlite_session.commit()
    sqlite_session.expire_all()

    result = agent_service.AgentService.get_agent_logs(app, "conversation-1", "message-1", sqlite_session)

    assert [iteration["thought"] for iteration in result["iterations"]] == ["historical thought", "middle", "last"]
    assert result["meta"]["iterations"] == 3
