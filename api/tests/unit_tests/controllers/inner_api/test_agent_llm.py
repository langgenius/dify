"""Contract tests for the trusted Agent LLM streaming gateway."""

import json
from collections.abc import Generator
from contextlib import contextmanager
from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest
from flask import Flask, g
from flask import request as flask_request
from pydantic import JsonValue

from controllers.inner_api import bp as inner_api_bp
from core.errors.error import QuotaExceededError
from graphon.model_runtime.entities.llm_entities import LLMResultChunk, LLMResultChunkDelta
from graphon.model_runtime.entities.message_entities import AssistantPromptMessage, UserPromptMessage
from services.agent_llm_inner_service import AgentLLMInnerServiceError, PreparedAgentLLMInvocation
from services.entities.agent_llm_inner import AgentLLMInvokeRequest
from tests.unit_tests.config_override import config_overrides_context


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
        config_overrides_context(PLUGIN_DAEMON_KEY="plugin-daemon-key", INNER_API_KEY_FOR_PLUGIN="inner-key"),
    ):
        yield


def _flask_app() -> Flask:
    app = Flask(__name__)
    app.config["TESTING"] = True
    app.register_blueprint(inner_api_bp)
    return app


def test_post_streams_plugin_compatible_envelope() -> None:
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
        patch("controllers.inner_api.agent.llm.AgentLLMInnerService.invoke", return_value=iter([chunk])),
    ):
        response = (
            _flask_app()
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


def test_post_preserves_prompt_messages_without_transport_validation() -> None:
    payload = _payload()
    prompt_messages: list[dict[str, JsonValue]] = [
        {
            "role": "assistant",
            "content": "prior answer",
            "tool_calls": [],
        },
        {
            "role": "assistant",
            "content": "",
            "tool_calls": [
                {
                    "id": "call-1",
                    "type": "function",
                    "function": {"name": "search", "arguments": '{"query":"Dify"}'},
                }
            ],
            "provider_extension": {"thought_signature": "opaque"},
        },
        {
            "role": "tool",
            "content": "result",
            "name": "search",
            "tool_call_id": "call-1",
        },
    ]
    target = payload["target"]
    assert isinstance(target, dict)
    target["prompt_messages"] = prompt_messages
    captured: dict[str, AgentLLMInvokeRequest] = {}

    def prepare(request: AgentLLMInvokeRequest) -> PreparedAgentLLMInvocation:
        captured["request"] = request
        return PreparedAgentLLMInvocation(request=request, model_instance=MagicMock())

    with (
        _agent_inner_auth(),
        patch("controllers.inner_api.agent.llm.AgentLLMInnerService.prepare", side_effect=prepare),
        patch("controllers.inner_api.agent.llm.AgentLLMInnerService.invoke", return_value=iter([])),
    ):
        response = (
            _flask_app()
            .test_client()
            .post(
                "/inner/api/agent/llm/invoke",
                json=payload,
                headers={"X-Inner-Api-Key": "inner-key"},
            )
        )

    assert response.status_code == 200
    assert captured["request"].target.prompt_messages == prompt_messages


def test_post_rejects_invalid_body_before_model_resolution() -> None:
    with _agent_inner_auth():
        response = (
            _flask_app()
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
            _flask_app()
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


def test_post_preserves_stream_quota_failure() -> None:
    payload = _payload()
    prepared = PreparedAgentLLMInvocation(
        request=AgentLLMInvokeRequest.model_validate(payload),
        model_instance=MagicMock(),
    )
    with (
        _agent_inner_auth(),
        patch("controllers.inner_api.agent.llm.AgentLLMInnerService.prepare", return_value=prepared),
        patch(
            "controllers.inner_api.agent.llm.AgentLLMInnerService.invoke",
            side_effect=QuotaExceededError("Insufficient hosted model quota remaining."),
        ),
    ):
        response = (
            _flask_app()
            .test_client()
            .post(
                "/inner/api/agent/llm/invoke",
                json=payload,
                headers={"X-Inner-Api-Key": "inner-key"},
            )
        )

    envelope = json.loads(response.get_data(as_text=True).strip().removeprefix("data: "))
    error = json.loads(envelope["message"])
    assert response.status_code == 200
    assert envelope["code"] == -429
    assert error == {
        "error_type": "AgentLLMQuotaExceededError",
        "message": "Insufficient hosted model quota remaining.",
    }


@pytest.mark.parametrize(
    ("failure", "error_type", "message", "code"),
    [
        (
            RuntimeError("PRIVATE_MODEL_TOKEN_CANARY"),
            "NativeAgentModelDispatchFailed",
            "Native Agent model invocation failed.",
            -500,
        ),
        (
            QuotaExceededError("PRIVATE_MODEL_TOKEN_CANARY"),
            "AgentLLMQuotaExceededError",
            "Insufficient hosted model quota remaining.",
            -429,
        ),
    ],
)
def test_native_stream_error_is_bounded_even_if_provider_raises_private_text(
    failure, error_type, message, code
) -> None:
    from tests.unit_tests.services.dify_builder.test_agent_operation_owner import envelope

    payload = {**_payload(), "native_dispatch": envelope().model_dump(mode="json")}
    prepared = PreparedAgentLLMInvocation(
        request=AgentLLMInvokeRequest.model_validate(payload), model_instance=MagicMock()
    )
    app = _flask_app()

    @app.before_request
    def admitted_transport():
        # This test exercises the emitter after the independently tested runtime admission guard.
        g.agent_runtime_admitted = True
        g.agent_runtime_request = flask_request._get_current_object()

    with (
        _agent_inner_auth(),
        patch("controllers.inner_api.agent.llm.claim_agent_endpoint"),
        patch("controllers.inner_api.agent.llm.AgentLLMInnerService.prepare", return_value=prepared),
        patch("controllers.inner_api.agent.llm.AgentLLMInnerService.invoke", side_effect=failure),
    ):
        response = app.test_client().post("/inner/api/agent/llm/invoke", json=payload)
    assert response.status_code == 200
    body = response.get_data(as_text=True)
    assert "PRIVATE_MODEL_TOKEN_CANARY" not in body
    wire = json.loads(body.strip().removeprefix("data: "))
    assert wire["code"] == code
    assert json.loads(wire["message"]) == {"error_type": error_type, "message": message}
