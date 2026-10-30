"""Policy forwarding preserves trusted generator budgets and administrator caps."""

from typing import cast

import pytest

from extensions.application_services.dify_builder_cognition_policy import _ConfiguredInvocation
from graphon.model_runtime.entities.llm_entities import LLMResult, LLMUsage
from graphon.model_runtime.entities.message_entities import AssistantPromptMessage
from services.dify_builder.cognition_model_gateway import PolicyModelInstance
from services.workflow_generation.runner import (
    WorkflowGenerator,
    _clamp_for_planner,
    _clamp_for_tool_router,
)
from tests.helpers.unit.core.model_fixtures import make_model_instance


def _invoke_planner(model: PolicyModelInstance, parameters: dict[str, object]) -> None:
    WorkflowGenerator._run_planner(
        model_instance=model,
        model_parameters=parameters,
        mode="workflow",
        instruction="make a draft",
        ideal_output="",
        tool_catalogue_text="",
    )


def test_actual_planner_budget_survives_inherited_empty_policy(monkeypatch: pytest.MonkeyPatch) -> None:
    native = make_model_instance(provider="openai", model="model")
    requests: list[dict[str, object]] = []

    def invoke(**kwargs: object) -> LLMResult:
        requests.append(kwargs)
        return LLMResult(
            model="model", message=AssistantPromptMessage(content='{"nodes": []}'), usage=LLMUsage.empty_usage()
        )

    monkeypatch.setattr(native, "invoke_llm", invoke)
    proxy = PolicyModelInstance(lambda: _ConfiguredInvocation(native, {}))
    _invoke_planner(proxy, {})
    expected = _clamp_for_planner({})
    assert requests[0]["model_parameters"] == expected
    budget = cast(dict[str, object], requests[0]["model_parameters"])["max_tokens"]
    assert isinstance(budget, int)
    assert budget > 4096


@pytest.mark.parametrize(
    ("administrator", "owner", "expected"),
    [
        (
            {"max_tokens": 4096, "temperature": 0.4},
            {"max_tokens": 8192, "temperature": 0.2},
            {"max_tokens": 4096, "temperature": 0.4},
        ),
        (
            {"max_tokens": 8192},
            _clamp_for_tool_router({}),
            {"max_tokens": _clamp_for_tool_router({})["max_tokens"], "temperature": 0.1},
        ),
    ],
)
def test_admin_parameters_are_authoritative_without_reexpanding_owner_budget(
    monkeypatch: pytest.MonkeyPatch,
    administrator: dict[str, object],
    owner: dict[str, object],
    expected: dict[str, object],
) -> None:
    native = make_model_instance(provider="openai", model="model")
    requests: list[dict[str, object]] = []

    def invoke(**kwargs: object) -> LLMResult:
        requests.append(kwargs)
        return LLMResult(model="model", message=AssistantPromptMessage(content="ok"), usage=LLMUsage.empty_usage())

    monkeypatch.setattr(native, "invoke_llm", invoke)
    model = PolicyModelInstance(lambda: _ConfiguredInvocation(native, administrator))
    WorkflowGenerator._invoke_with_retry(
        model_instance=model, prompt_messages=[], model_parameters=owner, stage="Builder", owner_defaults=owner
    )
    assert requests[0]["model_parameters"] == expected
    assert len(requests) == 1


@pytest.mark.parametrize(
    ("administrator", "owner_stop", "expected"),
    [
        ({}, ["OWNER"], ["OWNER"]),
        ({"stop": ["ADMIN"]}, ["OWNER"], ["ADMIN"]),
        ({"stop": []}, ["OWNER"], []),
    ],
)
def test_stop_sequence_preserves_owner_default_unless_administrator_configures_it(
    monkeypatch: pytest.MonkeyPatch,
    administrator: dict[str, object],
    owner_stop: list[str],
    expected: list[str],
) -> None:
    native = make_model_instance(provider="openai", model="model")
    requests: list[dict[str, object]] = []

    def invoke(**kwargs: object) -> LLMResult:
        requests.append(kwargs)
        return LLMResult(model="model", message=AssistantPromptMessage(content="ok"), usage=LLMUsage.empty_usage())

    monkeypatch.setattr(native, "invoke_llm", invoke)
    model = PolicyModelInstance(lambda: _ConfiguredInvocation(native, administrator))
    model.invoke_llm(prompt_messages=[], model_parameters={}, stop=owner_stop, owner_defaults={"stop": owner_stop})
    assert requests[0]["stop"] == expected
    assert requests[0]["model_parameters"] == {}


def test_planner_public_provider_limit_is_available_through_guarded_proxy(monkeypatch: pytest.MonkeyPatch) -> None:
    from tests.unit_tests.core.workflow.generator.test_planner_token_budget import _model

    native = _model(monkeypatch, 8192)
    model = PolicyModelInstance(lambda: _ConfiguredInvocation(native, {}))
    assert _clamp_for_planner({}, model_instance=model)["max_tokens"] == 8192


def test_actual_proxy_invocation_failure_does_not_reselect_or_retry(monkeypatch: pytest.MonkeyPatch) -> None:
    from graphon.model_runtime.errors.invoke import InvokeConnectionError
    from services.dify_builder.application.cognition_policy import CognitionPolicyDeniedError

    native = make_model_instance(provider="openai", model="model")
    requests: list[dict[str, object]] = []
    selections: list[int] = []

    def invoke(**kwargs: object) -> LLMResult:
        requests.append(kwargs)
        raise InvokeConnectionError(description="request outcome unknown")

    def selected() -> _ConfiguredInvocation:
        selections.append(1)
        return _ConfiguredInvocation(native, {})

    monkeypatch.setattr(native, "invoke_llm", invoke)
    with pytest.raises(CognitionPolicyDeniedError, match="model_invocation_failed"):
        WorkflowGenerator._invoke_with_retry(
            model_instance=PolicyModelInstance(selected),
            prompt_messages=[],
            model_parameters={"max_tokens": 8192},
            stage="Planner",
        )
    assert len(requests) == len(selections) == 1


@pytest.mark.parametrize("administrator", [{}, {"max_tokens": 4096, "temperature": 0.3, "stop": []}])
def test_actual_planner_fallback_drops_primary_parameters_and_stop(
    monkeypatch: pytest.MonkeyPatch,
    administrator: dict[str, object],
) -> None:
    from tests.unit_tests.core.workflow.generator.test_planner_token_budget import _model

    native = _model(monkeypatch, 8192)
    requests: list[dict[str, object]] = []

    def invoke(**kwargs: object) -> LLMResult:
        requests.append(kwargs)
        return LLMResult(
            model="fallback", message=AssistantPromptMessage(content='{"nodes": []}'), usage=LLMUsage.empty_usage()
        )

    monkeypatch.setattr(native, "invoke_llm", invoke)
    # The proxy already selected the fallback's administrator configuration.
    # These primary-option params must not be relabelled as trusted defaults.
    model = PolicyModelInstance(lambda: _ConfiguredInvocation(native, administrator))
    _invoke_planner(model, {"seed": 77, "top_p": 0.9, "stop": ["PRIMARY"], "max_tokens": 999999})
    assert requests[0]["model_parameters"] == {
        "temperature": administrator.get("temperature", 0.2),
        "max_tokens": administrator.get("max_tokens", 8192),
    }
    assert requests[0]["stop"] == administrator.get("stop")
    assert "owner_defaults" not in requests[0]


def test_actual_tool_router_keeps_lower_budget_under_administrator_cap(monkeypatch: pytest.MonkeyPatch) -> None:
    native = make_model_instance(provider="openai", model="router")
    requests: list[dict[str, object]] = []

    def invoke(**kwargs: object) -> LLMResult:
        requests.append(kwargs)
        return LLMResult(
            model="router",
            message=AssistantPromptMessage(content='{"needs_tools":false,"queries":[]}'),
            usage=LLMUsage.empty_usage(),
        )

    monkeypatch.setattr(native, "invoke_llm", invoke)
    model = PolicyModelInstance(lambda: _ConfiguredInvocation(native, {"max_tokens": 8192, "stop": []}))
    assert WorkflowGenerator._run_tool_router(
        model_instance=model,
        model_parameters={"seed": 7, "stop": ["PRIMARY"], "max_tokens": 999999},
        instruction="find a tool",
        ideal_output="",
    ) == (False, [])
    assert requests[0]["model_parameters"] == _clamp_for_tool_router({})
    assert requests[0]["stop"] == []
    assert "owner_defaults" not in requests[0]


def test_ordinary_native_planner_keeps_existing_explicit_parameters(monkeypatch: pytest.MonkeyPatch) -> None:
    from tests.unit_tests.core.workflow.generator.test_planner_token_budget import _model

    native = _model(monkeypatch, 8192)
    requests: list[dict[str, object]] = []

    def invoke(**kwargs: object) -> LLMResult:
        requests.append(kwargs)
        return LLMResult(
            model="planner", message=AssistantPromptMessage(content='{"nodes": []}'), usage=LLMUsage.empty_usage()
        )

    monkeypatch.setattr(native, "invoke_llm", invoke)
    parameters = {"max_tokens": 32768, "temperature": 0.3, "seed": 7}
    WorkflowGenerator._run_planner(
        model_instance=native,
        model_parameters=parameters,
        mode="workflow",
        instruction="ordinary generation",
        ideal_output="",
        tool_catalogue_text="",
    )
    assert requests[0]["model_parameters"] == parameters
    assert "owner_defaults" not in requests[0]
