"""Agent log transport delegates stable identity without acquiring a Session."""

from collections.abc import Mapping
from dataclasses import dataclass, field
from inspect import unwrap
from uuid import UUID

import pytest

from controllers.console.app import agent
from controllers.console.app.error import AppNotFoundError
from controllers.console.wraps import RBACPermission
from machinery.context import RequestContext
from services.agent.log_contracts import AgentLogAppNotFoundError
from tests.unit_tests.controllers.rbac_introspection import rbac_checks

CONTEXT = RequestContext("request", "trace", "viewer", "tenant")
APP_ID = UUID("00000000-0000-0000-0000-000000000001")
MESSAGE_ID = "00000000-0000-0000-0000-000000000002"
CONVERSATION_ID = "00000000-0000-0000-0000-000000000003"

type LogCall = tuple[RequestContext, dict[str, str]]


def response_mapping(value: object) -> dict[str, object]:
    assert isinstance(value, Mapping)
    return {key: item for key, item in value.items() if isinstance(key, str)}


@dataclass
class LogService:
    error: Exception | None = None
    calls: list[LogCall] = field(default_factory=list)

    def get(
        self,
        context: RequestContext,
        *,
        app_id: str,
        conversation_id: str,
        message_id: str,
    ) -> dict[str, object]:
        self.calls.append(
            (
                context,
                {"app_id": app_id, "conversation_id": conversation_id, "message_id": message_id},
            )
        )
        if self.error:
            raise self.error
        return {
            "meta": {
                "status": "success",
                "executor": "user",
                "start_time": "2024-01-01T00:00:00+00:00",
                "total_tokens": 3,
                "agent_mode": "react",
                "iterations": 1,
            },
            "iterations": [
                {
                    "tokens": 3,
                    "created_at": "2024-01-01T00:00:00",
                    "thought": "Read",
                    "tool_raw": dict[str, object](),
                    "tool_calls": [
                        {
                            "status": "success",
                            "time_cost": 0,
                            "tool_name": "search",
                            "tool_label": "Search",
                            "tool_input": dict[str, object](),
                            "tool_output": "text output",
                            "tool_parameters": dict[str, object](),
                        }
                    ],
                }
            ],
            "files": list[object](),
        }


@dataclass
class AgentServices:
    logs: LogService


@dataclass
class Services:
    agent_apps: AgentServices


@pytest.mark.parametrize("missing", [False, True])
def test_log_controller_delegates_context_and_serializes(monkeypatch: pytest.MonkeyPatch, missing: bool) -> None:
    logs = LogService(AgentLogAppNotFoundError() if missing else None)
    monkeypatch.setattr(agent, "application_services", lambda: Services(AgentServices(logs)))
    endpoint = agent.AgentLogApi()
    method = unwrap(endpoint.get)
    payload = agent.AgentLogQuery(message_id=MESSAGE_ID, conversation_id=CONVERSATION_ID)
    if missing:
        with pytest.raises(AppNotFoundError):
            method(endpoint, payload, CONTEXT, APP_ID)
    else:
        response = response_mapping(method(endpoint, payload, CONTEXT, APP_ID))
        iterations = response["iterations"]
        assert isinstance(iterations, list)
        tool_calls = response_mapping(iterations[0])["tool_calls"]
        assert isinstance(tool_calls, list)
        assert response_mapping(tool_calls[0])["tool_output"] == "text output"
    assert logs.calls == [
        (CONTEXT, {"app_id": str(APP_ID), "message_id": MESSAGE_ID, "conversation_id": CONVERSATION_ID})
    ]


def test_log_admission_preserves_view_layout_permission() -> None:
    assert [check.scene for check in rbac_checks(agent.AgentLogApi.get)] == [RBACPermission.APP_VIEW_LAYOUT]
