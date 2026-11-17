import pytest

from core.app.entities.app_invoke_entities import DifyRunContext, InvokeFrom, UserFrom
from core.app.llm import model_access
from graphon.model_runtime.entities.model_entities import AIModelEntity, ModelFeature
from tests.helpers.unit.knowledge_fs_core_fakes import RecordingModelFactory


def _run_context() -> DifyRunContext:
    return DifyRunContext(
        tenant_id="tenant", app_id="app", user_id="user", user_from=UserFrom.ACCOUNT, invoke_from=InvokeFrom.DEBUGGER
    )


def _stub_model_factory(
    monkeypatch: pytest.MonkeyPatch,
    context_window: object,
    *,
    features: list[ModelFeature] | None = None,
) -> RecordingModelFactory:
    schema = AIModelEntity.model_validate(
        {
            "model": "test",
            "label": {"en_US": "Test"},
            "model_type": "llm",
            "fetch_from": "predefined-model",
            "model_properties": {"context_size": context_window},
            "features": features,
        }
    )
    factory = RecordingModelFactory(schema)
    monkeypatch.setattr(model_access, "DifyModelFactory", factory)
    return factory


def test_resolve_model_runtime_profile_reads_selected_model_schema_once(monkeypatch: pytest.MonkeyPatch) -> None:
    factory = _stub_model_factory(monkeypatch, 128_000, features=[ModelFeature.VISION])
    run_context = _run_context()

    profile = model_access.resolve_model_runtime_profile(
        run_context=run_context,
        provider_name="langgenius/openai/openai",
        model_name="gpt-4o",
    )

    assert profile.context_window_tokens == 128_000
    assert profile.supported_modalities == ["vision"]
    assert factory.run_contexts == [run_context]
    assert factory.model_lookups == [("langgenius/openai/openai", "gpt-4o")]
    assert [instance.schema_calls for instance in factory.model_instances] == [1]


@pytest.mark.parametrize(
    ("features", "expected"),
    [
        (None, []),
        ([], []),
        ([ModelFeature.TOOL_CALL], []),
        ([ModelFeature.VISION], ["vision"]),
        (
            [
                ModelFeature.DOCUMENT,
                ModelFeature.VIDEO,
                ModelFeature.AUDIO,
                ModelFeature.VISION,
                ModelFeature.TOOL_CALL,
            ],
            ["vision", "audio", "video", "document"],
        ),
    ],
)
def test_resolve_model_runtime_profile_maps_only_declared_input_modalities(
    monkeypatch: pytest.MonkeyPatch,
    features: list[ModelFeature] | None,
    expected: list[str],
) -> None:
    _stub_model_factory(monkeypatch, 128_000, features=features)
    profile = model_access.resolve_model_runtime_profile(
        run_context=_run_context(),
        provider_name="openai",
        model_name="gpt-4o",
    )
    assert profile.context_window_tokens == 128_000
    assert profile.supported_modalities == expected


@pytest.mark.parametrize("context_window", [None, 0, -1, True, False, "128000", 128_000.0])
def test_resolve_model_runtime_profile_ignores_invalid_context_sizes(
    monkeypatch: pytest.MonkeyPatch,
    context_window: object,
) -> None:
    _ = _stub_model_factory(monkeypatch, context_window)

    profile = model_access.resolve_model_runtime_profile(
        run_context=_run_context(), provider_name="openai", model_name="gpt-4o"
    )
    assert profile.context_window_tokens is None
