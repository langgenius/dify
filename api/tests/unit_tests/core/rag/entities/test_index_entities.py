import pytest
from pydantic import ValidationError

from api.core.rag.entities.index_entities import (
    EconomySetting,
    EmbeddingSetting,
    IndexMethod,
)


# --- EmbeddingSetting -------------------------------------------------------


def test_embedding_setting_requires_both_fields():
    with pytest.raises(ValidationError):
        EmbeddingSetting(embedding_provider_name="openai")
    with pytest.raises(ValidationError):
        EmbeddingSetting(embedding_model_name="text-embedding-3")


def test_embedding_setting_full():
    s = EmbeddingSetting(embedding_provider_name="openai", embedding_model_name="text-embedding-3")
    assert s.embedding_provider_name == "openai"
    assert s.embedding_model_name == "text-embedding-3"


def test_embedding_setting_rejects_wrong_types():
    with pytest.raises(ValidationError):
        EmbeddingSetting(embedding_provider_name=1, embedding_model_name="m")
    with pytest.raises(ValidationError):
        EmbeddingSetting(embedding_provider_name="p", embedding_model_name=2)


# --- EconomySetting ---------------------------------------------------------


def test_economy_setting_requires_int():
    with pytest.raises(ValidationError):
        EconomySetting()
    with pytest.raises(ValidationError):
        EconomySetting(keyword_number="five")


def test_economy_setting_accepts_int():
    s = EconomySetting(keyword_number=10)
    assert s.keyword_number == 10


# --- IndexMethod ------------------------------------------------------------


def test_index_method_requires_all_fields():
    with pytest.raises(ValidationError):
        IndexMethod(indexing_technique="high_quality")


def test_index_method_rejects_invalid_technique():
    with pytest.raises(ValidationError):
        IndexMethod(
            indexing_technique="vector",
            embedding_setting=EmbeddingSetting(embedding_provider_name="p", embedding_model_name="m"),
            economy_setting=EconomySetting(keyword_number=5),
        )


def test_index_method_accepts_both_literal_values():
    base = dict(
        embedding_setting=EmbeddingSetting(embedding_provider_name="p", embedding_model_name="m"),
        economy_setting=EconomySetting(keyword_number=5),
    )
    hq = IndexMethod(indexing_technique="high_quality", **base)
    eco = IndexMethod(indexing_technique="economy", **base)
    assert hq.indexing_technique == "high_quality"
    assert eco.indexing_technique == "economy"


def test_index_method_coerces_nested_dicts():
    m = IndexMethod(
        indexing_technique="high_quality",
        embedding_setting={"embedding_provider_name": "p", "embedding_model_name": "m"},
        economy_setting={"keyword_number": 7},
    )
    assert isinstance(m.embedding_setting, EmbeddingSetting)
    assert isinstance(m.economy_setting, EconomySetting)
    assert m.embedding_setting.embedding_provider_name == "p"
    assert m.economy_setting.keyword_number == 7


def test_index_method_rejects_bad_nested():
    with pytest.raises(ValidationError):
        IndexMethod(
            indexing_technique="high_quality",
            embedding_setting={"embedding_provider_name": "p"},  # missing model name
            economy_setting={"keyword_number": 7},
        )


def test_index_method_dump_round_trip():
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
