"""The two hint mechanics a handler cannot do inline: the next page of a list, and hints on one SSE event kind."""

import json
from collections.abc import Iterator, Mapping

from controllers.openapi._hints import attach_stream_hints, next_page_hint
from controllers.openapi._models import Hint, PageQuery, PaginationEnvelope


class _Envelope(PaginationEnvelope[str]):
    pass


class _Query(PageQuery):
    name: str | None = None


def test_next_page_hint_copies_path_and_query_and_bumps_page() -> None:
    hint = next_page_hint(
        op="thing.list",
        path_args={"workspace_id": "ws-1"},
        query=_Query(page=2, name="x"),
        envelope=_Envelope.build(page=2, limit=20, total=100, items=[]),
    )
    assert hint == Hint(
        summary="Next page", op="thing.list", input={"workspace_id": "ws-1", "name": "x", "page": 3, "limit": 20}
    )
    last = _Envelope.build(page=5, limit=20, total=100, items=[])
    assert next_page_hint(op="thing.list", path_args={}, query=None, envelope=last) is None


def _sse(event: Mapping[str, object]) -> str:
    return f"data: {json.dumps(event)}\n\n"


def _build(event: Mapping[str, object]) -> list[Hint]:
    return [Hint(summary="Go on", op="thing.resume", input={"run_id": event["run_id"]})]


def test_attach_stream_hints_decorates_only_the_wanted_event() -> None:
    passthrough = [
        "event: ping\n\n",
        _sse({"event": "message", "answer": "paused"}),
        "not json\n\n",
        "data: paused\n\n",
    ]
    wanted = {"event": "paused", "run_id": "r1", "data": {"x": 1}}
    out = list(attach_stream_hints(iter([*passthrough, _sse(wanted)]), event="paused", build=_build))
    assert out[:-1] == passthrough
    assert json.loads(out[-1][len("data: ") :]) == {
        **wanted,
        "hints": [{"summary": "Go on", "op": "thing.resume", "input": {"run_id": "r1"}}],
    }


def test_attach_stream_hints_closes_the_source() -> None:
    class Source:
        closed = False

        def __iter__(self) -> Iterator[str]:
            yield _sse({"event": "message"})

        def close(self) -> None:
            self.closed = True

    source = Source()
    gen = attach_stream_hints(source, event="paused", build=_build)
    next(gen)
    gen.close()
    assert source.closed
