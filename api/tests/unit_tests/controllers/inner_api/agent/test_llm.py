"""Contract tests for the trusted Agent LLM streaming gateway."""

import json
from collections.abc import Generator
from contextlib import contextmanager
from typing import cast, override
from unittest.mock import patch
from uuid import uuid4

import pytest
from flask import Flask, Request, g
from flask import request as flask_request
from pydantic import JsonValue
from werkzeug.local import LocalProxy

from controllers.inner_api import bp as inner_api_bp
from core.errors.error import QuotaExceededError
from graphon.model_runtime.entities.llm_entities import LLMResultChunk, LLMResultChunkDelta
from graphon.model_runtime.entities.message_entities import AssistantPromptMessage, UserPromptMessage
from services.agent_llm_inner_service import AgentLLMInnerServiceError, PreparedAgentLLMInvocation
from services.dify_builder.native_testing.agent_operations import AgentOperationService
from services.entities.agent_llm_inner import AgentLLMInvokeRequest
from tests.helpers.unit.config_override import config_overrides_context
from tests.helpers.unit.core.model_fixtures import make_model_instance
from tests.unit_tests.services.dify_builder import native_owner_fixtures

operations_service = native_owner_fixtures.operations_service


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
    prepared = PreparedAgentLLMInvocation(
        request=request, model_instance=make_model_instance(provider="openai", model="gpt-test")
    )
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
        return PreparedAgentLLMInvocation(
            request=request, model_instance=make_model_instance(provider="openai", model="gpt-test")
        )

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
        model_instance=make_model_instance(provider="openai", model="gpt-test"),
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
    failure: Exception, error_type: str, message: str, code: int
) -> None:
    from tests.unit_tests.services.dify_builder.test_agent_operation_owner import envelope

    payload = {**_payload(), "native_dispatch": envelope().model_dump(mode="json")}
    prepared = PreparedAgentLLMInvocation(
        request=AgentLLMInvokeRequest.model_validate(payload),
        model_instance=make_model_instance(provider="openai", model="gpt-test"),
    )
    app = _flask_app()

    @app.before_request
    def admitted_transport() -> None:
        # This test exercises the emitter after the independently tested runtime admission guard.
        g.agent_runtime_admitted = True
        g.agent_runtime_request = cast(LocalProxy[Request], flask_request)._get_current_object()

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


@pytest.mark.parametrize(
    ("fault", "category"),
    [
        ("quota", "quota_exceeded"),
        ("authentication", "authentication"),
        ("bad_request", "bad_request"),
        ("rate_limit", "rate_limit"),
        ("connection", "connection"),
        ("timeout", "timeout"),
        ("unavailable", "service_unavailable"),
        ("validation", "invalid_response"),
        ("custom", "internal_unknown"),
        ("late_timeout", "timeout"),
        ("receipt_append", "result_too_large"),
        ("result_store", "internal_unknown"),
        ("outcome_complete", "internal_unknown"),
        ("unknown_settlement", "internal_unknown"),
    ],
)
def test_native_model_failure_stage_survives_real_gateway_without_private_text(
    fault: str,
    category: str,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
    operations_service: AgentOperationService,
) -> None:
    """The real owner/service/emitter must retain only fixed post-claim evidence."""
    from dify_agent.adapters.llm.provider import _raise_plugin_daemon_error
    from pydantic import ValidationError
    from pydantic_ai.exceptions import ModelAPIError

    from graphon.model_runtime.errors.invoke import (
        InvokeAuthorizationError,
        InvokeBadRequestError,
        InvokeConnectionError,
        InvokeRateLimitError,
        InvokeServerUnavailableError,
    )
    from services.agent_llm_inner_service import AgentLLMInnerService
    from services.dify_builder.native_testing import agent_operations as module
    from tests.unit_tests.services.dify_builder.test_agent_operation_owner import envelope

    class PrivateFailureError(TimeoutError):
        @override
        def __str__(self) -> str:
            pytest.fail("diagnostics read original exception text")

        def get_error_type(self) -> str:
            pytest.fail("diagnostics inspected arbitrary exception attributes")

    canary = "PRIVATE_MODEL_CREDENTIAL_PROMPT_NONCE"
    failures: dict[str, Exception] = {
        "quota": QuotaExceededError(canary),
        "authentication": InvokeAuthorizationError(canary),
        "bad_request": InvokeBadRequestError(canary),
        "rate_limit": InvokeRateLimitError(canary),
        "connection": InvokeConnectionError(canary),
        "timeout": TimeoutError(canary),
        "unavailable": InvokeServerUnavailableError(canary),
        "custom": PrivateFailureError(canary),
        "late_timeout": TimeoutError(canary),
    }
    failures["custom"].__cause__ = InvokeAuthorizationError(canary)
    try:
        LLMResultChunk.model_validate({"model": {"private": canary}})
    except ValidationError as invalid_chunk:
        failures["validation"] = invalid_chunk
    pending = envelope()
    pending = pending.model_copy(update={"intent": pending.intent.model_copy(update={"kind": "model"})})
    payload = {**_payload(), "native_dispatch": pending.model_dump(mode="json")}
    request = AgentLLMInvokeRequest.model_validate(payload)
    request.target.prompt_messages = [UserPromptMessage(content=canary).model_dump(mode="json")]
    model = make_model_instance(provider="openai", model="gpt-test")
    prepared = PreparedAgentLLMInvocation(request=request, model_instance=model)
    calls: list[str] = []

    def provider(**_kwargs: object) -> Generator[LLMResultChunk]:
        calls.append("provider")
        if fault in failures and fault != "late_timeout":
            raise failures[fault]
        yield LLMResultChunk(
            model="gpt-test", delta=LLMResultChunkDelta(index=0, message=AssistantPromptMessage(content="safe"))
        )
        if fault == "late_timeout":
            raise failures[fault]
        if fault == "unknown_settlement":
            raise RuntimeError(canary)
        if fault == "receipt_append":
            yield LLMResultChunk(
                model="gpt-test",
                delta=LLMResultChunkDelta(index=1, message=AssistantPromptMessage(content="x" * (1024 * 1024))),
            )

    def store(**_kwargs: object) -> str:
        calls.append("store")
        if fault == "result_store":
            raise RuntimeError(canary)
        return "model-result"

    def record(**kwargs: object) -> None:
        outcome = kwargs["outcome"]
        assert isinstance(outcome, str)
        calls.append(outcome)
        if fault == "outcome_complete" and outcome == "completed":
            raise RuntimeError(canary)
        if fault == "unknown_settlement" and outcome == "unknown":
            raise RuntimeError(canary)

    owner = operations_service
    monkeypatch.setattr(owner, "validate_model_request", lambda **_kwargs: None)
    monkeypatch.setattr(owner, "validate_model", lambda **_kwargs: None)
    monkeypatch.setattr(owner.bridge.authorization, "claim_dispatch", lambda **_kwargs: calls.append("claim"))
    monkeypatch.setattr(owner.bridge.authorization, "record_outcome", record)
    monkeypatch.setattr(owner.state_store, "store_result", store)
    monkeypatch.setattr(module, "agent_operations_for_ref", lambda _ref: owner)
    monkeypatch.setattr(model, "invoke_llm", provider)
    monkeypatch.setattr(AgentLLMInnerService, "prepare", lambda _self, _request: prepared)
    monkeypatch.setattr("controllers.inner_api.agent.llm.claim_agent_endpoint", lambda **_kwargs: None)
    app = _flask_app()

    @app.before_request
    def admitted_transport() -> None:
        g.agent_runtime_admitted = True
        g.agent_runtime_request = cast(LocalProxy[Request], flask_request)._get_current_object()

    with _agent_inner_auth():
        response = app.test_client().post("/inner/api/agent/llm/invoke", json=request.model_dump(mode="json"))
        body = response.get_data(as_text=True)
    wire = json.loads([line for line in body.splitlines() if line.startswith("data: ")][-1].removeprefix("data: "))
    error = json.loads(wire["message"])
    stage = fault if fault in {"receipt_append", "result_store", "outcome_complete", "unknown_settlement"} else "invoke"
    message = f"Native Agent model invocation failed. [stage={stage}; reason={category}]"
    assert response.status_code == 200
    assert wire["code"] == -500
    assert error == {"error_type": "NativeAgentModelDispatchFailed", "message": message}
    assert calls.count("provider") == calls.count("claim") == calls.count("unknown") == 1
    assert calls[0] == "claim"
    assert calls[-1] == "unknown"
    with pytest.raises(ModelAPIError) as sdk_error:
        _raise_plugin_daemon_error(model_name="gpt-test", error_type=error["error_type"], message=error["message"])
    assert str(sdk_error.value) == "NativeAgentModelDispatchFailed: " + message
    from runtime_contracts.builder.native.observation import parse_native_model_failure

    diagnostic = parse_native_model_failure(str(sdk_error.value))
    assert diagnostic is not None
    assert (diagnostic.stage, diagnostic.category) == (stage, category)
    assert canary not in body + str(sdk_error.value) + caplog.text


@pytest.mark.parametrize(
    "error",
    [
        "Native Agent model invocation failed. [stage=invoke; reason=timeout]",
        "NativeAgentModelDispatchFailed: Native Agent model invocation failed.",
        "prefix NativeAgentModelDispatchFailed: Native Agent model invocation failed. [stage=invoke; reason=timeout]",
        "NativeAgentModelDispatchFailed: Native Agent model invocation failed. [stage=invoke; reason=timeout] suffix",
        "NativeAgentModelDispatchFailed: Native Agent model invocation failed. [stage=PRIVATE_STAGE; reason=timeout]",
        "NativeAgentModelDispatchFailed: Native Agent model invocation failed. [stage=invoke; reason=PRIVATE_REASON]",
        "NativeAgentModelDispatchFailed: Native Agent model invocation failed. "
        "[stage=invoke; reason=timeout; token=PRIVATE]",
        "NativeAgentModelDispatchFailed: Native Agent model invocation failed. [stage=invoke; reason=timeout]\n",
        "PRIVATE" * 100,
    ],
)
def test_native_model_failure_decoder_rejects_untrusted_text(error: str) -> None:
    from runtime_contracts.builder.native.observation import parse_native_model_failure

    assert parse_native_model_failure(error) is None


def test_native_model_failure_codec_preserves_all_fixed_stage_category_pairs() -> None:
    from runtime_contracts.builder.native.observation import (
        NativeModelFailureCategory,
        NativeModelFailureDiagnostic,
        NativeModelFailureStage,
        format_native_model_failure,
        parse_native_model_failure,
    )

    stages: tuple[NativeModelFailureStage, ...] = (
        "invoke",
        "receipt_append",
        "result_store",
        "outcome_complete",
        "unknown_settlement",
    )
    categories: tuple[NativeModelFailureCategory, ...] = (
        "quota_exceeded",
        "authentication",
        "bad_request",
        "rate_limit",
        "connection",
        "timeout",
        "service_unavailable",
        "invalid_response",
        "result_too_large",
        "internal_unknown",
    )
    for stage in stages:
        for category in categories:
            diagnostic = NativeModelFailureDiagnostic(stage=stage, category=category)
            expected = f"Native Agent model invocation failed. [stage={stage}; reason={category}]"
            assert format_native_model_failure(diagnostic) == expected
            assert len(expected) < 256
            assert parse_native_model_failure("NativeAgentModelDispatchFailed: " + expected) == diagnostic
