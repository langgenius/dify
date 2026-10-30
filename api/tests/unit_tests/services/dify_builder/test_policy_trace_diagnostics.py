"""Policy refusal keeps bounded provider observations without granting replay."""

import json
from typing import Never

import httpx
import pytest

from core.model_manager import ModelInstance
from graphon.model_runtime.errors.invoke import InvokeAuthorizationError
from services.dify_builder import trace_diagnostics as diagnostics
from services.dify_builder.agent import llm
from services.dify_builder.application.cognition_policy import CognitionPolicyDeniedError
from services.dify_builder.cognition_model_gateway import PolicyModelInstance
from services.tools.draft_tool_setup import DraftToolSetupError
from tests.helpers.unit.core.model_fixtures import make_model_instance


@pytest.mark.parametrize(
    ("failure", "reason"),
    [
        (TimeoutError("private-token https://private/?key=secret"), "timeout"),
        (ConnectionRefusedError("private-token"), "connection_refused"),
        (InvokeAuthorizationError(description="private-token"), "authentication"),
        (
            httpx.HTTPStatusError(
                "private-token",
                request=httpx.Request("POST", "https://private/?key=secret"),
                response=httpx.Response(401),
            ),
            "authentication",
        ),
        (
            httpx.HTTPStatusError(
                "private-token",
                request=httpx.Request("POST", "https://private/?key=secret"),
                response=httpx.Response(403),
            ),
            "permission_denied",
        ),
        (PermissionError("private-token"), "permission_denied"),
        (RuntimeError("private-token"), "unknown"),
    ],
)
def test_policy_wrapped_provider_reason_survives_without_retry_or_secret_projection(
    monkeypatch: pytest.MonkeyPatch, failure: Exception, reason: diagnostics.FailureReason
) -> None:
    instance = make_model_instance(provider="openai", model="gpt")
    calls: list[str] = []

    def invoke(**_kwargs: object) -> Never:
        calls.append("invoke")
        raise failure

    def resolve() -> ModelInstance:
        calls.append("resolve")
        return instance

    monkeypatch.setattr(instance, "invoke_llm", invoke)
    records: list[dict[str, object]] = []
    with diagnostics.scope(records.append, "plan"):
        with pytest.raises(CognitionPolicyDeniedError, match="model_invocation_failed") as raised:
            llm.invoke_json(PolicyModelInstance(resolve), system="test", user="private prompt")
    assert raised.value.__cause__ is failure
    assert calls == ["resolve", "invoke"]
    assert records[0]["reason"] == reason
    assert records[0]["exception_type"] == "CognitionPolicyDeniedError"
    assert "private" not in json.dumps(records)
    assert "secret" not in json.dumps(records)


def test_explicit_setup_refusal_keeps_priority_over_underlying_timeout() -> None:
    error = DraftToolSetupError(
        "private-token timeout",
        reason="credential_unavailable",
        node={"id": "tool", "data": {"provider_id": "provider", "tool_name": "action"}},
    )
    error.__cause__ = TimeoutError()
    assert diagnostics.failure_reason(error) == "credential_unavailable"
    wrapper = RuntimeError("private-token")
    wrapper.__cause__ = error
    assert diagnostics.failure_reason(wrapper) == "credential_unavailable"


def test_nested_explicit_causes_preserve_known_reason_and_terminate_cycles() -> None:
    outer = RuntimeError("private-token")
    inner = RuntimeError("private-token")
    outer.__cause__ = inner
    inner.__cause__ = TimeoutError("private-token")
    assert diagnostics.failure_reason(outer) == "timeout"
    inner.__cause__ = outer
    assert diagnostics.failure_reason(outer) == "unknown"


def test_diagnostic_cause_walk_is_bounded_and_does_not_use_implicit_context() -> None:
    outer = RuntimeError("private-token")
    inner = outer
    for _ in range(32):
        cause = RuntimeError("private-token")
        inner.__cause__ = cause
        inner = cause
    inner.__cause__ = TimeoutError()
    assert diagnostics.failure_reason(outer) == "unknown"
    context = RuntimeError("private-token")
    context.__context__ = TimeoutError()
    assert diagnostics.failure_reason(context) == "unknown"
