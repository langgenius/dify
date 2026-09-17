import json

from flask import Flask
from pydantic import BaseModel, Field

from controllers.openapi._contract import accepts
from controllers.openapi._hints import FORM_SUBMIT_OP, attach_stream_hints, form_hints, next_page_hint
from controllers.openapi._models import Hint, PaginationEnvelope


class _Row(BaseModel):
    id: str


class _Envelope(PaginationEnvelope[_Row]):
    pass


class _Query(BaseModel):
    page: int = Field(1, ge=1)
    limit: int = Field(20, ge=1)
    name: str | None = None


def test_next_page_hint_copies_path_and_query_and_bumps_page():
    envelope = _Envelope.build(page=2, limit=20, total=100, items=[])
    hint = next_page_hint(
        op="thing.list",
        path_args={"workspace_id": "ws-1"},
        query=_Query(page=2, limit=20, name="x"),
        envelope=envelope,
    )
    assert hint == Hint(
        summary="Next page", op="thing.list", input={"workspace_id": "ws-1", "name": "x", "page": 3, "limit": 20}
    )


def test_next_page_hint_is_none_on_last_page():
    envelope = _Envelope.build(page=5, limit=20, total=100, items=[])
    assert next_page_hint(op="thing.list", path_args={}, query=_Query(page=5), envelope=envelope) is None


def test_accepts_fills_hints_on_a_paginated_result():
    app = Flask(__name__)

    @accepts(query=_Query, op="thing.list")
    def view(ctx, workspace_id: str, *, query: _Query):  # noqa: ARG001
        return _Envelope.build(page=query.page, limit=query.limit, total=100, items=[])

    with app.test_request_context("/?page=1&limit=10"):
        result = view(ctx=None, workspace_id="ws-1")
    assert result.hints == [
        Hint(summary="Next page", op="thing.list", input={"workspace_id": "ws-1", "page": 2, "limit": 10})
    ]


def test_accepts_keeps_hints_the_handler_set():
    app = Flask(__name__)
    own = Hint(summary="mine", op="thing.other", input={})

    @accepts(query=_Query, op="thing.list")
    def view(ctx, *, query: _Query):  # noqa: ARG001
        return _Envelope.build(page=1, limit=10, total=100, items=[]).model_copy(update={"hints": [own]})

    with app.test_request_context("/?page=1&limit=10"):
        result = view(ctx=None)
    assert result.hints == [own]


def test_form_hints_fill_known_values_and_leave_fields_null():
    data = {
        "form_token": "ft-1",
        "inputs": [{"output_variable_name": "comment", "type": "paragraph", "required": False}],
        "actions": [{"id": "approve", "title": "批准"}, {"id": "reject", "title": ""}],
        "approval_channels": [],
    }
    assert form_hints(app_id="a1", data=data) == [
        Hint(
            summary="批准",
            op=FORM_SUBMIT_OP,
            input={"app_id": "a1", "form_token": "ft-1", "action": "approve", "inputs": {"comment": None}},
            form=data["inputs"],
        ),
        Hint(
            summary="reject",
            op=FORM_SUBMIT_OP,
            input={"app_id": "a1", "form_token": "ft-1", "action": "reject", "inputs": {"comment": None}},
            form=data["inputs"],
        ),
    ]


def test_form_hints_without_token_or_actions_is_empty():
    assert form_hints(app_id="a1", data={"inputs": [], "actions": [], "approval_channels": ["email"]}) == []
    assert form_hints(app_id="a1", data={"form_token": "ft", "inputs": [], "actions": []}) == []


def _sse(event: dict) -> str:
    return f"data: {json.dumps(event)}\n\n"


def test_attach_stream_hints_passes_other_chunks_through_byte_for_byte():
    chunks = ["event: ping\n\n", _sse({"event": "message", "answer": "hi"}), "not json\n\n"]
    assert list(attach_stream_hints(iter(chunks), app_id="a1")) == chunks


def test_attach_stream_hints_decorates_human_input_required():
    event = {
        "event": "human_input_required",
        "workflow_run_id": "r1",
        "data": {"form_token": "ft", "inputs": [], "actions": [{"id": "ok", "title": "OK"}], "approval_channels": []},
    }
    [out] = list(attach_stream_hints(iter([_sse(event)]), app_id="a1"))
    assert out.startswith("data: ")
    assert out.endswith("\n\n")
    body = json.loads(out[len("data: ") :])
    assert body["data"] == event["data"]
    assert body["hints"] == [
        {
            "summary": "OK",
            "op": FORM_SUBMIT_OP,
            "input": {"app_id": "a1", "form_token": "ft", "action": "ok", "inputs": {}},
            "form": [],
        }
    ]


def test_attach_stream_hints_closes_the_source():
    class Source:
        closed = False

        def __iter__(self):
            yield _sse({"event": "message", "answer": "x"})

        def close(self):
            self.closed = True

    source = Source()
    gen = attach_stream_hints(source, app_id="a1")
    next(gen)
    gen.close()
    assert source.closed
