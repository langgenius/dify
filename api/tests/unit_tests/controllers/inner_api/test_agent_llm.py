"""Contract tests for the trusted Agent LLM streaming gateway."""

import json
from collections.abc import Generator
from contextlib import contextmanager
from unittest.mock import MagicMock, patch
from uuid import uuid4

from flask import Flask

from controllers.inner_api import bp as inner_api_bp
from graphon.model_runtime.entities.llm_entities import LLMResultChunk, LLMResultChunkDelta
from graphon.model_runtime.entities.message_entities import AssistantPromptMessage, UserPromptMessage
from services.agent_llm_inner_service import AgentLLMInnerServiceError, PreparedAgentLLMInvocation
from services.entities.agent_llm_inner import AgentLLMInvokeRequest


def _payload() -> dict[str, object]:
    return {
        "caller": {
            "invocation_id": str(uuid4()),
            "agent_run_id": str(uuid4()),
            "call_index": 1,
            "tenant_id": str(uuid4()),
            "user_id": str(uuid4()),
            "user_from": "account",
            "app_id": str(uuid4()),
            "invoke_from": "debugger",
            "agent_mode": "workflow_run",
            "agent_config_version_kind": "draft",
        },
        "target": {
            "provider": "openai",
            "model": "gpt-test",
            "prompt_messages": [UserPromptMessage(content="hello").model_dump(mode="json")],
            "model_parameters": {"temperature": 0.2},
            "stream": True,
        },
    }


@contextmanager
def _agent_inner_auth() -> Generator[None]:
    with (
        patch("configs.dify_config.PLUGIN_DAEMON_KEY", "plugin-daemon-key"),
        patch("configs.dify_config.INNER_API_KEY_FOR_PLUGIN", "inner-key"),
    ):
        yield


def _app() -> Flask:
    app = Flask(__name__)
    app.config["TESTING"] = True
    app.register_blueprint(inner_api_bp)
    return app


def test_post_streams_plugin_compatible_envelope_and_marks_terminal_status() -> None:
    payload = _payload()
    request = AgentLLMInvokeRequest.model_validate(payload)
    prepared = PreparedAgentLLMInvocation(request=request, model_instance=MagicMock())
    chunk = LLMResultChunk(
        model="gpt-test",
        delta=LLMResultChunkDelta(
            index=0,
            message=AssistantPromptMessage(content="done", tool_calls=[]),
        ),
    )

    with (
        _agent_inner_auth(),
        patch("controllers.inner_api.agent.llm.AgentLLMInnerService.prepare", return_value=prepared) as prepare,
        patch("controllers.inner_api.agent.llm.AgentLLMInnerService.mark_running") as mark_running,
        patch("controllers.inner_api.agent.llm.AgentLLMInnerService.invoke", return_value=iter([chunk])),
        patch("controllers.inner_api.agent.llm.AgentLLMInnerService.mark_succeeded") as mark_succeeded,
    ):
        response = (
            _app()
            .test_client()
            .post(
                "/inner/api/agent/llm/invoke",
                json=payload,
                headers={"X-Inner-Api-Key": "inner-key"},
            )
        )
        assert response.status_code == 200
        assert response.content_type == "text/event-stream"
        data_line = response.get_data(as_text=True).strip().removeprefix("data: ")
        envelope = json.loads(data_line)
        assert envelope["code"] == 0
        assert envelope["data"]["delta"]["message"]["content"] == "done"
        prepare.assert_called_once()
        mark_running.assert_called_once_with(request.caller.invocation_id)
        mark_succeeded.assert_called_once_with(request.caller.invocation_id, None)


def test_post_rejects_invalid_body_before_model_resolution() -> None:
    with _agent_inner_auth():
        response = (
            _app()
            .test_client()
            .post(
                "/inner/api/agent/llm/invoke",
                json={"caller": {}},
                headers={"X-Inner-Api-Key": "inner-key"},
            )
        )

    assert response.status_code == 400
    assert response.get_json()["code"] == "invalid_request"


def test_post_preserves_preflight_quota_failure() -> None:
    with (
        _agent_inner_auth(),
        patch(
            "controllers.inner_api.agent.llm.AgentLLMInnerService.prepare",
            side_effect=AgentLLMInnerServiceError(
                "agent_llm_quota_exceeded",
                "Insufficient Message Credits.",
                status_code=429,
            ),
        ),
    ):
        response = (
            _app()
            .test_client()
            .post(
                "/inner/api/agent/llm/invoke",
                json=_payload(),
                headers={"X-Inner-Api-Key": "inner-key"},
            )
        )

    assert response.status_code == 429
    assert response.get_json() == {
        "code": "agent_llm_quota_exceeded",
        "message": "Insufficient Message Credits.",
        "status": 429,
    }
