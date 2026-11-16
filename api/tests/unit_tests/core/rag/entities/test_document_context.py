"""Unit tests for ``core.rag.entities.context_entities.DocumentContext``.

Negative cases feed invalid payloads through ``model_validate`` on purpose.
dify runs the strict ``pyrefly type-check-core`` over the test tree too, so
calling a pydantic model constructor with mistyped or missing arguments is a
*static* error there, even when the behaviour under test is a ValidationError.
``model_validate`` accepts an unvalidated mapping and goes through the very
same pydantic validation path, without producing a false positive in the gate.
"""

import pytest
from pydantic import ValidationError

from core.rag.entities.context_entities import DocumentContext


def test_content_is_required() -> None:
    with pytest.raises(ValidationError):
        DocumentContext.model_validate({})


def test_minimal_construction() -> None:
    ctx = DocumentContext(content="hello")
    assert ctx.content == "hello"
    assert ctx.score is None


def test_model_validate_matches_constructor() -> None:
    assert DocumentContext.model_validate({"content": "hello"}) == DocumentContext(content="hello")
    assert DocumentContext.model_validate({"content": "x", "score": 0.25}) == DocumentContext(content="x", score=0.25)


def test_content_rejects_non_str() -> None:
    with pytest.raises(ValidationError):
        DocumentContext.model_validate({"content": 123})


@pytest.mark.parametrize("score", [0.0, 0.5, 1.0, -2.5, 42.5])
def test_score_accepts_float(score: float) -> None:
    ctx = DocumentContext(content="x", score=score)
    assert ctx.score == score


def test_score_accepts_int_coerced_to_float() -> None:
    ctx = DocumentContext(content="x", score=3)
    assert ctx.score == 3.0
    assert isinstance(ctx.score, float)


def test_score_accepts_none_explicitly() -> None:
    ctx = DocumentContext(content="x", score=None)
    assert ctx.score is None


def test_score_rejects_non_number() -> None:
    with pytest.raises(ValidationError):
        DocumentContext.model_validate({"content": "x", "score": "high"})


def test_score_accepts_bool_coerced_to_float() -> None:
    # pydantic v2 lax mode coerces bool -> float (True == 1.0)
    ctx = DocumentContext(content="x", score=True)
    assert ctx.score == 1.0
    assert isinstance(ctx.score, float)


def test_extra_fields_are_ignored() -> None:
    ctx = DocumentContext.model_validate({"content": "x", "unknown": "y"})
    assert not hasattr(ctx, "unknown")
    assert ctx.content == "x"


def test_model_dump_round_trip() -> None:
    ctx = DocumentContext(content="hi", score=0.9)
    dumped = ctx.model_dump()
    assert dumped == {"content": "hi", "score": 0.9}
    restored = DocumentContext(**dumped)
    assert restored == ctx


def test_model_dump_json() -> None:
    ctx = DocumentContext(content="hi", score=0.9)
    payload = ctx.model_dump_json()
    assert '"content":"hi"' in payload
    assert '"score":0.9' in payload


def test_equality() -> None:
    assert DocumentContext(content="a", score=1.0) == DocumentContext(content="a", score=1.0)
    assert DocumentContext(content="a", score=1.0) != DocumentContext(content="a", score=2.0)
