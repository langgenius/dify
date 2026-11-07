import pytest
from pydantic import ValidationError

from api.core.rag.entities.context_entities import DocumentContext


def test_content_is_required():
    with pytest.raises(ValidationError):
        DocumentContext()


def test_minimal_construction():
    ctx = DocumentContext(content="hello")
    assert ctx.content == "hello"
    assert ctx.score is None


def test_content_rejects_non_str():
    with pytest.raises(ValidationError):
        DocumentContext(content=123)


@pytest.mark.parametrize("score", [0.0, 0.5, 1.0, -2.5, 3.14159])
def test_score_accepts_float(score):
    ctx = DocumentContext(content="x", score=score)
    assert ctx.score == score


def test_score_accepts_int_coerced_to_float():
    ctx = DocumentContext(content="x", score=3)
    assert ctx.score == 3.0
    assert isinstance(ctx.score, float)


def test_score_accepts_none_explicitly():
    ctx = DocumentContext(content="x", score=None)
    assert ctx.score is None


def test_score_rejects_non_number():
    with pytest.raises(ValidationError):
        DocumentContext(content="x", score="high")


def test_score_accepts_bool_coerced_to_float():
    # pydantic v2 lax mode coerces bool -> float (True == 1.0)
    ctx = DocumentContext(content="x", score=True)
    assert ctx.score == 1.0
    assert isinstance(ctx.score, float)


def test_extra_fields_are_ignored():
    ctx = DocumentContext(content="x", unknown="y")
    assert not hasattr(ctx, "unknown")
    assert ctx.content == "x"


def test_model_dump_round_trip():
    ctx = DocumentContext(content="hi", score=0.9)
    dumped = ctx.model_dump()
    assert dumped == {"content": "hi", "score": 0.9}
    restored = DocumentContext(**dumped)
    assert restored == ctx


def test_model_dump_json():
    ctx = DocumentContext(content="hi", score=0.9)
    payload = ctx.model_dump_json()
    assert '"content":"hi"' in payload
    assert '"score":0.9' in payload


def test_equality():
    assert DocumentContext(content="a", score=1.0) == DocumentContext(content="a", score=1.0)
    assert DocumentContext(content="a", score=1.0) != DocumentContext(content="a", score=2.0)
