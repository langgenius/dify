"""Unit tests for ``core.rag.entities.index_entities``.

Negative cases intentionally use ``model_validate``: dify's strict
``pyrefly type-check-core`` also checks the test tree, so constructing a
pydantic model with missing or mistyped arguments is a *static* error even
though the runtime behaviour being tested is a ValidationError.
``model_validate`` takes an unvalidated mapping and exercises the same
validation path without tripping the type gate.
"""

import pytest
from pydantic import ValidationError

from core.rag.entities.index_entities import (
    EconomySetting,
    EmbeddingSetting,
    IndexMethod,
)

# --- EmbeddingSetting -------------------------------------------------------


def test_embedding_setting_requires_both_fields() -> None:
    with pytest.raises(ValidationError):
        EmbeddingSetting.model_validate({"embedding_provider_name": "openai"})
    with pytest.raises(ValidationError):
        EmbeddingSetting.model_validate({"embedding_model_name": "text-embedding-3"})


def test_embedding_setting_full() -> None:
    s = EmbeddingSetting(embedding_provider_name="openai", embedding_model_name="text-embedding-3")
    assert s.embedding_provider_name == "openai"
    assert s.embedding_model_name == "text-embedding-3"


def test_embedding_setting_rejects_wrong_types() -> None:
    with pytest.raises(ValidationError):
        EmbeddingSetting.model_validate({"embedding_provider_name": 1, "embedding_model_name": "m"})
    with pytest.raises(ValidationError):
        EmbeddingSetting.model_validate({"embedding_provider_name": "p", "embedding_model_name": 2})


# --- EconomySetting ---------------------------------------------------------


def test_economy_setting_requires_int() -> None:
    with pytest.raises(ValidationError):
        EconomySetting.model_validate({})
    with pytest.raises(ValidationError):
        EconomySetting.model_validate({"keyword_number": "five"})


def test_economy_setting_accepts_int() -> None:
    s = EconomySetting(keyword_number=10)
    assert s.keyword_number == 10


# --- IndexMethod ------------------------------------------------------------


def test_index_method_requires_all_fields() -> None:
    with pytest.raises(ValidationError):
        IndexMethod.model_validate({"indexing_technique": "high_quality"})


def test_index_method_rejects_invalid_technique() -> None:
    with pytest.raises(ValidationError):
        IndexMethod.model_validate(
            {
                "indexing_technique": "vector",
                "embedding_setting": {"embedding_provider_name": "p", "embedding_model_name": "m"},
                "economy_setting": {"keyword_number": 5},
            }
        )


def test_index_method_accepts_both_literal_values() -> None:
    base = {
        "embedding_setting": EmbeddingSetting(embedding_provider_name="p", embedding_model_name="m"),
        "economy_setting": EconomySetting(keyword_number=5),
    }
    hq = IndexMethod(indexing_technique="high_quality", **base)
    eco = IndexMethod(indexing_technique="economy", **base)
    assert hq.indexing_technique == "high_quality"
    assert eco.indexing_technique == "economy"


def test_index_method_coerces_nested_dicts() -> None:
    m = IndexMethod.model_validate(
        {
            "indexing_technique": "high_quality",
            "embedding_setting": {"embedding_provider_name": "p", "embedding_model_name": "m"},
            "economy_setting": {"keyword_number": 7},
        }
    )
    assert isinstance(m.embedding_setting, EmbeddingSetting)
    assert isinstance(m.economy_setting, EconomySetting)
    assert m.embedding_setting.embedding_provider_name == "p"
    assert m.economy_setting.keyword_number == 7


def test_index_method_rejects_bad_nested() -> None:
    with pytest.raises(ValidationError):
        IndexMethod.model_validate(
            {
                "indexing_technique": "high_quality",
                "embedding_setting": {"embedding_provider_name": "p"},  # missing model name
                "economy_setting": {"keyword_number": 7},
            }
        )


def test_index_method_dump_round_trip() -> None:
    m = IndexMethod(
        indexing_technique="economy",
        embedding_setting=EmbeddingSetting(embedding_provider_name="p", embedding_model_name="m"),
        economy_setting=EconomySetting(keyword_number=3),
    )
    dumped = m.model_dump()
    assert dumped == {
        "indexing_technique": "economy",
        "embedding_setting": {"embedding_provider_name": "p", "embedding_model_name": "m"},
        "economy_setting": {"keyword_number": 3},
    }
    assert IndexMethod(**dumped) == m


def test_model_validate_matches_constructor() -> None:
    payload = {
        "indexing_technique": "high_quality",
        "embedding_setting": {"embedding_provider_name": "p", "embedding_model_name": "m"},
        "economy_setting": {"keyword_number": 5},
    }
    assert IndexMethod.model_validate(payload) == IndexMethod(
        indexing_technique="high_quality",
        embedding_setting=EmbeddingSetting(embedding_provider_name="p", embedding_model_name="m"),
        economy_setting=EconomySetting(keyword_number=5),
    )
