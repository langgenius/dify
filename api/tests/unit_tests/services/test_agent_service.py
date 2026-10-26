"""Regression coverage for historical Classic Agent tool logs."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import cast

import pytest

from core.tools.entities.tool_entities import ToolProviderType
from machinery.context import RequestContext
from models.model import AppModelConfigDict
from services.agent.log_contracts import AgentLogSnapshot, AgentLogThought
from services.agent.log_service import AgentLogService

_NOW = datetime(2026, 1, 1, tzinfo=UTC)
_CONTEXT = RequestContext("request", None, "account-id", "tenant-id")


@dataclass(frozen=True)
class _Records:
    snapshot: AgentLogSnapshot

    def agent_log(
        self, *, tenant_id: str, account_id: str, app_id: str, conversation_id: str, message_id: str
    ) -> AgentLogSnapshot:
        assert (tenant_id, account_id, app_id, conversation_id, message_id) == (
            "tenant-id",
            "account-id",
            "app-id",
            "conversation-id",
            "message-id",
        )
        return self.snapshot


class _Files:
    def resolve(self, *, tenant_id: str, files: list[dict[str, object]]) -> list[dict[str, object]]:
        assert tenant_id == "tenant-id"
        assert files == []
        return []


@dataclass
class _ToolIcons:
    calls: list[dict[str, str]] = field(default_factory=list)

    def __call__(self, *, tenant_id: str, provider_type: ToolProviderType, provider_id: str) -> str:
        self.calls.append({"tenant_id": tenant_id, "provider_type": provider_type.value, "provider_id": provider_id})
        return "icon-url"


def _snapshot(*, tool_still_configured: bool) -> AgentLogSnapshot:
    tools: list[dict[str, object]] = (
        [{"enabled": True, "provider_type": "api", "provider_id": "provider-id", "tool_name": "old_tool"}]
        if tool_still_configured
        else []
    )
    model_config = cast(
        AppModelConfigDict,
        {
            "model": {"provider": "openai", "name": "gpt", "mode": "chat"},
            "agent_mode": {"enabled": True, "strategy": "react", "tools": tools},
        },
    )
    thought = AgentLogThought(
        tokens=1,
        tools=["old_tool"],
        labels={},
        metadata={"old_tool": {"tool_config": {}}},
        inputs={},
        outputs={},
        raw_input="{}",
        raw_output="{}",
        thought="historical thought",
        created_at=_NOW,
        files=[],
    )
    return AgentLogSnapshot(
        executor="Executor",
        timezone="UTC",
        created_at=_NOW,
        elapsed_time=0.1,
        total_tokens=2,
        model_config=model_config,
        thoughts=[thought],
        files=[],
    )


@pytest.mark.parametrize("tool_still_configured", [False, True])
def test_legacy_tool_log_without_provider_metadata_uses_configured_tool_or_blank_icon(
    tool_still_configured: bool,
) -> None:
    icons = _ToolIcons()
    service = AgentLogService(
        records=_Records(_snapshot(tool_still_configured=tool_still_configured)), icons=icons, files=_Files()
    )

    result = service.get(
        _CONTEXT,
        app_id="app-id",
        conversation_id="conversation-id",
        message_id="message-id",
    )

    assert result["iterations"][0]["tool_calls"][0]["tool_icon"] == ("icon-url" if tool_still_configured else "")
    expected_calls: list[dict[str, str]] = (
        [{"tenant_id": "tenant-id", "provider_type": "api", "provider_id": "provider-id"}]
        if tool_still_configured
        else []
    )
    assert icons.calls == expected_calls
