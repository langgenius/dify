"""M1: user-facing agent prompts instruct the model to answer in the user's language."""

from collections.abc import Callable, Iterator
from types import ModuleType
from unittest.mock import create_autospec

import pytest

from services.dify_builder.agent import llm


def test_language_instruction_constants() -> None:
    assert "same language" in llm.LANGUAGE_INSTRUCTION.lower()
    js = llm.json_language_instruction("root_cause")
    assert "root_cause" in js
    assert "english" in js.lower()  # keys/enums stay English
    assert js.startswith(" ")  # concatenable onto an existing prompt


def _system_captured(
    monkeypatch: pytest.MonkeyPatch, _module: ModuleType, _fn_name: str, call: Callable[[], object]
) -> str:
    """Call an agent fn with a fake model, capturing the `system` prompt passed to llm."""
    captured: dict[str, str] = {}

    def fake_invoke_json(_model: object, *, system: str, **_kwargs: object) -> dict[str, object]:
        captured["system"] = system
        return {
            "fields": [],
            "values": {},
            "plan": ["x"],
            "root_cause": "y",
            "culprit_node_id": "",
            "severity": "low",
            "intents": [],
            "risk": {"level": "low", "reason": "ok", "has_external_side_effect": False},
            "target_node_ids": [],
        }

    def fake_invoke_text(_model: object, *, system: str, **_kwargs: object) -> str:
        captured["system"] = system
        return '{"plan": ["x"]}'

    def fake_invoke_text_stream(
        model: object,  # noqa: ARG001
        *,
        system: str,
        user: str,  # noqa: ARG001
        model_parameters: object = None,  # noqa: ARG001
        stop: object = None,  # noqa: ARG001
        on_reasoning: object = None,  # noqa: ARG001
    ) -> Iterator[str]:
        captured["system"] = system
        yield "hi"

    monkeypatch.setattr(llm, "invoke_json", fake_invoke_json)
    monkeypatch.setattr(llm, "invoke_text", fake_invoke_text)
    monkeypatch.setattr(llm, "invoke_text_stream", fake_invoke_text_stream)
    call()
    return captured["system"]


def test_chat_prompt_has_language_instruction(monkeypatch: pytest.MonkeyPatch) -> None:
    from core.dify_builder.models import DifyBuilderContext
    from core.dify_builder.state import PcState
    from services.dify_builder.agent import chat

    system = _system_captured(
        monkeypatch,
        chat,
        "respond",
        lambda: chat.respond(
            object(), {}, PcState.BUILD_CAPABILITY_CHECK, DifyBuilderContext(), [], {"nodes": [], "edges": []}, "你好"
        ),
    )
    assert "same language" in system.lower()


def test_plan_prompt_keeps_keys_english(monkeypatch: pytest.MonkeyPatch) -> None:
    from services.dify_builder.agent import build

    system = _system_captured(
        monkeypatch,
        build,
        "propose_plan_v1",
        lambda: build.propose_plan_v1(object(), {"goal": "x"}),
    )
    assert "same language" in system.lower()
    assert "english" in system.lower()


@pytest.mark.parametrize("operation", ["diagnose", "diagnose_checklist", "propose_repair"])
def test_fix_prompt_uses_persisted_language_with_english_evidence(
    monkeypatch: pytest.MonkeyPatch, operation: str
) -> None:
    from core.dify_builder.models import Diagnosis, Graph, Run
    from core.model_manager import ModelInstance
    from services.dify_builder.agent import fix

    graph: Graph = {"nodes": [], "edges": []}
    model = create_autospec(ModelInstance, instance=True)
    calls = {
        "diagnose": lambda: fix.diagnose(model, Run(error="Connection refused"), graph, [], reply_language="zh-Hans"),
        "diagnose_checklist": lambda: fix.diagnose_checklist(model, [], graph, reply_language="zh-Hans"),
        "propose_repair": lambda: fix.propose_repair(
            model, Diagnosis(root_cause="Connection refused"), graph, reply_language="zh-Hans"
        ),
    }
    system = _system_captured(monkeypatch, fix, operation, calls[operation])
    assert "zh-Hans" in system
    assert "English" in system
