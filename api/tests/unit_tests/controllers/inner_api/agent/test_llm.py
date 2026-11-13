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
from core.errors.error import ModelCurrentlyNotSupportError, ProviderTokenNotInitError, QuotaExceededError
from core.plugin.impl.exc import (
    PluginDaemonBadRequestError,
    PluginDaemonClientSideError,
    PluginDaemonError,
    PluginDaemonInternalError,
    PluginDaemonInternalServerError,
    PluginDaemonNotFoundError,
    PluginDaemonUnauthorizedError,
    PluginInvokeError,
    PluginLLMPollingUnsupportedError,
    PluginNotFoundError,
    PluginPermissionDeniedError,
    PluginRuntimeError,
    PluginUniqueIdentifierError,
)
from graphon.model_runtime.entities.llm_entities import LLMResultChunk, LLMResultChunkDelta, LLMUsage
from graphon.model_runtime.entities.message_entities import AssistantPromptMessage, PromptMessage, UserPromptMessage
from graphon.model_runtime.errors.invoke import (
    InvokeAuthorizationError,
    InvokeBadRequestError,
    InvokeConnectionError,
    InvokeError,
    InvokeRateLimitError,
    InvokeServerUnavailableError,
)
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
    # Match app_factory's domain 404 behavior without Flask-RESTX route suggestions.
    app.config.update(TESTING=True, RESTX_ERROR_404_HELP=False)
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
    monkeypatch: pytest.MonkeyPatch, stream_error: bool, caplog: pytest.LogCaptureFixture
) -> None:
    payload = _payload()
    caller = payload["caller"]
    assert isinstance(caller, dict)
    caller["trace_id"] = "trace-1"
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
        record = next(record for record in caplog.records if "Agent LLM stream failed" in record.message)
        assert record.exc_info is not None
        for key in ("agent_run_id", "invocation_id", "app_id", "trace_id"):
            assert f"{key}={caller[key]}" in record.message
        assert "provider=openai model=gpt-test" in record.message
        assert "Traceback" in caplog.text
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


@pytest.mark.parametrize("wrapped", [False, True], ids=["direct", "base-invoke-wrapper"])
def test_unexpected_preparation_failure_logs_caller_context_and_traceback(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture, wrapped: bool
) -> None:
    payload = _payload()
    caller = payload["caller"]
    assert isinstance(caller, dict)
    caller["trace_id"] = "trace-1"

    def fail_prepare(_self: AgentLLMInnerService, _request: AgentLLMInvokeRequest) -> PreparedAgentLLMInvocation:
        error = RuntimeError("preparation failed")
        if wrapped:
            raise InvokeError("[Test] Error: preparation failed") from error
        raise error

    monkeypatch.setattr(AgentLLMInnerService, "prepare", fail_prepare)
    http_app = _flask_app()
    http_app.config["PROPAGATE_EXCEPTIONS"] = False
    with _agent_inner_auth():
        response = http_app.test_client().post(
            "/inner/api/agent/llm/invoke",
            json=payload,
            headers={"X-Inner-Api-Key": "inner-key"},
        )
    assert response.status_code == 500
    assert response.get_json() == {
        "code": "agent_llm_internal_error",
        "message": "Internal Server Error, please contact support.",
        "status": 500,
    }
    record = next(record for record in caplog.records if "Agent LLM preparation failed" in record.message)
    assert record.exc_info is not None
    for key in ("agent_run_id", "invocation_id", "app_id", "trace_id"):
        assert f"{key}={caller[key]}" in record.message
    assert "provider=openai model=gpt-test" in record.message
    assert "preparation failed" in caplog.text
    assert "Traceback" in caplog.text


@pytest.mark.parametrize("wrapped", [False, True], ids=["direct", "base-invoke-wrapper"])
@pytest.mark.parametrize(
    ("source_error", "status"),
    [
        (PluginDaemonError("daemon failure"), 502),
        (PluginRuntimeError("runtime failure"), 502),
        (PluginDaemonInternalError("daemon failure"), 502),
        (PluginDaemonInternalServerError("daemon failure"), 502),
        (PluginDaemonNotFoundError("daemon missing"), 404),
        (PluginNotFoundError("plugin missing"), 404),
        (PluginDaemonUnauthorizedError("daemon unauthorized"), 401),
        (PluginPermissionDeniedError("plugin forbidden"), 403),
        (PluginDaemonClientSideError("invalid request"), 400),
        (PluginDaemonBadRequestError("invalid request"), 400),
        (PluginInvokeError("invalid invocation"), 400),
        (PluginInvokeError('{"error_type":"InvokeRateLimitError","message":"provider busy"}'), 400),
        (PluginUniqueIdentifierError("invalid identifier"), 400),
        (PluginLLMPollingUnsupportedError("polling unavailable"), 400),
        (InvokeAuthorizationError("invalid credentials"), 401),
        (InvokeRateLimitError("provider busy"), 429),
        (InvokeBadRequestError("invalid model request"), 400),
        (InvokeConnectionError("connection failed"), 502),
        (InvokeServerUnavailableError("provider unavailable"), 502),
        (InvokeError("explicit invocation failure"), 502),
        (ProviderTokenNotInitError("Configure provider credentials."), 400),
        (ProviderTokenNotInitError(), 400),
        (ModelCurrentlyNotSupportError(), 400),
        (QuotaExceededError("credits exhausted"), 429),
        (ValueError("invalid model"), 400),
    ],
)
def test_post_preserves_preparation_error_classification(
    monkeypatch: pytest.MonkeyPatch, source_error: Exception, status: int, wrapped: bool
) -> None:
    def fail_prepare(_self: AgentLLMInnerService, _request: AgentLLMInvokeRequest) -> PreparedAgentLLMInvocation:
        if wrapped:
            raise InvokeError(f"[Test] Error: {source_error}") from source_error
        raise source_error

    monkeypatch.setattr(AgentLLMInnerService, "prepare", fail_prepare)
    with _agent_inner_auth():
        response = (
            _flask_app()
            .test_client()
            .post("/inner/api/agent/llm/invoke", json=_payload(), headers={"X-Inner-Api-Key": "inner-key"})
        )
    if isinstance(source_error, QuotaExceededError):
        code, message = "agent_llm_quota_exceeded", "credits exhausted"
    elif isinstance(
        source_error, InvokeError | PluginDaemonError | ProviderTokenNotInitError | ModelCurrentlyNotSupportError
    ):
        code = "agent_llm_invoke_failed"
        message = f"{type(source_error).__name__}: {source_error.description}"
    else:
        code, message = "invalid_model_request", "invalid model"
    assert response.status_code == status
    assert response.get_json() == {"code": code, "message": message, "status": status}


@pytest.mark.parametrize("emit_partial_chunk", [False, True], ids=["invoke-establishment", "stream-after-chunk"])
@pytest.mark.parametrize(
    ("source_error", "error_type", "message", "code"),
    [
        (PluginRuntimeError("plugin unavailable"), "PluginRuntimeError", "plugin unavailable", -500),
        (
            RuntimeError("private runtime detail"),
            "AgentLLMInternalError",
            "Internal Server Error, please contact support.",
            -500,
        ),
        (QuotaExceededError("credits exhausted"), "AgentLLMQuotaExceededError", "credits exhausted", -429),
        (InvokeError("explicit invocation failure"), "InvokeError", "explicit invocation failure", -500),
        (InvokeRateLimitError("provider busy"), "InvokeRateLimitError", "provider busy", -500),
        (
            ProviderTokenNotInitError("Configure provider credentials."),
            "ProviderTokenNotInitError",
            "Configure provider credentials.",
            -500,
        ),
        (ModelCurrentlyNotSupportError(), "ModelCurrentlyNotSupportError", "Model Currently Not Support", -500),
        (ProviderTokenNotInitError(), "ProviderTokenNotInitError", "Provider Token Not Init", -500),
    ],
)
def test_post_classifies_failures_through_real_model_instance_and_graphon(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
    source_error: Exception,
    emit_partial_chunk: bool,
    error_type: str,
    message: str,
    code: int,
) -> None:
    model_instance = make_model_instance(provider="openai", model="gpt-test")

    def prepare(_self: AgentLLMInnerService, request: AgentLLMInvokeRequest) -> PreparedAgentLLMInvocation:
        return PreparedAgentLLMInvocation(request=request, model_instance=model_instance)

    def provider_invoke(**_kwargs: object) -> Generator[LLMResultChunk]:
        if not emit_partial_chunk:
            raise source_error

        def stream() -> Generator[LLMResultChunk]:
            yield LLMResultChunk(
                model="gpt-test",
                delta=LLMResultChunkDelta(index=0, message=AssistantPromptMessage(content="partial answer")),
            )
            raise source_error

        return stream()

    monkeypatch.setattr(AgentLLMInnerService, "prepare", prepare)
    monkeypatch.setattr(model_instance.model_type_instance.model_runtime, "invoke_llm", provider_invoke)
    with _agent_inner_auth():
        response = (
            _flask_app()
            .test_client()
            .post("/inner/api/agent/llm/invoke", json=_payload(), headers={"X-Inner-Api-Key": "inner-key"})
        )
        envelopes = [
            json.loads(event.removeprefix("data: ")) for event in response.get_data(as_text=True).split("\n\n") if event
        ]
    assert response.status_code == 200
    assert len(envelopes) == (2 if emit_partial_chunk else 1)
    if emit_partial_chunk:
        assert envelopes[0]["code"] == 0
        assert envelopes[0]["data"]["delta"]["message"]["content"] == "partial answer"
    assert envelopes[-1]["code"] == code
    assert json.loads(envelopes[-1]["message"]) == {"error_type": error_type, "message": message}
    if isinstance(source_error, PluginRuntimeError | RuntimeError):
        record = next(record for record in caplog.records if "Agent LLM stream failed" in record.message)
        assert record.exc_info
        wrapper = record.exc_info[1]
        assert type(wrapper) is InvokeError
        assert wrapper.__cause__ is source_error
    if isinstance(source_error, RuntimeError):
        assert "private runtime detail" not in response.get_data(as_text=True)
        assert "private runtime detail" in caplog.text


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
