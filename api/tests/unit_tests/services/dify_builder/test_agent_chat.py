from collections.abc import Iterator

import pytest

from core.dify_builder.models import ConversationItem, DifyBuilderContext
from core.dify_builder.state import PcState
from services.dify_builder.agent import chat


def test_respond_streams_model_deltas_and_returns_the_complete_reply(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        chat.llm,
        "invoke_text_stream",
        lambda *_args, **_kwargs: iter(["First ", "second"]),
    )
    deltas: list[str] = []

    reply = chat.respond(
        object(),
        {},
        PcState.FIX_AWAIT_APPROVAL,
        DifyBuilderContext(),
        [],
        {"nodes": [], "edges": []},
        "Explain the repair",
        deltas.append,
    )

    assert reply == "First second"
    assert deltas == ["First ", "second"]


def test_respond_streams_the_fallback_when_no_model_is_available() -> None:
    deltas: list[str] = []

    reply = chat.respond(
        None,
        {},
        PcState.FIX_AWAIT_APPROVAL,
        DifyBuilderContext(),
        [],
        {"nodes": [], "edges": []},
        "Explain the repair",
        deltas.append,
    )

    assert deltas == [reply]


def test_respond_does_not_replace_an_already_streamed_partial_reply(monkeypatch: pytest.MonkeyPatch) -> None:
    def partial_stream(*_args: object, **_kwargs: object) -> Iterator[str]:
        yield "Partial"
        raise RuntimeError("stream failed")

    monkeypatch.setattr(chat.llm, "invoke_text_stream", partial_stream)
    deltas: list[str] = []

    with pytest.raises(RuntimeError, match="stream failed"):
        chat.respond(
            object(),
            {},
            PcState.FIX_AWAIT_APPROVAL,
            DifyBuilderContext(),
            [],
            {"nodes": [], "edges": []},
            "Explain the repair",
            deltas.append,
        )

    assert deltas == ["Partial"]


def test_respond_keeps_dynamic_history_and_ignores_legacy_notices(monkeypatch: pytest.MonkeyPatch) -> None:
    prompts: list[str] = []

    def stream(_model: object, *, user: str, **_kwargs: object) -> Iterator[str]:
        prompts.append(user)
        return iter(["动态 ", "response"])

    monkeypatch.setattr(chat.llm, "invoke_text_stream", stream)
    history = [
        ConversationItem(kind="user", payload={"text": "Original {{value}} <tag>"}),
        ConversationItem(kind="assistant_turn", payload={"reply_text": "Earlier dynamic response"}),
        *[ConversationItem(kind="notice", payload={"text": "Legacy recovery notice"}) for _ in range(24)],
    ]
    deltas: list[str] = []

    reply = chat.respond(
        object(), {}, PcState.BUILD_REVIEW, DifyBuilderContext(), history, {"nodes": []}, "Explain", deltas.append
    )

    assert "Original {{value}} <tag>" in prompts[0]
    assert "Earlier dynamic response" in prompts[0]
    assert "Legacy recovery notice" not in prompts[0]
    assert reply == "动态 response"
    assert deltas == ["动态 ", "response"]


def test_completed_draft_history_can_be_reported_without_claiming_a_new_action(monkeypatch):
    captured = {}

    def stream(_model, *, system, user, **_kwargs):
        captured.update(system=system, user=user)
        return iter(["The confirmed changes were applied and kept as a draft."])

    monkeypatch.setattr(chat.llm, "invoke_text_stream", stream)
    history = [ConversationItem(kind="assistant_turn", payload={"reply_text": "Applied 1 change(s) to the canvas."})]
    chat.respond(object(), {}, PcState.EDIT_COMPLETE, DifyBuilderContext(), history, {"nodes": []}, "Explain")
    assert "Applied 1 change(s)" in captured["user"]
    assert "may report actions already confirmed" in captured["system"]
    assert "kept as a draft does not mean unapplied" in captured["system"]
    assert "never approve, publish, revert, run, or mutate" in captured["system"]
