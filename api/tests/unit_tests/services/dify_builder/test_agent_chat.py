import pytest

from core.dify_builder.models import DifyBuilderContext
from core.dify_builder.state import PcState
from services.dify_builder.agent import chat


def test_respond_streams_model_deltas_and_returns_the_complete_reply(monkeypatch):
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


def test_respond_streams_the_fallback_when_no_model_is_available():
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


def test_respond_does_not_replace_an_already_streamed_partial_reply(monkeypatch):
    def partial_stream(*_args, **_kwargs):
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
