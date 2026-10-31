"""Contract tests for the trusted Agent LLM streaming gateway."""

import json
import warnings
from collections.abc import Generator
from contextlib import contextmanager
from copy import deepcopy
from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest
from flask import Flask
from pydantic import JsonValue

from controllers.inner_api import bp as inner_api_bp
from core.errors.error import QuotaExceededError
from graphon.model_runtime.entities.llm_entities import LLMResultChunk, LLMResultChunkDelta, LLMUsage
from graphon.model_runtime.entities.message_entities import AssistantPromptMessage, PromptMessage, UserPromptMessage
from graphon.model_runtime.model_providers.base.large_language_model import LargeLanguageModel
from services.agent_llm_inner_service import (
    AgentLLMInnerService,
    AgentLLMInnerServiceError,
    PreparedAgentLLMInvocation,
)
from services.entities.agent_llm_inner import AgentLLMInvokeRequest
from tests.helpers.unit.config_override import config_overrides_context
from tests.helpers.unit.core.model_fixtures import make_model_instance


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


@pytest.mark.parametrize("stream_error", [False, True], ids=["completed", "provider-error"])
def test_post_preserves_raw_prompts_without_serializing_them(
    monkeypatch: pytest.MonkeyPatch, stream_error: bool
) -> None:
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
        {
            "role": "user",
            "content": [
                {"type": "text", "data": "Inspect this image"},
                {
                    "type": "image",
                    "format": "png",
                    "url": "https://example.com/image.png",
                    "mime_type": "image/png",
                    "detail": "high",
                    "provider_extension": {"quality": "original"},
                },
            ],
        },
    ]
    target = payload["target"]
    assert isinstance(target, dict)
    target["prompt_messages"] = prompt_messages
    original_prompt_messages = deepcopy(prompt_messages)
    model_instance = make_model_instance(provider="openai", model="gpt-test")
    assert isinstance(model_instance.model_type_instance, LargeLanguageModel)
    captured_requests: list[AgentLLMInvokeRequest] = []
    runtime_prompt_messages: list[list[PromptMessage]] = []
    usage = LLMUsage.from_metadata({"prompt_tokens": 11, "completion_tokens": 2, "total_price": "0.002"})
    chunks = [
        LLMResultChunk(
            model="gpt-test",
            system_fingerprint="fp-test",
            delta=LLMResultChunkDelta(index=index, message=AssistantPromptMessage(content=content)),
        )
        for index, content in enumerate(["Dify", " ready", ""])
    ]
    chunks[1].delta.message.tool_calls = [
        AssistantPromptMessage.ToolCall(
            id="call-2",
            type="function",
            function=AssistantPromptMessage.ToolCall.ToolCallFunction(name="search", arguments='{"query":"Dify"}'),
        )
    ]
    chunks[-1].delta.usage = usage
    chunks[-1].delta.finish_reason = "tool_calls"

    def prepare(_service: AgentLLMInnerService, request: AgentLLMInvokeRequest) -> PreparedAgentLLMInvocation:
        captured_requests.append(request)
        return PreparedAgentLLMInvocation(request=request, model_instance=model_instance)

    def provider_stream(*, prompt_messages: list[PromptMessage], **_kwargs: object) -> Generator[LLMResultChunk]:
        runtime_prompt_messages.append(prompt_messages)
        yield from chunks[:2]
        if stream_error:
            raise ValueError("provider stream failed")
        yield chunks[-1]

    # Replace only preflight database resolution and the external provider boundary;
    # the service, model instance, and Graphon streaming wrapper execute normally.
    monkeypatch.setattr(AgentLLMInnerService, "prepare", prepare)
    monkeypatch.setattr(model_instance.model_type_instance.model_runtime, "invoke_llm", provider_stream)

    with (
        _agent_inner_auth(),
        warnings.catch_warnings(record=True) as recorded_warnings,
    ):
        warnings.simplefilter("always")
        response = (
            _flask_app()
            .test_client()
            .post(
                "/inner/api/agent/llm/invoke",
                json=payload,
                headers={"X-Inner-Api-Key": "inner-key"},
            )
        )
        envelopes = [
            json.loads(event.removeprefix("data: ")) for event in response.get_data(as_text=True).strip().split("\n\n")
        ]

    assert response.status_code == 200
    assert not any("PydanticSerializationUnexpectedValue" in str(warning.message) for warning in recorded_warnings)
    assert captured_requests[0].target.prompt_messages == original_prompt_messages
    assert runtime_prompt_messages == [original_prompt_messages]
    assert prompt_messages == original_prompt_messages

    successful_envelopes = envelopes[:-1] if stream_error else envelopes
    expected_chunks = chunks[:2] if stream_error else chunks
    assert len(successful_envelopes) == len(expected_chunks)
    for envelope, chunk in zip(successful_envelopes, expected_chunks, strict=True):
        assert envelope["code"] == 0
        assert envelope["message"] == ""
        assert "prompt_messages" not in envelope["data"]
        assert envelope["data"]["delta"] == chunk.delta.model_dump(mode="json")
        assert envelope["data"]["system_fingerprint"] == "fp-test"
        assert LLMResultChunk.model_validate(envelope["data"]).model == "gpt-test"
        # Graphon must have restored the raw history before the controller serializes.
        assert chunk.prompt_messages == original_prompt_messages
        assert all(isinstance(message, dict) for message in chunk.prompt_messages)

    if stream_error:
        assert envelopes[-1]["code"] == -500
        assert envelopes[-1]["data"] is None
        assert json.loads(envelopes[-1]["message"]) == {
            "error_type": "ValueError",
            "message": "provider stream failed",
        }
    else:
        assert envelopes[-1]["data"]["delta"]["usage"] == usage.model_dump(mode="json")
        assert envelopes[-1]["data"]["delta"]["finish_reason"] == "tool_calls"


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
