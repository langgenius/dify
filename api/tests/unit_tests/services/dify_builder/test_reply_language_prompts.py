"""M1: user-facing agent prompts instruct the model to answer in the user's language."""

from services.dify_builder.agent import llm


def test_language_instruction_constants():
    assert "same language" in llm.LANGUAGE_INSTRUCTION.lower()
    js = llm.json_language_instruction("root_cause")
    assert "root_cause" in js
    assert "english" in js.lower()  # keys/enums stay English
    assert js.startswith(" ")  # concatenable onto an existing prompt


def _system_captured(monkeypatch, module, fn_name, call):  # noqa: ARG001
    """Call an agent fn with a fake model, capturing the `system` prompt passed to llm."""
    captured = {}

    def fake_invoke_json(model, *, system, user, model_parameters=None, stop=None, on_reasoning=None):  # noqa: ARG001
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

    def fake_invoke_text_stream(
        model,  # noqa: ARG001
        *,
        system,
        user,  # noqa: ARG001
        model_parameters=None,  # noqa: ARG001
        stop=None,  # noqa: ARG001
        on_reasoning=None,  # noqa: ARG001
    ):
        captured["system"] = system
        yield "hi"

    monkeypatch.setattr(llm, "invoke_json", fake_invoke_json)
    monkeypatch.setattr(llm, "invoke_text_stream", fake_invoke_text_stream)
    call()
    return captured["system"]


def test_chat_prompt_has_language_instruction(monkeypatch):
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


def test_plan_prompt_keeps_keys_english(monkeypatch):
    from services.dify_builder.agent import build

    system = _system_captured(
        monkeypatch,
        build,
        "propose_plan_v1",
        lambda: build.propose_plan_v1(object(), {"goal": "x"}),
    )
    assert "same language" in system.lower()
    assert "english" in system.lower()
