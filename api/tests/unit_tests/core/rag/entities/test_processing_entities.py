import pytest
from pydantic import ValidationError

from core.rag.entities.processing_entities import Rule


@pytest.mark.parametrize("field", ["segmentation", "subchunk_segmentation"])
def test_processing_rule_rejects_negative_chunk_overlap(field: str) -> None:
    with pytest.raises(ValidationError) as exc_info:
        Rule.model_validate({field: {"max_tokens": 50, "chunk_overlap": -1}})

    assert exc_info.value.errors()[0]["loc"] == (field, "chunk_overlap")


@pytest.mark.parametrize("field", ["segmentation", "subchunk_segmentation"])
@pytest.mark.parametrize("max_tokens", [0, -1, -50])
def test_processing_rule_rejects_nonpositive_max_tokens(field: str, max_tokens: int) -> None:
    with pytest.raises(ValidationError) as exc_info:
        Rule.model_validate({field: {"max_tokens": max_tokens, "chunk_overlap": 0}})

    assert exc_info.value.errors()[0]["loc"] == (field, "max_tokens")


@pytest.mark.parametrize("field", ["segmentation", "subchunk_segmentation"])
@pytest.mark.parametrize(
    ("max_tokens", "chunk_overlap"),
    [
        (50, 50),
        (50, 60),
        (25, 25),
        (25, 30),
    ],
)
def test_processing_rule_rejects_chunk_overlap_ge_max_tokens(field: str, max_tokens: int, chunk_overlap: int) -> None:
    with pytest.raises(ValidationError) as exc_info:
        Rule.model_validate({field: {"max_tokens": max_tokens, "chunk_overlap": chunk_overlap}})

    assert exc_info.value.errors()[0]["loc"] == (field,)
    assert "chunk_overlap must be less than max_tokens" in str(exc_info.value)


@pytest.mark.parametrize("overlap", [0, 10])
def test_processing_rule_accepts_nonnegative_chunk_overlap(overlap: int) -> None:
    rule = Rule.model_validate(
        {
            "segmentation": {"max_tokens": 50, "chunk_overlap": overlap},
            "subchunk_segmentation": {"max_tokens": 25, "chunk_overlap": overlap},
        }
    )

    assert rule.segmentation is not None
    assert rule.segmentation.chunk_overlap == overlap
    assert rule.subchunk_segmentation is not None
    assert rule.subchunk_segmentation.chunk_overlap == overlap
