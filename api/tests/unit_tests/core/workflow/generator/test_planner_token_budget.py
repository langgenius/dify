"""The implicit Planner budget respects model capacity and caller choices."""

from typing import NoReturn

import pytest

from core.model_manager import ModelInstance
from graphon.model_runtime.entities.common_entities import I18nObject
from graphon.model_runtime.entities.model_entities import AIModelEntity, ParameterRule, ParameterType
from services.workflow_generation.runner import WorkflowGenerator, _clamp_for_planner
from tests.unit_tests.core.model_fixtures import make_model_config


def _model(monkeypatch: pytest.MonkeyPatch, maximum: object) -> ModelInstance:
    config = make_model_config(provider="openai", model="planner", mode="chat")
    rule = ParameterRule(name="max_tokens", label=I18nObject(en_US="Maximum tokens"), type=ParameterType.INT, max=8192)
    # Malformed provider metadata cases deliberately exercise the defensive
    # reader; model_copy preserves the public entity without coercing bad data.
    schema = config.model_schema.model_copy(update={"parameter_rules": [rule.model_copy(update={"max": maximum})]})
    model = ModelInstance(provider_model_bundle=config.provider_model_bundle, model=config.model, credentials={})

    def get_schema() -> AIModelEntity:
        return schema

    monkeypatch.setattr(model, "get_model_schema", get_schema)
    return model


def test_default_planner_budget_has_reasoning_and_answer_headroom() -> None:
    assert _clamp_for_planner({})["max_tokens"] == 16384


@pytest.mark.parametrize(("maximum", "expected"), [(8192, 8192), (384000, 16384), (1024.0, 1024)])
def test_injected_default_respects_public_model_maximum(
    monkeypatch: pytest.MonkeyPatch, maximum: int | float, expected: int
) -> None:
    params = {"temperature": 0.7}
    assert _clamp_for_planner(params, model_instance=_model(monkeypatch, maximum))["max_tokens"] == expected
    assert params == {"temperature": 0.7}


@pytest.mark.parametrize("explicit", [1024, 8192, 32768])
def test_explicit_budget_and_reasoning_choices_are_preserved_without_schema_lookup(
    monkeypatch: pytest.MonkeyPatch, explicit: int
) -> None:
    model = _model(monkeypatch, 4096)

    def schema_forbidden() -> NoReturn:
        pytest.fail("an explicit token budget must not look up or change the model limit")

    monkeypatch.setattr(model, "get_model_schema", schema_forbidden)
    params = {"max_tokens": explicit, "thinking": True, "reasoning_effort": "high"}
    assert _clamp_for_planner(params, model_instance=model) == {**params, "temperature": 0.2}


@pytest.mark.parametrize("maximum", [None, 0, -1, 0.5, True, "8192", float("nan"), float("inf")])
def test_unusable_model_maximum_keeps_bounded_default(monkeypatch: pytest.MonkeyPatch, maximum: object) -> None:
    assert _clamp_for_planner({}, model_instance=_model(monkeypatch, maximum))["max_tokens"] == 16384


def test_unavailable_public_schema_keeps_bounded_default(monkeypatch: pytest.MonkeyPatch) -> None:
    model = _model(monkeypatch, 8192)

    def unavailable() -> NoReturn:
        raise RuntimeError("schema unavailable")

    monkeypatch.setattr(model, "get_model_schema", unavailable)
    assert _clamp_for_planner({}, model_instance=model)["max_tokens"] == 16384


def test_real_planner_invocation_uses_schema_bound_budget_for_existing_attempts(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    parameters: list[dict[str, object]] = []

    def invoke(*, model_parameters: dict[str, object], **_kwargs: object) -> dict[str, list[object]]:
        parameters.append(model_parameters)
        return {"nodes": []}

    monkeypatch.setattr(WorkflowGenerator, "_invoke_and_parse_json", staticmethod(invoke))
    WorkflowGenerator._run_planner(
        model_instance=_model(monkeypatch, 8192),
        model_parameters={},
        mode="workflow",
        instruction="Native Loop",
        ideal_output="",
        tool_catalogue_text="",
    )
    assert parameters == [{"temperature": 0.2, "max_tokens": 8192}]
