"""Every request, including JSON correction, checks current policy before dispatch."""

from collections.abc import Callable
from typing import Never

import pytest

from graphon.model_runtime.entities.llm_entities import LLMResult, LLMUsage
from graphon.model_runtime.entities.message_entities import AssistantPromptMessage
from services.dify_builder.agent import llm
from services.dify_builder.application.cognition_policy import CognitionPolicyDeniedError
from services.dify_builder.cognition_model_gateway import PolicyModelInstance


class CurrentSelection:
    calls = 0
    revoked = False

    def resolve(self) -> "CurrentSelection":
        if self.revoked:
            raise CognitionPolicyDeniedError("builder_disabled")
        return self

    def invoke_llm(self, **_kwargs: object) -> LLMResult:
        self.calls += 1
        self.revoked = True
        return LLMResult(
            model="model",
            prompt_messages=[],
            message=AssistantPromptMessage(content="[invalid json"),
            usage=LLMUsage.empty_usage(),
        )


def test_correction_rechecks_revoked_policy_before_another_dispatch() -> None:
    selected = CurrentSelection()
    model = PolicyModelInstance(selected.resolve)
    with pytest.raises(CognitionPolicyDeniedError, match="builder_disabled"):
        llm.invoke_json(model, system="test", user="test")
    assert selected.calls == 1


def test_dispatch_failure_never_selects_or_invokes_fallback() -> None:
    calls: list[str] = []

    class Failing:
        def invoke_llm(self, **_kwargs: object) -> Never:
            calls.append("invoke")
            raise RuntimeError("outcome unknown")

    def resolve() -> Failing:
        calls.append("select")
        return Failing()

    with pytest.raises(CognitionPolicyDeniedError, match="model_invocation_failed"):
        llm.invoke_text(PolicyModelInstance(resolve), system="test", user="test")
    assert calls == ["select", "invoke"]


def test_generator_stage_cannot_swallow_policy_revocation() -> None:
    from services.workflow_generation.runner import WorkflowGenerator

    def refused() -> Never:
        raise CognitionPolicyDeniedError("builder_disabled")

    with pytest.raises(CognitionPolicyDeniedError, match="builder_disabled"):
        WorkflowGenerator._run_stage(stage="Builder", failure_fallback_message="failed", run=refused)


def test_generator_never_retries_proxy_after_unknown_dispatch_failure() -> None:
    from graphon.model_runtime.errors.invoke import InvokeConnectionError
    from services.workflow_generation.runner import WorkflowGenerator

    calls: list[int] = []

    class Failed:
        def invoke_llm(self, **_kwargs: object) -> Never:
            calls.append(1)
            raise InvokeConnectionError(description="unknown outcome")

    with pytest.raises(CognitionPolicyDeniedError, match="model_invocation_failed"):
        WorkflowGenerator._invoke_with_retry(
            model_instance=PolicyModelInstance(lambda: Failed()),
            prompt_messages=[],
            model_parameters={},
            stage="Builder",
        )
    assert len(calls) == 1


def test_agent_without_admitted_actor_and_app_cannot_use_heuristics() -> None:
    from services.dify_builder.agent.llm_agent import LlmBuilderAgent

    with pytest.raises(CognitionPolicyDeniedError, match="policy_permission_denied"):
        LlmBuilderAgent("tenant").analyze_goal("do work")


@pytest.mark.parametrize(
    ("_module_name", "invoke"),
    [
        (
            "localize",
            lambda model: (
                __import__("services.dify_builder.agent.localize", fromlist=["LanguageDetector"])
                .LanguageDetector(lambda: model)
                .detect_language("hello")
            ),
        ),
        (
            "chat",
            lambda model: __import__(
                "services.dify_builder.agent.chat", fromlist=["continuation_intent"]
            ).continuation_intent(
                model,
                {},
                __import__("core.dify_builder.models", fromlist=["DifyBuilderContext"]).DifyBuilderContext(),
                {},
                "hello",
            ),
        ),
    ],
)
def test_policy_denial_escapes_helper_heuristic_fallback(
    _module_name: str, invoke: Callable[[PolicyModelInstance], object]
) -> None:
    def denied() -> Never:
        raise CognitionPolicyDeniedError("builder_disabled")

    with pytest.raises(CognitionPolicyDeniedError, match="builder_disabled"):
        invoke(PolicyModelInstance(denied))


def test_worker_policy_refusal_keeps_actionable_reason_in_typed_stream() -> None:
    from services.dify_builder.wiring import _error_event

    event = _error_event(
        {"session_id": "s", "error": "model_unavailable", "reason_code": "builder_disabled", "recoverable": True},
        "failed",
    )
    assert event["reason_code"] == "builder_disabled"
    assert event["recoverable"] is True
