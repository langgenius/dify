from types import SimpleNamespace
from typing import cast

import pytest

from core.app.entities.app_invoke_entities import DifyRunContext
from core.app.llm import model_access
from graphon.model_runtime.entities.model_entities import ModelFeature, ModelPropertyKey


def _stub_model_factory(
    monkeypatch: pytest.MonkeyPatch,
    context_window: object,
    *,
    features: list[ModelFeature] | None = None,
) -> dict[str, object]:
    calls: dict[str, object] = {}

    class FakeModelFactory:
        def __init__(self, *, run_context: DifyRunContext) -> None:
            calls["run_context"] = run_context

        def init_model_instance(self, provider_name: str, model_name: str) -> object:
            calls["provider_name"] = provider_name
            calls["model_name"] = model_name
            schema = SimpleNamespace(
                model_properties={ModelPropertyKey.CONTEXT_SIZE: context_window},
                features=features,
            )
            return SimpleNamespace(get_model_schema=lambda: schema)

    monkeypatch.setattr(model_access, "DifyModelFactory", FakeModelFactory)
    return calls


def test_resolve_model_context_window_reads_selected_model_schema(monkeypatch: pytest.MonkeyPatch) -> None:
    calls = _stub_model_factory(monkeypatch, 128_000)
    run_context = cast(DifyRunContext, object())

    context_window = model_access.resolve_model_context_window(
        run_context=run_context,
        provider_name="langgenius/openai/openai",
        model_name="gpt-4o",
    )

    assert context_window == 128_000
    assert calls == {
        "run_context": run_context,
        "provider_name": "langgenius/openai/openai",
        "model_name": "gpt-4o",
    }


@pytest.mark.parametrize("context_window", [None, 0, -1, True, False, "128000", 128_000.0])
def test_resolve_model_context_window_ignores_invalid_schema_values(
    monkeypatch: pytest.MonkeyPatch,
    context_window: object,
) -> None:
    _ = _stub_model_factory(monkeypatch, context_window)

    assert (
        model_access.resolve_model_context_window(
            run_context=cast(DifyRunContext, object()),
            provider_name="openai",
            model_name="gpt-4o",
        )
        is None
    )


@pytest.mark.parametrize(
    ("features", "expected"),
    [([ModelFeature.VISION], True), ([], False), (None, False)],
)
def test_resolve_model_supports_vision_reads_selected_model_schema(
    monkeypatch: pytest.MonkeyPatch,
    features: list[ModelFeature] | None,
    expected: bool,
) -> None:
    _stub_model_factory(monkeypatch, 128_000, features=features)

    assert (
        model_access.resolve_model_supports_vision(
            run_context=cast(DifyRunContext, object()),
            provider_name="openai",
            model_name="gpt-4o",
        )
        is expected
    )


def test_normalize_completion_params_pops_the_first_token_budget() -> None:
    parameters, stop, first_token_timeout = model_access._normalize_completion_params(
        {"temperature": 0.1, "stop": ["END"], "first_token_timeout_ms": 2500}
    )

    assert parameters == {"temperature": 0.1}
    assert stop == ["END"]
    assert first_token_timeout == pytest.approx(2.5)


@pytest.mark.parametrize("raw", [None, 0, -1, "2000", True])
def test_normalize_completion_params_disables_the_budget_for_an_invalid_value(raw: object) -> None:
    parameters, _, first_token_timeout = model_access._normalize_completion_params({"first_token_timeout_ms": raw})

    assert first_token_timeout is None
    assert "first_token_timeout_ms" not in parameters
