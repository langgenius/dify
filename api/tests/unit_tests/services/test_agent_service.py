import json
from datetime import UTC, datetime
from typing import TypedDict, cast
from unittest.mock import MagicMock, patch

import pytest

from models.account import Account
from models.enums import CreatorUserRole
from models.model import MessageAgentThought
from services.agent_service import AgentService


class _Iteration(TypedDict):
    tool_calls: list[dict[str, object]]


class _AgentLogs(TypedDict):
    iterations: list[_Iteration]


def _agent_thought(*, tool: str, tool_input: str, observation: str, tool_meta_str: str) -> MessageAgentThought:
    thought = MessageAgentThought(
        message_id="message-1",
        position=1,
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by="account-1",
        tool=tool,
        tool_input=tool_input,
        observation=observation,
        tool_meta_str=tool_meta_str,
        tool_labels_str=json.dumps({"search": {"en_US": "Search"}}),
    )
    thought.created_at = datetime(2026, 8, 5, tzinfo=UTC)
    thought.tokens = 10
    return thought


def _get_agent_logs(agent_thought: MessageAgentThought) -> _AgentLogs:
    app_model = MagicMock(id="app-1", tenant_id="tenant-1")
    session = MagicMock()
    conversation = MagicMock(from_end_user_id=None, from_account_id="account-1")
    message = MagicMock(provider_response_latency=1.5, answer_tokens=1, message_tokens=2)
    message.agent_thoughts_with_session.return_value = [agent_thought]
    session.scalar.side_effect = [conversation, message, "Executor"]

    with (
        patch("services.agent_service.current_user", MagicMock(spec=Account, timezone="UTC")),
        patch("services.agent_service.load_annotation_reply_config", return_value=None),
        patch("services.agent_service.AgentConfigManager.convert", return_value=MagicMock(tools=[])),
        patch("services.agent_service.ToolManager.get_tool_icon", return_value="icon"),
    ):
        return cast(_AgentLogs, AgentService.get_agent_logs(app_model, "conversation-1", "message-1", session))


@pytest.fixture
def legacy_repeated() -> MessageAgentThought:
    # written before repeated calls were kept apart: the second call's data
    # overwrote the first, and the row holds one value for the tool name
    return _agent_thought(
        tool="search;search",
        tool_input=json.dumps({"search": {"q": "second"}}),
        observation=json.dumps({"search": "second result"}),
        tool_meta_str=json.dumps({"search": {"time_cost": 2, "tool_config": {"tool_provider_type": "builtin"}}}),
    )


def test_repeated_tool_renders_one_log_entry_per_call() -> None:
    thought = _agent_thought(
        tool="search;search",
        tool_input=json.dumps({"search": [{"q": "first"}, {"q": "second"}]}),
        observation=json.dumps({"search": ["first result", "second result"]}),
        tool_meta_str=json.dumps(
            {
                "search": [
                    {"time_cost": 1, "tool_config": {"tool_provider_type": "builtin", "tool_provider": "a"}},
                    {"time_cost": 2, "tool_config": {"tool_provider_type": "api", "tool_provider": "b"}},
                ]
            }
        ),
    )

    tool_calls = _get_agent_logs(thought)["iterations"][0]["tool_calls"]

    assert [call["tool_name"] for call in tool_calls] == ["search", "search"]
    assert [call["tool_input"] for call in tool_calls] == [{"q": "first"}, {"q": "second"}]
    assert [call["tool_output"] for call in tool_calls] == ["first result", "second result"]
    assert [call["time_cost"] for call in tool_calls] == [1, 2]


def test_legacy_repeated_tool_renders_exactly_as_it_did(legacy_repeated: MessageAgentThought) -> None:
    tool_calls = _get_agent_logs(legacy_repeated)["iterations"][0]["tool_calls"]

    assert [call["tool_name"] for call in tool_calls] == ["search", "search"]
    assert [call["tool_input"] for call in tool_calls] == [{"q": "second"}, {"q": "second"}]
    assert [call["tool_output"] for call in tool_calls] == ["second result", "second result"]
    assert [call["time_cost"] for call in tool_calls] == [2, 2]


def test_single_call_renders_one_entry() -> None:
    thought = _agent_thought(
        tool="search",
        tool_input=json.dumps({"search": {"q": "only"}}),
        observation=json.dumps({"search": "only result"}),
        tool_meta_str=json.dumps({"search": {"time_cost": 1, "tool_config": {"tool_provider_type": "builtin"}}}),
    )

    tool_calls = _get_agent_logs(thought)["iterations"][0]["tool_calls"]

    assert len(tool_calls) == 1
    assert tool_calls[0]["tool_input"] == {"q": "only"}
    assert tool_calls[0]["tool_output"] == "only result"
    assert tool_calls[0]["time_cost"] == 1


def test_distinct_tools_render_their_own_payloads() -> None:
    thought = _agent_thought(
        tool="search;calculator",
        tool_input=json.dumps({"search": {"q": "a"}, "calculator": {"expr": "1+1"}}),
        observation=json.dumps({"search": "search result", "calculator": "2"}),
        tool_meta_str=json.dumps({"search": {"time_cost": 1}, "calculator": {"time_cost": 2}}),
    )

    tool_calls = _get_agent_logs(thought)["iterations"][0]["tool_calls"]

    assert [call["tool_name"] for call in tool_calls] == ["search", "calculator"]
    assert [call["tool_input"] for call in tool_calls] == [{"q": "a"}, {"expr": "1+1"}]
    assert [call["tool_output"] for call in tool_calls] == ["search result", "2"]
