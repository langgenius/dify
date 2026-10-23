"""Regression coverage for historical Classic Agent tool logs."""

from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import cast

import pytest
from sqlalchemy.orm import Session

from models import Account, App
from services import agent_service

_NOW = datetime(2026, 1, 1, tzinfo=UTC)


@dataclass(frozen=True)
class _AgentThought:
    tools: list[str]
    tool_meta: dict[str, object]
    tool_labels: dict[str, str] = field(default_factory=dict)
    tool_inputs_dict: dict[str, object] = field(default_factory=dict)
    tool_outputs_dict: dict[str, object] = field(default_factory=dict)
    tokens: int = 1
    tool_input: str = "{}"
    observation: str = "{}"
    thought: str = "historical thought"
    created_at: datetime = _NOW
    files: list[str] = field(default_factory=list)


@dataclass
class _Message:
    agent_thoughts: list[_AgentThought]
    created_at: datetime = _NOW
    provider_response_latency: float = 0.1
    answer_tokens: int = 1
    message_tokens: int = 1

    def agent_thoughts_with_session(self, session: object) -> list[_AgentThought]:
        del session
        return self.agent_thoughts

    def message_files_with_session(self, session: object) -> list[object]:
        del session
        return []


@dataclass(frozen=True)
class _Conversation:
    from_end_user_id: str | None = None
    from_account_id: str = "account-id"


class _AppModelConfig:
    agent_mode_dict = {"strategy": "react"}

    def to_dict(self, *, annotation_reply: object = None) -> dict[str, object]:
        del annotation_reply
        return {}


@dataclass(frozen=True)
class _App:
    id: str = "app-id"
    tenant_id: str = "tenant-id"

    def app_model_config_with_session(self, session: object) -> _AppModelConfig:
        del session
        return _AppModelConfig()


class _ScriptedSession:
    """Answers each `scalar` read in the order the log query issues them."""

    def __init__(self, *results: object) -> None:
        self._results: Iterator[object] = iter(results)

    def scalar(self, statement: object) -> object:
        del statement
        return next(self._results)


@dataclass(frozen=True)
class _AgentTool:
    tool_name: str
    provider_type: str
    provider_id: str


@dataclass(frozen=True)
class _AgentConfig:
    tools: list[_AgentTool]


@dataclass
class _ToolIcons:
    calls: list[dict[str, str]] = field(default_factory=list)

    def get_tool_icon(self, *, tenant_id: str, provider_type: str, provider_id: str) -> str:
        self.calls.append({"tenant_id": tenant_id, "provider_type": provider_type, "provider_id": provider_id})
        return "icon-url"


@pytest.mark.parametrize("tool_still_configured", [False, True])
def test_legacy_tool_log_without_provider_metadata_uses_configured_tool_or_blank_icon(
    monkeypatch: pytest.MonkeyPatch, tool_still_configured: bool
) -> None:
    account = Account(name="Executor", email="executor@example.test")
    account.timezone = "UTC"
    monkeypatch.setattr(agent_service, "current_user", account)

    thought = _AgentThought(tools=["old_tool"], tool_meta={"old_tool": {"tool_config": {}}})
    session = _ScriptedSession(_Conversation(), _Message(agent_thoughts=[thought]), "Executor")
    tool = _AgentTool(tool_name="old_tool", provider_type="api", provider_id="provider-id")
    agent_config = _AgentConfig(tools=[tool] if tool_still_configured else [])
    monkeypatch.setattr(agent_service.AgentConfigManager, "convert", lambda _: agent_config)
    monkeypatch.setattr(agent_service, "load_annotation_reply_config", lambda *_: None)
    icons = _ToolIcons()
    monkeypatch.setattr(agent_service.ToolManager, "get_tool_icon", icons.get_tool_icon)

    result = agent_service.AgentService.get_agent_logs(
        cast(App, _App()), "conversation-id", "message-id", cast(Session, session)
    )

    assert result["iterations"][0]["tool_calls"][0]["tool_icon"] == ("icon-url" if tool_still_configured else "")
    expected_calls: list[dict[str, str]] = (
        [{"tenant_id": "tenant-id", "provider_type": "api", "provider_id": "provider-id"}]
        if tool_still_configured
        else []
    )
    assert icons.calls == expected_calls
