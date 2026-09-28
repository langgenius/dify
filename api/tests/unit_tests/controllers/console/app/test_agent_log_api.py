import json
from datetime import datetime
from decimal import Decimal
from inspect import unwrap

import pytest
from flask import Flask
from pydantic import JsonValue
from sqlalchemy.orm import Session

from controllers.console.app.agent import AgentLogApi, AgentLogQuery, AgentLogResponse
from core.tools.entities.tool_entities import EmojiIconDict
from graphon.file import File, FileTransferMethod, FileType
from models import Account
from models.enums import CreatorUserRole, MessageFileBelongsTo
from models.model import (
    App,
    AppMode,
    AppModelConfig,
    Conversation,
    ConversationFromSource,
    Message,
    MessageAgentThought,
)
from models.model import MessageFile as MessageFileModel
from services import agent_service
from tests.unit_tests.model_factories import make_account, make_app, make_conversation, make_message

_APP_ID = "00000000-0000-4000-8000-000000000001"
_CONVERSATION_ID = "00000000-0000-4000-8000-000000000002"
_MESSAGE_ID = "00000000-0000-4000-8000-000000000003"
_MODELS = (Account, App, AppModelConfig, Conversation, Message, MessageAgentThought, MessageFileModel)
pytestmark = pytest.mark.parametrize("sqlite_session", [_MODELS], indirect=True)


@pytest.fixture
def agent_app(sqlite_session: Session, monkeypatch: pytest.MonkeyPatch) -> App:
    account = make_account(timezone="UTC")
    model_config = AppModelConfig(
        app_id=_APP_ID,
        model=json.dumps({"provider": "openai", "name": "test-model", "mode": "chat"}),
        agent_mode=json.dumps({"enabled": True, "strategy": "react", "tools": []}),
    )
    app_model = make_app(app_id=_APP_ID, mode=AppMode.AGENT_CHAT, app_model_config_id=model_config.id)
    conversation = make_conversation(
        conversation_id=_CONVERSATION_ID,
        app_id=_APP_ID,
        mode=AppMode.AGENT_CHAT,
        inputs={},
        from_source=ConversationFromSource.CONSOLE,
        from_account_id=account.id,
        introduction="",
        system_instruction="",
        system_instruction_tokens=0,
    )
    message = make_message(
        message_id=_MESSAGE_ID,
        app_id=_APP_ID,
        conversation_id=_CONVERSATION_ID,
        inputs={},
        query="Use a tool",
        message={},
        answer="Result",
        message_unit_price=Decimal(0),
        answer_unit_price=Decimal(0),
        currency="USD",
        from_source=ConversationFromSource.CONSOLE,
        from_account_id=account.id,
        message_tokens=5,
        answer_tokens=7,
        provider_response_latency=0,
        created_at=datetime(2026, 1, 1),
    )
    sqlite_session.add_all([account, model_config, app_model, conversation, message])
    sqlite_session.commit()
    monkeypatch.setattr(agent_service, "current_user", account)
    monkeypatch.setattr(agent_service, "load_annotation_reply_config", lambda *_args: {"enabled": False})
    return app_model


def _get_logs(app: Flask, session: Session, app_model: App) -> AgentLogResponse:
    api = AgentLogApi()
    query = AgentLogQuery(conversation_id=_CONVERSATION_ID, message_id=_MESSAGE_ID)
    with app.test_request_context(f"/apps/{_APP_ID}/agent/logs"):
        response = unwrap(api.get)(api, query, session, app_model)
    validated = AgentLogResponse.model_validate(response)
    assert validated.model_dump(mode="json") == response
    return validated


@pytest.mark.parametrize(
    ("tool_input", "tool_output", "label", "icon", "error"),
    [
        ({"nested": [True, 0, None]}, "plain text result", {"en_US": "Search", "zh_Hans": "搜索"}, "", None),
        ("search query", {"results": [1, None]}, None, {"background": "#fff", "content": "🔍"}, "Tool failed"),
        (None, None, None, "/tool-icon.svg", None),
        ([1, "two", None], [False, {"result": "three"}], None, "", None),
        (False, True, None, "", None),
        (0, 2.5, None, "", None),
    ],
)
def test_agent_log_endpoint_preserves_persisted_tool_values(
    app: Flask,
    sqlite_session: Session,
    agent_app: App,
    monkeypatch: pytest.MonkeyPatch,
    tool_input: JsonValue,
    tool_output: JsonValue,
    label: dict[str, str] | None,
    icon: str | EmojiIconDict,
    error: str | None,
) -> None:
    raw_input = json.dumps({"search": tool_input})
    raw_output = tool_output if isinstance(tool_output, str) else json.dumps({"search": tool_output})
    parameters = {"limit": 0, "enabled": False, "nested": ["value", None]}
    thought = MessageAgentThought(
        message_id=_MESSAGE_ID,
        position=1,
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by="account-1",
        tool="search",
        tool_labels_str=json.dumps({"search": label} if label is not None else {}),
        tool_meta_str=json.dumps(
            {
                "search": {
                    "error": error,
                    "time_cost": 0,
                    "tool_config": {"tool_provider_type": "api", "tool_provider": "provider-1"},
                    "tool_parameters": parameters,
                }
            }
        ),
        tool_input=raw_input,
        observation=raw_output,
        message_files=json.dumps(["file-1"]),
    )
    sqlite_session.add(thought)
    sqlite_session.commit()
    monkeypatch.setattr(agent_service.ToolManager, "get_tool_icon", lambda **_kwargs: icon)

    response = _get_logs(app, sqlite_session, agent_app)

    assert response.meta.status == "success"
    assert response.meta.elapsed_time == 0
    assert response.meta.total_tokens == 12
    iteration = response.iterations[0]
    assert iteration.tokens is None
    assert iteration.thought is None
    assert iteration.files == ["file-1"]
    assert iteration.tool_raw.model_dump() == {"inputs": raw_input, "outputs": raw_output}
    assert [call.model_dump(mode="json") for call in iteration.tool_calls] == [
        {
            "status": "error" if error else "success",
            "error": error,
            "time_cost": 0,
            "tool_name": "search",
            "tool_label": label if label is not None else "search",
            "tool_input": tool_input,
            "tool_output": tool_output,
            "tool_parameters": parameters,
            "tool_icon": icon,
        }
    ]


def test_agent_log_endpoint_preserves_nullable_raw_thought_and_strategy(
    app: Flask, sqlite_session: Session, agent_app: App
) -> None:
    model_config = sqlite_session.get(AppModelConfig, agent_app.app_model_config_id)
    assert model_config is not None
    model_config.agent_mode = json.dumps({"enabled": True, "strategy": None, "tools": []})
    sqlite_session.add(
        MessageAgentThought(
            message_id=_MESSAGE_ID,
            position=1,
            created_by_role=CreatorUserRole.ACCOUNT,
            created_by="account-1",
            tool_labels_str="{}",
            tool_meta_str="{}",
        )
    )
    sqlite_session.commit()

    response = _get_logs(app, sqlite_session, agent_app)

    assert response.meta.agent_mode is None
    iteration = response.iterations[0]
    assert iteration.tool_raw.model_dump() == {"inputs": None, "outputs": None}
    assert iteration.tool_calls == []
    assert iteration.files == []


def test_agent_log_endpoint_preserves_complete_message_file_metadata(
    app: Flask,
    sqlite_session: Session,
    agent_app: App,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    message_file = MessageFileModel(
        message_id=_MESSAGE_ID,
        type=FileType.IMAGE,
        transfer_method=FileTransferMethod.REMOTE_URL,
        url="https://example.com/photo.png",
        belongs_to=MessageFileBelongsTo.ASSISTANT,
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by="account-1",
    )
    sqlite_session.add(message_file)
    sqlite_session.commit()
    file = File(
        file_id=message_file.id,
        file_type=FileType.IMAGE,
        transfer_method=FileTransferMethod.REMOTE_URL,
        remote_url=message_file.url,
        filename="photo.png",
        extension=".png",
        mime_type="image/png",
        size=123,
    )
    monkeypatch.setattr("factories.file_factory.build_from_mapping", lambda **_kwargs: file)
    monkeypatch.setattr(File, "generate_url", lambda _self: "https://example.com/photo.png")

    response = _get_logs(app, sqlite_session, agent_app)

    assert [file.model_dump(mode="json") for file in response.files] == [
        {**file.to_dict(), "belongs_to": "assistant", "upload_file_id": None},
    ]
    assert response.iterations == []
